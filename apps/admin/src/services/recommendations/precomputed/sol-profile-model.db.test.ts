import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { describe, expect, it } from "vitest"
import { env } from "@/config/env"

/** Disposable schema only; no server/production import or inference. */
describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "Sol subscription model migration",
  () => {
    it("admits both exact models and preserves old identities while refusing aliases", async () => {
      const db = new Client({ connectionString: env.DATABASE_URL })
      const schema = `sol_model_${randomUUID().replaceAll("-", "")}`
      await db.connect()
      try {
        await db.query(`CREATE SCHEMA "${schema}"`)
        await db.query(`SET search_path TO "${schema}", public`)
        // Original 0142/0144 table/column CHECK names and model predicate.
        for (const table of ["execution_attempt", "edge_batch_call"]) {
          await db.query(
            `CREATE TABLE recommendation_precomputed_${table} (id text PRIMARY KEY, model_id text NOT NULL CHECK (model_id = 'gpt-6-astra'))`,
          )
          await db.query(
            `INSERT INTO recommendation_precomputed_${table} VALUES ('historical', 'gpt-6-astra')`,
          )
        }
        await db.query(
          readFileSync(
            new URL(
              "../../../../prisma/migrations/0161_precomputed_sol_subscription_model/migration.sql",
              import.meta.url,
            ),
            "utf8",
          ),
        )
        for (const table of ["execution_attempt", "edge_batch_call"]) {
          await db.query(
            `INSERT INTO recommendation_precomputed_${table} VALUES ('new', 'gpt-6.1-sol')`,
          )
          await expect(
            db.query(
              `INSERT INTO recommendation_precomputed_${table} VALUES ('invalid', 'sol')`,
            ),
          ).rejects.toMatchObject({ code: "23514" })
          expect(
            (
              await db.query(
                `SELECT * FROM recommendation_precomputed_${table} ORDER BY id`,
              )
            ).rows,
          ).toEqual([
            { id: "historical", model_id: "gpt-6-astra" },
            { id: "new", model_id: "gpt-6.1-sol" },
          ])
        }
      } finally {
        await db.query("ROLLBACK")
        await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
        await db.end()
      }
    })
  },
)
