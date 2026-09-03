import { readFileSync } from "node:fs"

import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const RUN_REAL_DB_TEST = process.env.WATCH_SEARCH_DB_TEST === "1"
const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/0073_watch_search_candidate_exact_compatibility_identities/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

type QueryCommandResult = { command: string }

function queryCommands(result: QueryCommandResult | QueryCommandResult[]) {
  return Array.isArray(result)
    ? result.map((entry) => entry.command)
    : [result.command]
}

async function createLegacyCandidateTables(client: Client) {
  await client.query(`
    CREATE TABLE "watch_search_candidate_generation" (
      "id" text PRIMARY KEY,
      "application_revision" text NOT NULL,
      "source_epoch" text NOT NULL,
      "source_digests" jsonb NOT NULL,
      "catalog_collection" text NOT NULL,
      "availability_collection" text NOT NULL,
      "lexical_collection" text NOT NULL,
      "transcript_collection" text NOT NULL,
      "transcript_projection_revision" bigint NOT NULL,
      "catalog_fields" jsonb NOT NULL,
      "availability_fields" jsonb NOT NULL,
      "lexical_fields" jsonb NOT NULL,
      "transcript_fields" jsonb NOT NULL,
      "owned_collections" jsonb NOT NULL,
      "shared_collections" jsonb NOT NULL,
      "state" text NOT NULL,
      "version" integer NOT NULL,
      "validated_at" timestamptz,
      "invalidated_at" timestamptz,
      "invalidation_reason" text,
      "retired_at" timestamptz,
      "deletion_progress" jsonb NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await client.query(`
    CREATE TABLE "watch_search_candidate_qualification" (
      "id" text PRIMARY KEY,
      "generation_id" text NOT NULL,
      "status" text NOT NULL,
      "application_revision" text NOT NULL,
      "transcript_collection" text NOT NULL,
      "transcript_projection_revision" bigint NOT NULL,
      "qrels_revision" text NOT NULL,
      "current_bindings" jsonb NOT NULL,
      "evidence" jsonb NOT NULL,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await client.query(`
    CREATE TABLE "watch_search_candidate_lease" (
      "resource_key" text PRIMARY KEY,
      "kind" text NOT NULL,
      "holder_token" text NOT NULL,
      "generation_id" text NOT NULL,
      "application_revision" text NOT NULL,
      "transcript_collection" text NOT NULL,
      "transcript_projection_revision" bigint NOT NULL,
      "current_bindings" jsonb NOT NULL,
      "acquired_at" timestamptz NOT NULL DEFAULT now(),
      "renewed_at" timestamptz NOT NULL DEFAULT now(),
      "expires_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  await client.query(`
    CREATE TABLE "content_embedding_contract_pointer" (
      "id" text PRIMARY KEY,
      "active_contract_id" text NOT NULL
    )
  `)
  await client.query(`
    CREATE TABLE "content_embedding_contract" (
      "id" text PRIMARY KEY,
      "storage_provider" text NOT NULL,
      "storage_model" text NOT NULL,
      "storage_dimensions" integer NOT NULL,
      "storage_native_dimensions" integer NOT NULL,
      "storage_transform_version" text
    )
  `)
  await client.query(`
    CREATE TABLE "video_transcript" (
      "id" text PRIMARY KEY,
      "embedding_provider" text NOT NULL,
      "model" text NOT NULL,
      "dimensions" integer NOT NULL,
      "embedding_native_dimensions" integer NOT NULL,
      "embedding_transform_version" text,
      "chunking_version" text NOT NULL
    )
  `)
  await client.query(`
    CREATE TABLE "video_transcript_chunk" (
      "id" text PRIMARY KEY,
      "transcript_id" text NOT NULL,
      "model" text NOT NULL,
      "dimensions" integer NOT NULL,
      "embedding" jsonb
    )
  `)
  await client.query(`
    INSERT INTO "content_embedding_contract" (
      "id",
      "storage_provider",
      "storage_model",
      "storage_dimensions",
      "storage_native_dimensions",
      "storage_transform_version"
    ) VALUES (
      'semantic-transcript-pgvector-v1',
      'openai',
      'text-embedding-3-large',
      3072,
      3072,
      NULL
    )
  `)
  await client.query(`
    INSERT INTO "content_embedding_contract_pointer" (
      "id",
      "active_contract_id"
    ) VALUES (
      'content-embedding-contract-pointer',
      'semantic-transcript-pgvector-v1'
    )
  `)
}

async function seedActiveTranscriptCompatibility(client: Client) {
  await client.query(`
    INSERT INTO "video_transcript" (
      "id",
      "embedding_provider",
      "model",
      "dimensions",
      "embedding_native_dimensions",
      "embedding_transform_version",
      "chunking_version"
    ) VALUES (
      'transcript-1',
      'openai',
      'text-embedding-3-large',
      3072,
      3072,
      NULL,
      'mastra-v1'
    )
  `)
  await client.query(`
    INSERT INTO "video_transcript_chunk" (
      "id",
      "transcript_id",
      "model",
      "dimensions",
      "embedding"
    ) VALUES (
      'chunk-1',
      'transcript-1',
      'text-embedding-3-large',
      3072,
      '{}'::jsonb
    )
  `)
}

describe.skipIf(!RUN_REAL_DB_TEST)(
  "Watch search candidate trigger repair against real PostgreSQL",
  () => {
    const schemaName = `candidate_trigger_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    let client: Client

    beforeAll(async () => {
      const connectionString = process.env.DATABASE_URL
      if (connectionString == null || connectionString.length === 0) {
        throw new Error("DATABASE_URL is required when WATCH_SEARCH_DB_TEST=1")
      }

      client = new Client({ connectionString })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}"`)
      await createLegacyCandidateTables(client)
      await seedActiveTranscriptCompatibility(client)
      await client.query(migrationSql)
    })

    afterAll(async () => {
      if (client == null) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })

    it("accepts valid lifecycle updates and preserves identity guards", async () => {
      const baseValues = [
        "revision",
        "epoch",
        JSON.stringify({ catalog: "digest" }),
        "catalog",
        "availability",
        "lexical",
        "transcript",
        "semantic-transcript-pgvector-v1",
        "mastra-v1",
        1,
        JSON.stringify(["id"]),
        JSON.stringify(["videoId"]),
        JSON.stringify(["title"]),
        JSON.stringify(["text"]),
        JSON.stringify(["catalog", "availability", "lexical"]),
        JSON.stringify(["transcript"]),
        "building",
        1,
        JSON.stringify({ deletedCollections: [] }),
      ]

      await client.query(
        `
          INSERT INTO "watch_search_candidate_generation" (
            "id", "application_revision", "source_epoch", "source_digests",
            "catalog_collection", "availability_collection", "lexical_collection",
            "transcript_collection", "content_embedding_contract_id",
            "transcript_chunking_version", "transcript_projection_revision",
            "catalog_fields", "availability_fields", "lexical_fields",
            "transcript_fields", "owned_collections", "shared_collections",
            "state", "version", "deletion_progress"
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11,
            $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb,
            $17::jsonb, $18, $19, $20::jsonb)
        `,
        ["ready-path", ...baseValues],
      )

      await expect(
        client.query(`
          UPDATE "watch_search_candidate_generation"
          SET "state" = 'ready', "version" = 2, "validated_at" = now()
          WHERE "id" = 'ready-path'
        `),
      ).resolves.toMatchObject({ rowCount: 1 })

      await expect(
        client.query(`
          UPDATE "watch_search_candidate_generation"
          SET "application_revision" = 'changed'
          WHERE "id" = 'ready-path'
        `),
      ).rejects.toThrow("watch search candidate identity is immutable")
      await expect(
        client.query(`
          UPDATE "watch_search_candidate_generation"
          SET "content_embedding_contract_id" = 'semantic-transcript-pgvector-v2'
          WHERE "id" = 'ready-path'
        `),
      ).rejects.toThrow("watch search candidate identity is immutable")
      await expect(
        client.query(`
          UPDATE "watch_search_candidate_generation"
          SET "transcript_chunking_version" = 'mastra-v2'
          WHERE "id" = 'ready-path'
        `),
      ).rejects.toThrow("watch search candidate identity is immutable")

      await client.query(
        `
          INSERT INTO "watch_search_candidate_generation" (
            "id", "application_revision", "source_epoch", "source_digests",
            "catalog_collection", "availability_collection", "lexical_collection",
            "transcript_collection", "content_embedding_contract_id",
            "transcript_chunking_version", "transcript_projection_revision",
            "catalog_fields", "availability_fields", "lexical_fields",
            "transcript_fields", "owned_collections", "shared_collections",
            "state", "version", "deletion_progress"
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11,
            $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16::jsonb,
            $17::jsonb, $18, $19, $20::jsonb)
        `,
        ["retired-path", ...baseValues],
      )
      await client.query(`
        UPDATE "watch_search_candidate_generation"
        SET "state" = 'retiring', "version" = 2
        WHERE "id" = 'retired-path'
      `)
      await expect(
        client.query(`
          UPDATE "watch_search_candidate_generation"
          SET "state" = 'retired',
              "version" = 3,
              "retired_at" = now(),
              "deletion_progress" = '{"deletedCollections":["catalog","availability","lexical"]}'::jsonb
          WHERE "id" = 'retired-path'
        `),
      ).resolves.toMatchObject({ rowCount: 1 })
    })

    it("allows deploy on a fresh schema with no transcript rows when no legacy rows need backfill", async () => {
      const freshSchemaName = `candidate_trigger_empty_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`

      await client.query(`CREATE SCHEMA "${freshSchemaName}"`)
      await client.query(`SET search_path TO "${freshSchemaName}"`)

      try {
        await createLegacyCandidateTables(client)
        const migrationResult = await client.query(migrationSql)
        expect(queryCommands(migrationResult)).toContain("DO")

        const triggerNames = await client.query<{ tgname: string }>(`
          SELECT tgname
          FROM pg_trigger
          WHERE tgrelid = 'watch_search_candidate_generation'::regclass
            AND NOT tgisinternal
        `)
        expect(triggerNames.rows).toEqual([
          { tgname: "watch_search_candidate_generation_identity_guard" },
        ])

        const requiredColumns = await client.query<{
          table_name: string
          column_name: string
          is_nullable: "YES" | "NO"
        }>(`
          SELECT table_name, column_name, is_nullable
          FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name IN (
              'watch_search_candidate_generation',
              'watch_search_candidate_qualification',
              'watch_search_candidate_lease'
            )
            AND column_name IN (
              'content_embedding_contract_id',
              'transcript_chunking_version'
            )
          ORDER BY table_name, column_name
        `)

        expect(requiredColumns.rows).toEqual([
          {
            table_name: "watch_search_candidate_generation",
            column_name: "content_embedding_contract_id",
            is_nullable: "NO",
          },
          {
            table_name: "watch_search_candidate_generation",
            column_name: "transcript_chunking_version",
            is_nullable: "NO",
          },
          {
            table_name: "watch_search_candidate_lease",
            column_name: "content_embedding_contract_id",
            is_nullable: "NO",
          },
          {
            table_name: "watch_search_candidate_lease",
            column_name: "transcript_chunking_version",
            is_nullable: "NO",
          },
          {
            table_name: "watch_search_candidate_qualification",
            column_name: "content_embedding_contract_id",
            is_nullable: "NO",
          },
          {
            table_name: "watch_search_candidate_qualification",
            column_name: "transcript_chunking_version",
            is_nullable: "NO",
          },
        ])
      } finally {
        await client.query(`SET search_path TO "${schemaName}"`)
        await client.query(`DROP SCHEMA IF EXISTS "${freshSchemaName}" CASCADE`)
      }
    })
  },
)
