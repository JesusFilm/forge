import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { Client } from "pg"
import { describe, expect, it } from "vitest"
import { env } from "@/config/env"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "Watch served migration lock safety",
  () => {
    it("rolls back on contention, then applies the constraint and unique index atomically", async () => {
      const schema = `watch_migration_${randomUUID().replaceAll("-", "")}`
      const admin = new Client({ connectionString: env.DATABASE_URL })
      const blocker = new Client({ connectionString: env.DATABASE_URL })
      await admin.connect()
      await blocker.connect()
      const migration = await readFile(
        new URL(
          "../../../prisma/migrations/0105_watch_surface_served_manifest/migration.sql",
          import.meta.url,
        ),
        "utf8",
      )
      try {
        await admin.query(`CREATE SCHEMA "${schema}"`)
        await admin.query(`SET search_path TO "${schema}"`)
        await admin.query(`CREATE TABLE watch_surface_exposure (
          window_id uuid NOT NULL, position integer NOT NULL, item_path text NOT NULL,
          kind text NOT NULL, policy_version text NOT NULL, visibility_capability text,
          CONSTRAINT watch_surface_exposure_kind_check CHECK (kind IN ('rendered', 'eligible', 'selected'))
        )`)
        await blocker.query("BEGIN")
        await blocker.query(
          `LOCK TABLE "${schema}".watch_surface_exposure IN ACCESS SHARE MODE`,
        )
        const started = Date.now()
        await expect(admin.query(migration)).rejects.toMatchObject({
          code: "55P03",
        })
        expect(Date.now() - started).toBeLessThan(5_000)
        await admin.query("ROLLBACK")
        await blocker.query("ROLLBACK")
        const constraint =
          await admin.query(`SELECT pg_get_constraintdef(oid) AS definition
          FROM pg_constraint WHERE conrelid = 'watch_surface_exposure'::regclass`)
        expect(constraint.rows[0].definition).not.toContain("served")
        expect(
          (
            await admin.query(
              "SELECT to_regclass('watch_surface_exposure_served_item_key') AS index",
            )
          ).rows[0].index,
        ).toBeNull()

        await admin.query(migration)
        const insert = `INSERT INTO watch_surface_exposure VALUES
          ('00000000-0000-4000-8000-000000000001', 0, '/watch/public.html', $1, $2, $3)`
        await expect(
          admin.query(insert, ["served", "watch-exposure-v1", null]),
        ).rejects.toMatchObject({ code: "23514" })
        await expect(
          admin.query(insert, ["served", "watch-exposure-v2", "unknown"]),
        ).rejects.toMatchObject({ code: "23514" })
        await admin.query(insert, ["served", "watch-exposure-v2", null])
        await expect(
          admin.query(insert, ["served", "watch-exposure-v2", null]),
        ).rejects.toMatchObject({ code: "23505" })
        await admin.query(insert, ["rendered", "watch-exposure-v2", null])
        await admin.query(insert, ["rendered", "watch-exposure-v2", null])
      } finally {
        await blocker.query("ROLLBACK")
        await admin.query("ROLLBACK")
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await Promise.all([blocker.end(), admin.end()])
      }
    })
  },
)
