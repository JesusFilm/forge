import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Client } from "pg"
import { describe, expect, it } from "vitest"
import { LIVE_POLICY_MIGRATION } from "./live-policy-migration-recovery"

describe.skipIf(process.env.RECOMMENDATION_DB_TEST !== "1")(
  "live policy migration checkpoints in PostgreSQL",
  () => {
    it("replays a partial metadata commit, validates alongside writers and refuses conflicting seed data", async () => {
      const url = new URL(process.env.DATABASE_URL!)
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/forge_test" ||
        url.search ||
        url.hash
      )
        throw new Error("Owned loopback forge_test fixture required")
      const client = new Client({
        connectionString: url.toString(),
        statement_timeout: 20_000,
      })
      const writer = new Client({
        connectionString: url.toString(),
        statement_timeout: 20_000,
      })
      const schema = `live_policy_${randomUUID().replaceAll("-", "")}`
      await client.connect()
      await writer.connect()
      try {
        await client.query(`CREATE SCHEMA ${schema}`)
        await client.query(`SET search_path TO ${schema}`)
        await client.query(
          `CREATE TABLE recommendation_strategy_manifest (LIKE public.recommendation_strategy_manifest INCLUDING ALL)`,
        )
        await client.query(
          `CREATE TABLE recommendation_personalization_decision (LIKE public.recommendation_personalization_decision INCLUDING ALL)`,
        )
        const sql = await readFile(
          new URL(
            `../../prisma/migrations/${LIVE_POLICY_MIGRATION}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        )
        const checkpoint = sql.indexOf("\nCOMMIT;") + "\nCOMMIT;".length
        expect(checkpoint).toBeGreaterThan(10)
        await client.query(sql.slice(0, checkpoint))
        const constraints = async () =>
          (
            await client.query<{ convalidated: boolean }>(`
          SELECT convalidated FROM pg_constraint
          WHERE conrelid = '${schema}.recommendation_personalization_decision'::regclass
            AND conname IN ('recommendation_personalization_execution_mode_check', 'recommendation_personalization_projection_check')
          ORDER BY conname
        `)
          ).rows.map((row) => row.convalidated)
        expect(await constraints()).toEqual([false, false])
        // This table lock represents an ordinary write transaction. Validation
        // must proceed after metadata releases ACCESS EXCLUSIVE.
        await writer.query(
          `BEGIN; LOCK TABLE ${schema}.recommendation_personalization_decision IN ROW EXCLUSIVE MODE`,
        )
        await client.query(sql.slice(checkpoint))
        expect(await constraints()).toEqual([true, true])
        await writer.query("COMMIT")
        await client.query(sql)
        expect(await constraints()).toEqual([true, true])
        expect(
          (
            await client.query(
              "SELECT count(*)::int AS count FROM recommendation_strategy_manifest",
            )
          ).rows[0]?.count,
        ).toBe(3)
        await client.query(
          "UPDATE recommendation_strategy_manifest SET enabled = false WHERE id = 'hybrid-profile-viewing-mode-v1'",
        )
        await expect(client.query(sql)).rejects.toThrow(
          "does not match the exact registry",
        )
        await client.query("ROLLBACK")
        expect(
          (
            await client.query(
              "SELECT enabled FROM recommendation_strategy_manifest WHERE id = 'hybrid-profile-viewing-mode-v1'",
            )
          ).rows[0]?.enabled,
        ).toBe(false)
      } finally {
        await writer.query("ROLLBACK").catch(() => undefined)
        await client.query("ROLLBACK").catch(() => undefined)
        await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
        await Promise.all([client.end(), writer.end()])
      }
    }, 30_000)
  },
)
