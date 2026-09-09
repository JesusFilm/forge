import { randomUUID } from "node:crypto"
import { Client } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { env } from "@/config/env"
import {
  ACTIVE_CONTENT_EMBEDDING_CONTRACT_SEED as contract,
  CONTENT_EMBEDDING_CONTRACT_POINTER_ID,
} from "@/services/content-embedding-contract"
import {
  COVERAGE_CONNECTION_OPTIONS,
  diagnoseRecommendationCoverage,
} from "./coverage-diagnostics"

const database = `coverage_test_${randomUUID().replaceAll("-", "")}`
const input = { seedMediaId: "seed", locale: "te", audioLanguageSlug: "telugu" }
let admin: Client | undefined
let fixture: Client | undefined
let databaseUrl: string
let databaseCreated = false

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "coverage database stages",
  () => {
    beforeAll(async () => {
      const url = new URL(env.DATABASE_URL)
      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "Coverage fixtures require an explicitly local database",
        )
      }
      url.pathname = "/postgres"
      admin = new Client({ connectionString: url.toString() })
      await admin.connect()
      await admin.query(`CREATE DATABASE ${database}`)
      databaseCreated = true
      url.pathname = `/${database}`
      databaseUrl = url.toString()
      fixture = new Client({ connectionString: databaseUrl })
      await fixture.connect()
      await fixture.query(`
      CREATE EXTENSION vector;
      CREATE TABLE content_embedding_contract (
        id text PRIMARY KEY, query_provider text, query_model text,
        query_native_dimensions int, query_dimensions int, query_transform_version text,
        storage_provider text, storage_model text, storage_native_dimensions int,
        storage_dimensions int, storage_transform_version text
      );
      CREATE TABLE content_embedding_contract_pointer (id text PRIMARY KEY, active_contract_id text);
      CREATE TABLE video (id text PRIMARY KEY, deleted_at timestamptz, restrict_view_platforms text[] DEFAULT '{}');
      CREATE TABLE video_relation (parent_id text, child_id text);
      CREATE TABLE video_transcript (
        id text PRIMARY KEY, video_id text, video_edition_id text, language text,
        embedding_provider text, model text, dimensions int, embedding_native_dimensions int,
        embedding_transform_version text
      );
      CREATE TABLE video_transcript_chunk (
        id text PRIMARY KEY, transcript_id text, language text, model text, dimensions int,
        embedding vector(1536)
      );
      CREATE TABLE video_locale (video_id text, locale text, status text, deleted_at timestamptz);
      CREATE TABLE language (id text PRIMARY KEY, slug text, bcp47 text);
      CREATE TABLE mux_video (id text PRIMARY KEY, playback_id text);
      CREATE TABLE video_dub (video_edition_id text, language_id text, mux_video_id text, deleted_at timestamptz);
    `)
      await fixture.query(
        `INSERT INTO content_embedding_contract VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          contract.id,
          contract.query.provider,
          contract.query.model,
          contract.query.nativeDimensions,
          contract.query.dimensions,
          contract.query.transformVersion,
          contract.storage.provider,
          contract.storage.model,
          contract.storage.nativeDimensions,
          contract.storage.dimensions,
          contract.storage.transformVersion,
        ],
      )
      await fixture.query(
        "INSERT INTO content_embedding_contract_pointer VALUES ($1,$2)",
        [CONTENT_EMBEDDING_CONTRACT_POINTER_ID, contract.id],
      )
    })

    beforeEach(async () => {
      await fixture!.query(`
      TRUNCATE video, video_relation, video_transcript, video_transcript_chunk, video_locale, video_dub, language, mux_video;
      INSERT INTO video(id) VALUES ('seed'),('target'),('parent'),('child');
      INSERT INTO video_relation VALUES ('parent','seed'),('seed','child');
      INSERT INTO video_transcript (id,video_id,video_edition_id,language,embedding_provider,model,dimensions,embedding_native_dimensions)
        SELECT video.id,video.id,video.id||'-edition','te',c.storage_provider,c.storage_model,c.storage_dimensions,c.storage_native_dimensions
        FROM video CROSS JOIN content_embedding_contract c;
      INSERT INTO video_locale VALUES ('target','te','published',null);
      INSERT INTO language VALUES ('te','telugu','te'),('sibling','nethakani','te');
      INSERT INTO mux_video VALUES ('mux','playback');
      INSERT INTO video_dub VALUES ('target-edition','te','mux',null);
    `)
      const vector = `[${[1, ...Array<number>(1535).fill(0)].join(",")}]`
      await fixture!.query(
        `INSERT INTO video_transcript_chunk SELECT id,id,'te',model,dimensions,$1::vector FROM video_transcript`,
        [vector],
      )
    })

    afterAll(async () => {
      await fixture?.end()
      if (databaseCreated) await admin?.query(`DROP DATABASE ${database}`)
      await admin?.end()
    })

    it("counts exact eligible inventory and excludes seed and direct family", async () => {
      const report = await diagnoseRecommendationCoverage(databaseUrl, input)
      expect(report.blockers).toEqual([])
      expect(report.inventory).toMatchObject({
        seedExists: true,
        seedTranscripts: 1,
        seedCompatibleTranscripts: 1,
        seedEmbeddedTranscripts: 1,
        candidateTranscripts: 1,
        candidateCompatibleTranscripts: 1,
        candidateEmbeddedVideos: 1,
        watchableVideos: 1,
        publishedLocaleVideos: 1,
        exactAudioVideos: 1,
        eligibleInventoryVideos: 1,
      })
    })

    it("shows Chinese script metadata without treating it as the requested locale", async () => {
      await fixture!.query(
        `UPDATE video_transcript SET language='zh'; UPDATE video_transcript_chunk SET language='zh'; UPDATE video_locale SET locale='zh-hans'`,
      )
      const report = await diagnoseRecommendationCoverage(databaseUrl, {
        ...input,
        locale: "zh",
      })
      expect(report.blockers).toEqual(["published_metadata_missing"])
      expect(report.inventory.exactAudioVideos).toBe(1)
      expect(report.inventory.publishedLocalesOnExactAudioVideos).toEqual([
        { locale: "zh-hans", videos: 1 },
      ])
    })

    it.each([
      ["DELETE FROM video WHERE id='seed'", "seed_media_missing"],
      [
        "UPDATE video_transcript SET embedding_provider='old' WHERE id='target'",
        "candidate_contract_incompatible",
      ],
      [
        "UPDATE video_transcript_chunk SET model='old' WHERE id='target'",
        "candidate_chunks_unavailable",
      ],
      [
        "UPDATE video_transcript_chunk SET language='en' WHERE id='target'",
        "candidate_chunks_unavailable",
      ],
      [
        "UPDATE video_transcript_chunk SET embedding=null WHERE id='target'",
        "candidate_chunks_unavailable",
      ],
      [
        "UPDATE video_transcript SET embedding_native_dimensions=3072 WHERE id='target'",
        "candidate_contract_incompatible",
      ],
      [
        "UPDATE video_transcript SET embedding_transform_version='old' WHERE id='target'",
        "candidate_contract_incompatible",
      ],
      [
        "UPDATE video_transcript_chunk SET embedding=null WHERE id='seed'",
        "seed_chunks_unavailable",
      ],
      [
        "DELETE FROM video_transcript WHERE id='seed'",
        "seed_transcript_missing",
      ],
      [
        "UPDATE video SET restrict_view_platforms=ARRAY['watch'] WHERE id='target'",
        "no_watchable_candidates",
      ],
      [
        "UPDATE video SET deleted_at=now() WHERE id='target'",
        "no_watchable_candidates",
      ],
      ["UPDATE video_locale SET status='draft'", "published_metadata_missing"],
      [
        "UPDATE video_locale SET deleted_at=now()",
        "published_metadata_missing",
      ],
      ["UPDATE video_dub SET language_id='sibling'", "exact_audio_unavailable"],
      [
        "UPDATE video_dub SET video_edition_id='other-edition'",
        "exact_audio_unavailable",
      ],
      ["UPDATE mux_video SET playback_id=null", "exact_audio_unavailable"],
    ])("diagnoses %s", async (sql, blocker) => {
      await fixture!.query(sql)
      expect(
        (await diagnoseRecommendationCoverage(databaseUrl, input)).blockers,
      ).toContain(blocker)
    })

    it("fails clearly when the active pointer is absent", async () => {
      await fixture!.query("DELETE FROM content_embedding_contract_pointer")
      try {
        await expect(
          diagnoseRecommendationCoverage(databaseUrl, input),
        ).rejects.toMatchObject({ code: "missing_active_pointer" })
      } finally {
        await fixture!.query(
          "INSERT INTO content_embedding_contract_pointer VALUES ($1,$2)",
          [CONTENT_EMBEDDING_CONTRACT_POINTER_ID, contract.id],
        )
      }
    })

    it("enforces read-only and query limits at connection startup", async () => {
      const client = new Client({
        connectionString: databaseUrl,
        ...COVERAGE_CONNECTION_OPTIONS,
      })
      await client.connect()
      try {
        const settings = await client.query(
          "SELECT current_setting('default_transaction_read_only') AS read_only, current_setting('statement_timeout') AS timeout, current_setting('lock_timeout') AS lock_timeout",
        )
        expect(settings.rows).toEqual([
          { read_only: "on", timeout: "5s", lock_timeout: "1s" },
        ])
        await expect(client.query("DELETE FROM video")).rejects.toMatchObject({
          code: "25006",
        })
      } finally {
        await client.end()
      }
    })
  },
)
