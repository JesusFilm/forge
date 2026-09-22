import { randomUUID } from "node:crypto"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  queryScenesSimilar,
  queryScenesSimilarMany,
  type SceneRecommendationSqlRow,
} from "./scene-recommendations-retriever"
import { SceneRecommendationsService } from "./scene-recommendations.service"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "exact contextual recommendation batching",
  () => {
    const schema = `scene_batch_${randomUUID().replaceAll("-", "")}`
    let admin: Client
    let prisma: PrismaClient

    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error("This isolated fixture requires local Postgres")
      }
      admin = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await admin.query(`CREATE SCHEMA "${schema}"`)
      await admin.query(`SET search_path TO "${schema}", public`)
      await admin.query(`
        CREATE TABLE language (id text, bcp47 text);
        CREATE TABLE video (id text, slug text, core_id text,
          deleted_at timestamptz, restrict_view_platforms text[] DEFAULT '{}');
        CREATE TABLE video_locale (id text, video_id text, title text,
          locale text, status text, deleted_at timestamptz);
        CREATE TABLE video_relation (parent_id text, child_id text);
        CREATE TABLE video_dub (id text, video_edition_id text,
          language_id text, mux_video_id text, deleted_at timestamptz,
          published boolean, updated_at timestamptz);
        CREATE TABLE mux_video (id text, playback_id text);
        CREATE TABLE video_transcript (id text, video_id text,
          video_edition_id text, language text, embedding_provider text,
          model text, dimensions int, embedding_native_dimensions int,
          embedding_transform_version text);
        CREATE TABLE video_transcript_chunk (id text, transcript_id text,
          chunk_index int, language text, model text, dimensions int,
          text text, content_summary text, raw_source_text text,
          start_seconds numeric, end_seconds numeric, felt_needs text[],
          demographics text[], spiritual_context text[], embedding vector(3));
        CREATE TABLE content_embedding_contract (id text,
          storage_provider text, storage_model text, storage_dimensions int,
          storage_native_dimensions int, storage_transform_version text);
        CREATE TABLE content_embedding_contract_pointer (id text,
          active_contract_id text);
        INSERT INTO content_embedding_contract VALUES
          ('active', 'fixture', 'fixture', 3, 3, NULL);
        INSERT INTO content_embedding_contract_pointer VALUES
          ('content-embedding-contract-pointer', 'active');
        INSERT INTO language VALUES ('en', 'en'), ('fr', 'fr');
      `)
      prisma = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: env.DATABASE_URL,
          options: `-c search_path=${schema},public`,
          max: 1,
        }),
      })
      for (const [id, embedding] of [
        ["seed", "[0.8,0.2,0]"],
        ["a", "[1,0,0]"],
        ["b", "[0.8,0,0.2]"],
        ["c", "[0,0.5,0.5]"],
        ["deleted", "[0,1,0]"],
        ["draft", "[0,1,0]"],
        ["restricted", "[0,1,0]"],
        ["wrong-audio", "[0,1,0]"],
        ["no-playback", "[0,1,0]"],
        ["old-contract", "[0,1,0]"],
        ["parent", "[0,1,0]"],
      ]) {
        await admin.query(
          `INSERT INTO video (id,slug,core_id) VALUES ($1,$1,$1)`,
          [id],
        )
        await admin.query(
          `INSERT INTO video_locale VALUES ($1,$1,$1,'en','published',NULL)`,
          [id],
        )
        await admin.query(
          `INSERT INTO mux_video VALUES ($1,$1);
          `,
          [id],
        )
        await admin.query(
          `INSERT INTO video_dub VALUES ($1,$1,'en',$1,NULL,true,'2026-01-01')`,
          [id],
        )
        await admin.query(
          `INSERT INTO video_transcript VALUES
            ($1,$1,$1,'en','fixture','fixture',3,3,NULL)`,
          [id],
        )
        await admin.query(
          `INSERT INTO video_transcript_chunk
            (id,transcript_id,chunk_index,language,model,dimensions,text,embedding)
            VALUES ($1,$1,0,'en','fixture',3,$1,$2::vector)`,
          [id, embedding],
        )
      }
      await admin.query(`
        INSERT INTO video_transcript_chunk
          (id,transcript_id,chunk_index,language,model,dimensions,text,embedding)
        VALUES ('seed-1','seed',1,'en','fixture',3,'seed','[0,1,0]'),
          ('a-1','a',1,'en','fixture',3,'a','[0,1,0]');
        UPDATE video SET deleted_at=now() WHERE id='deleted';
        UPDATE video_locale SET status='draft' WHERE id='draft';
        UPDATE video SET restrict_view_platforms=ARRAY['watch'] WHERE id='restricted';
        UPDATE video_dub SET language_id='fr' WHERE id='wrong-audio';
        UPDATE mux_video SET playback_id=NULL WHERE id='no-playback';
        UPDATE video_transcript SET model='old' WHERE id='old-contract';
        INSERT INTO video_relation VALUES ('parent','seed');
        INSERT INTO mux_video VALUES ('a-old','old-playback');
        INSERT INTO video_dub VALUES ('a-old','a','en','a-old',NULL,false,'2026-02-01');
      `)
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      if (admin) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await admin.end()
      }
    })

    it("matches the original loop, including best scene and per-seed cutoff", async () => {
      const vectors = ["[0.8,0.2,0]", "[0,1,0]"]
      for (const limit of [1, 2, 6]) {
        const expected = new Map<string, SceneRecommendationSqlRow>()
        for (const vector of vectors) {
          const rows = await queryScenesSimilar(
            prisma,
            vector,
            "en",
            ["seed", "parent"],
            limit,
          )
          for (const row of rows) {
            const previous = expected.get(row.video_id)
            if (!previous || row.similarity > previous.similarity)
              expected.set(row.video_id, row)
          }
        }
        const actual = await queryScenesSimilarMany(
          prisma,
          vectors,
          "en",
          ["seed", "parent"],
          limit,
        )
        expect(actual).toEqual(
          [...expected.values()].sort((a, b) => b.similarity - a.similarity),
        )
        expect(actual[0]).toMatchObject({
          video_id: "a",
          scene_index: 1,
          playback_id: "a",
          similarity: 1,
        })
      }
    })

    it("keeps eligibility filters and family exclusions in the service result", async () => {
      const result = await new SceneRecommendationsService({
        prisma,
      }).getRecommendations({ videoId: "seed", locale: "en", limit: 6 })
      expect(result.map((row) => row.videoId)).toEqual(["a", "b", "c"])
      expect(result[0]).toMatchObject({ sceneIndex: 1, playbackId: "a" })
    })

    it("handles long seed arrays without losing the final seed's strongest match", async () => {
      const result = await queryScenesSimilarMany(
        prisma,
        [...Array<string>(175).fill("[0.8,0.2,0]"), "[0,1,0]"],
        "en",
        ["seed", "parent"],
        6,
      )
      expect(result[0]).toMatchObject({
        video_id: "a",
        scene_index: 1,
        similarity: 1,
      })
      expect(result.map((row) => row.video_id)).toEqual(["a", "b", "c"])
    })

    it("evaluates cosine distance once per eligible chunk and seed", async () => {
      await prisma.$transaction(async (tx) => {
        // This local fixture uses PostgreSQL's per-transaction function counts,
        // so the assertion measures execution rather than SQL text or timings.
        await tx.$executeRaw`SET LOCAL track_functions = 'all'`
        const result = await queryScenesSimilarMany(
          tx,
          ["[0.8,0.2,0]", "[0,1,0]"],
          "en",
          ["seed", "parent"],
          6,
        )
        const counts = await tx.$queryRaw<Array<{ calls: number }>>`
          SELECT calls::integer AS calls
          FROM pg_stat_xact_user_functions
          WHERE funcid = 'cosine_distance(vector, vector)'::regprocedure
        `
        expect(result.map((row) => row.video_id)).toEqual(["a", "b", "c"])
        // Four eligible chunks (two for a, one each for b/c), two seeds.
        expect(counts).toEqual([{ calls: 8 }])
      })
    })
  },
)
