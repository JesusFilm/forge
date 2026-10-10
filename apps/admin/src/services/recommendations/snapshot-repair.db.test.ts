import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"

const RUN_REAL_DB_TEST = env.RECOMMENDATION_DB_TEST === "1"
const repairSql = [
  "0066_recommendation_playback_finalization_repair",
  "0067_recommendation_episode_submission_budget_repair",
  "0068_recommendation_trace_actor_digest_repair",
].map((migration) =>
  readFileSync(
    new URL(
      `../../../prisma/migrations/${migration}/migration.sql`,
      import.meta.url,
    ),
    "utf8",
  ),
)

describe.skipIf(!RUN_REAL_DB_TEST)(
  "recommendation historical snapshot repairs against real PostgreSQL",
  () => {
    const schemaName = `recommendation_snapshot_repair_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`
    const expiresAt = "2026-09-17T00:00:00.000Z"
    const legacyActorId = "legacy-admin@example.org"
    let client: Client

    beforeAll(async () => {
      client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schemaName}"`)
      await client.query(`SET search_path TO "${schemaName}", public`)

      // These definitions intentionally model the historical, incomplete
      // snapshot. Do not apply the finalized 0052 migration in this fixture:
      // doing so would pre-create every object that these migrations repair.
      await client.query(`
        CREATE TABLE recommendation_playback_episode (
          id text PRIMARY KEY,
          request_id text NOT NULL,
          capability_jti varchar(191),
          generation integer NOT NULL DEFAULT 1,
          active_until timestamptz NOT NULL,
          expires_at timestamptz NOT NULL
        );

        CREATE TABLE recommendation_capability_submission_budget (
          capability_jti varchar(191) PRIMARY KEY,
          request_id text NOT NULL,
          attempts integer NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL
        );

        CREATE TABLE recommendation_evidence_audit (
          id text PRIMARY KEY,
          request_id text NOT NULL,
          kind text NOT NULL,
          reason_code varchar(64) NOT NULL,
          count integer NOT NULL DEFAULT 1,
          occurred_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL
        );

        CREATE TABLE recommendation_trace_access_audit (
          id text PRIMARY KEY,
          request_id text,
          actor_id text NOT NULL,
          reason_code varchar(64) NOT NULL,
          accessed_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL
        );

        CREATE FUNCTION consume_recommendation_episode_capability_submissions(
          root_request_id text,
          root_episode_id text,
          token_jti varchar(191),
          submission_attempts integer,
          submission_limit integer,
          root_expires_at timestamptz
        ) RETURNS integer LANGUAGE sql AS $$ SELECT -1 $$;
      `)

      await client.query(
        `INSERT INTO recommendation_playback_episode (
          id, request_id, capability_jti, active_until, expires_at
        ) VALUES (
          'legacy-episode', 'legacy-request', 'legacy-episode-jti',
          '2026-08-26T12:10:00.000Z', $1
        )`,
        [expiresAt],
      )
      await client.query(
        `INSERT INTO recommendation_trace_access_audit (
          id, request_id, actor_id, reason_code, expires_at
        ) VALUES
          ('legacy-audit-1', 'legacy-request', $1, 'support_trace', $2),
          ('legacy-audit-2', 'legacy-request', $1, 'support_trace', $2)`,
        [legacyActorId, expiresAt],
      )

      for (const migration of repairSql) await client.query(migration)
    })

    afterAll(async () => {
      if (!client) return
      await client.query("RESET search_path")
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
      await client.end()
    })

    it("repairs the missing finalization deadline and recovery index", async () => {
      const column = await client.query(
        `SELECT data_type
         FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name = 'recommendation_playback_episode'
           AND column_name = 'finalization_due_at'`,
        [schemaName],
      )
      expect(column.rows).toEqual([{ data_type: "timestamp with time zone" }])

      const index = await client.query(
        `SELECT indexdef
         FROM pg_indexes
         WHERE schemaname = $1
           AND indexname = 'recommendation_episode_finalization_due_idx'`,
        [schemaName],
      )
      expect(index.rows).toHaveLength(1)
      expect(index.rows[0]?.indexdef).toContain(
        "finalization_due_at, id) INCLUDE (generation, active_until, expires_at)",
      )
      expect(index.rows[0]?.indexdef).toContain(
        "WHERE (finalization_due_at IS NOT NULL)",
      )
    })

    it("replaces the older episode submission budget function", async () => {
      const result = await client.query<{ attempts: number | null }>(
        `SELECT consume_recommendation_episode_capability_submissions(
          'legacy-request', 'legacy-episode', 'legacy-episode-jti',
          2, 256, $1
        ) AS attempts`,
        [expiresAt],
      )
      expect(result.rows).toEqual([{ attempts: 2 }])

      const budget = await client.query(
        `SELECT request_id, attempts
         FROM recommendation_capability_submission_budget
         WHERE capability_jti = 'legacy-episode-jti'`,
      )
      expect(budget.rows).toEqual([
        { request_id: "legacy-request", attempts: 2 },
      ])
    })

    it("retains audit rows while replacing raw actors with unlinkable pseudonyms", async () => {
      const columns = await client.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name = 'recommendation_trace_access_audit'
           AND column_name IN ('actor_id', 'actor_digest')
         ORDER BY column_name`,
        [schemaName],
      )
      expect(columns.rows).toEqual([{ column_name: "actor_digest" }])

      const audits = await client.query<{
        actor_digest: string
        id: string
      }>(
        `SELECT id, actor_digest
         FROM recommendation_trace_access_audit
         ORDER BY id`,
      )
      expect(audits.rows).toHaveLength(2)
      const rawSha256 = createHash("sha256").update(legacyActorId).digest("hex")
      for (const audit of audits.rows) {
        expect(audit.actor_digest).toMatch(/^[a-f0-9]{64}$/)
        expect(audit.actor_digest).not.toBe(legacyActorId)
        expect(audit.actor_digest).not.toBe(rawSha256)
      }
      expect(audits.rows[0]?.actor_digest).not.toBe(
        audits.rows[1]?.actor_digest,
      )
    })
  },
)
