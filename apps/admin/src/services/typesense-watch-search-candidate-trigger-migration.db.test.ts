import { readFileSync } from "node:fs"

import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const RUN_REAL_DB_TEST = process.env.WATCH_SEARCH_DB_TEST === "1"
const migrationSql = readFileSync(
  new URL(
    "../../prisma/migrations/0050_fix_watch_search_candidate_trigger_precedence/migration.sql",
    import.meta.url,
  ),
  "utf8",
)

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
          "deletion_progress" jsonb NOT NULL
        )
      `)
      await client.query(migrationSql)
      await client.query(`
        CREATE TRIGGER "watch_search_candidate_generation_identity_guard"
        BEFORE UPDATE ON "watch_search_candidate_generation"
        FOR EACH ROW
        EXECUTE FUNCTION "reject_watch_search_candidate_identity_update"()
      `)
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
            "transcript_collection", "transcript_projection_revision",
            "catalog_fields", "availability_fields", "lexical_fields",
            "transcript_fields", "owned_collections", "shared_collections",
            "state", "version", "deletion_progress"
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb,
            $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb,
            $16, $17, $18::jsonb)
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

      await client.query(
        `
          INSERT INTO "watch_search_candidate_generation" (
            "id", "application_revision", "source_epoch", "source_digests",
            "catalog_collection", "availability_collection", "lexical_collection",
            "transcript_collection", "transcript_projection_revision",
            "catalog_fields", "availability_fields", "lexical_fields",
            "transcript_fields", "owned_collections", "shared_collections",
            "state", "version", "deletion_progress"
          ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb,
            $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb,
            $16, $17, $18::jsonb)
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
  },
)
