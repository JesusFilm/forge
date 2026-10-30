import { randomUUID } from "node:crypto"

import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@prisma/client"
import { Client } from "pg"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"

import { resolveCurrentWatchSearchTranscriptCompatibility } from "./typesense-watch-search-transcript-compatibility"

type PlanNode = {
  "Relation Name"?: string
  "Actual Rows"?: number
  "Actual Loops"?: number
  Plans?: PlanNode[]
}

function chunkRowsVisited(node: PlanNode): number {
  const own =
    node["Relation Name"] === "video_transcript_chunk"
      ? (node["Actual Rows"] ?? 0) * (node["Actual Loops"] ?? 0)
      : 0
  return (
    own +
    (node.Plans ?? []).reduce((sum, child) => sum + chunkRowsVisited(child), 0)
  )
}

describe.skipIf(process.env.WATCH_SEARCH_DB_TEST !== "1")(
  "Watch transcript compatibility PostgreSQL",
  () => {
    const schema = `watch_compat_${randomUUID().replaceAll("-", "")}`
    const connectionString = process.env.DATABASE_URL
    const client = new Client({ connectionString })
    let prisma: PrismaClient
    let compatibilityQuery: { query: string; params: string } | undefined

    beforeAll(async () => {
      if (!connectionString) throw new Error("DATABASE_URL is required")
      await client.connect()
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET search_path TO "${schema}"`)
      await client.query(`
        CREATE TABLE content_embedding_contract (
          id text PRIMARY KEY,
          query_provider text, query_model text,
          query_native_dimensions integer, query_dimensions integer,
          query_transform_version text,
          storage_provider text, storage_model text,
          storage_native_dimensions integer, storage_dimensions integer,
          storage_transform_version text
        );
        INSERT INTO content_embedding_contract VALUES (
          'test-contract', 'query-provider', 'query-model', 1536, 1536, NULL,
          'storage-provider', 'storage-model', 1536, 1536, NULL
        );
        CREATE TABLE content_embedding_contract_pointer (
          id text PRIMARY KEY, active_contract_id text
        );
        INSERT INTO content_embedding_contract_pointer VALUES (
          'content-embedding-contract-pointer', 'test-contract'
        );
        CREATE TABLE video_transcript (
          id text PRIMARY KEY, chunking_version text,
          embedding_provider text DEFAULT 'storage-provider',
          model text DEFAULT 'storage-model', dimensions integer DEFAULT 1536,
          embedding_native_dimensions integer DEFAULT 1536,
          embedding_transform_version text
        );
        CREATE TABLE video_transcript_chunk (
          transcript_id text REFERENCES video_transcript(id),
          chunk_index integer, embedding bytea,
          model text DEFAULT 'storage-model', dimensions integer DEFAULT 1536,
          PRIMARY KEY (transcript_id, chunk_index)
        );
      `)
      const observedPrisma = new PrismaClient({
        adapter: new PrismaPg({
          connectionString,
          options: `-c search_path=${schema}`,
        }),
        log: [{ emit: "event", level: "query" }],
      })
      observedPrisma.$on("query", (event) => {
        if (event.query.includes("video_transcript")) compatibilityQuery = event
      })
      prisma = observedPrisma
    })

    afterAll(async () => {
      await prisma?.$disconnect()
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    })

    beforeEach(async () => {
      compatibilityQuery = undefined
      await client.query("TRUNCATE video_transcript_chunk, video_transcript")
      await client.query(
        "UPDATE content_embedding_contract SET storage_transform_version = NULL",
      )
    })

    async function addTranscript(id: string, version: string | null) {
      await client.query(
        "INSERT INTO video_transcript(id, chunking_version) VALUES ($1, $2)",
        [id, version],
      )
      await client.query(
        "INSERT INTO video_transcript_chunk(transcript_id, chunk_index, embedding) VALUES ($1, 0, decode('01', 'hex'))",
        [id],
      )
    }

    it("checks chunk existence per version instead of expanding every transcript's chunks", async () => {
      await client.query(`
        INSERT INTO video_transcript(id, chunking_version)
        SELECT 'transcript-' || n, 'version-1' FROM generate_series(1, 5000) n;
        INSERT INTO video_transcript_chunk(transcript_id, chunk_index, embedding)
        SELECT id, n, decode(repeat('01', 128), 'hex')
        FROM video_transcript CROSS JOIN generate_series(0, 11) n;
        ANALYZE video_transcript;
        ANALYZE video_transcript_chunk;
      `)

      await expect(
        resolveCurrentWatchSearchTranscriptCompatibility(prisma),
      ).resolves.toEqual({
        contentEmbeddingContractId: "test-contract",
        transcriptChunkingVersion: "version-1",
      })
      if (!compatibilityQuery)
        throw new Error("Compatibility query was not captured")
      const params: unknown[] = JSON.parse(compatibilityQuery.params)
      const result = await client.query<{ "QUERY PLAN": { Plan: PlanNode }[] }>(
        `EXPLAIN (ANALYZE, FORMAT JSON, TIMING OFF) ${compatibilityQuery.query}`,
        params,
      )
      const plan = result.rows[0]?.["QUERY PLAN"][0]?.Plan
      expect(plan).toBeDefined()
      // A work bound is stable across machines, unlike an elapsed-time limit.
      expect(chunkRowsVisited(plan!)).toBeLessThan(500)
    })

    it("ignores versions without a qualifying chunk and incompatible parent provenance", async () => {
      await addTranscript("valid", "version-1")
      for (const [id, assignment] of [
        ["provider", "embedding_provider = 'other'"],
        ["parent-model", "model = 'other'"],
        ["parent-dimensions", "dimensions = 3072"],
        ["native-dimensions", "embedding_native_dimensions = 3072"],
        ["transform", "embedding_transform_version = 'other'"],
      ]) {
        await addTranscript(id!, "incompatible-version")
        await client.query(
          `UPDATE video_transcript SET ${assignment} WHERE id = $1`,
          [id],
        )
      }
      for (const [id, assignment] of [
        ["null-embedding", "embedding = NULL"],
        ["chunk-model", "model = 'other'"],
        ["chunk-dimensions", "dimensions = 3072"],
      ]) {
        await addTranscript(id!, "incompatible-version")
        await client.query(
          `UPDATE video_transcript_chunk SET ${assignment} WHERE transcript_id = $1`,
          [id],
        )
      }
      await client.query(
        "INSERT INTO video_transcript(id, chunking_version) VALUES ('no-chunks', 'incompatible-version')",
      )
      await expect(
        resolveCurrentWatchSearchTranscriptCompatibility(prisma),
      ).resolves.toMatchObject({
        transcriptChunkingVersion: "version-1",
      })
    })

    it.each(["version-2", null, ""])(
      "rejects a second qualifying version %s",
      async (version) => {
        await addTranscript("first", "version-1")
        await addTranscript("second", version)
        await expect(
          resolveCurrentWatchSearchTranscriptCompatibility(prisma),
        ).rejects.toThrow(/one exact current chunking version/)
      },
    )

    it("matches a non-null transform exactly", async () => {
      await client.query(
        "UPDATE content_embedding_contract SET storage_transform_version = 'transform-v2'",
      )
      await addTranscript("matching-transform", "version-2")
      await client.query(
        "UPDATE video_transcript SET embedding_transform_version = 'transform-v2'",
      )
      await addTranscript("null-transform", "version-1")
      await expect(
        resolveCurrentWatchSearchTranscriptCompatibility(prisma),
      ).resolves.toMatchObject({
        transcriptChunkingVersion: "version-2",
      })
    })

    it.each([null, "", " "])(
      "rejects a sole invalid version %s",
      async (version) => {
        await addTranscript("invalid", version)
        await expect(
          resolveCurrentWatchSearchTranscriptCompatibility(prisma),
        ).rejects.toThrow(/chunking version is required/)
      },
    )

    it("rejects no compatible chunks", async () => {
      await addTranscript("empty", "version-1")
      await client.query("UPDATE video_transcript_chunk SET embedding = NULL")
      await expect(
        resolveCurrentWatchSearchTranscriptCompatibility(prisma),
      ).rejects.toThrow(/one exact current chunking version/)
    })
  },
)
