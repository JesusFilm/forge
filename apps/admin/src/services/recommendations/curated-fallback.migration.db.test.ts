import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "@/config/env"

describe.skipIf(env.RECOMMENDATION_DB_TEST !== "1")(
  "curated execution-mode migration",
  () => {
    const schema = `curated_mode_${randomUUID().replaceAll("-", "")}`
    let client: Client
    beforeAll(async () => {
      client = new Client({ connectionString: env.DATABASE_URL })
      await client.connect()
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`SET search_path TO "${schema}", public`)
      await client.query(`CREATE TABLE recommendation_personalization_decision (
      lane text NOT NULL, execution_mode text,
      CONSTRAINT recommendation_personalization_execution_mode_check CHECK (
        execution_mode IS NULL OR
        (lane = 'semantic_control' AND execution_mode = 'semantic_contextual') OR
        (lane = 'profile_challenger' AND execution_mode = 'hybrid_personalized') OR
        (lane = 'semantic_fallback' AND execution_mode = 'semantic_fallback')
      ))`)
      await client.query(`INSERT INTO recommendation_personalization_decision VALUES
      ('semantic_control', 'semantic_contextual'), ('profile_challenger', 'hybrid_personalized'),
      ('semantic_fallback', 'semantic_fallback'), ('profile_challenger', NULL)`)
      await client.query(
        readFileSync(
          new URL(
            "../../../prisma/migrations/0097_recommendation_curated_fallback_mode/migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      )
    })
    afterAll(async () => {
      if (!client) return
      await client.query("ROLLBACK")
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await client.end()
    })
    it("retains historic rows and permits curated delivery only in the fallback lane", async () => {
      expect(
        (
          await client.query(
            "SELECT count(*)::integer AS count FROM recommendation_personalization_decision",
          )
        ).rows,
      ).toEqual([{ count: 4 }])
      await client.query(
        "INSERT INTO recommendation_personalization_decision VALUES ('semantic_fallback', 'curated_fallback')",
      )
      for (const lane of ["semantic_control", "profile_challenger"])
        await expect(
          client.query(
            "INSERT INTO recommendation_personalization_decision VALUES ($1, 'curated_fallback')",
            [lane],
          ),
        ).rejects.toMatchObject({ code: "23514" })
      const constraints = await client.query(
        "SELECT convalidated FROM pg_constraint WHERE conrelid = 'recommendation_personalization_decision'::regclass AND conname = 'recommendation_personalization_execution_mode_check'",
      )
      expect(constraints.rows).toEqual([{ convalidated: true }])
    })
  },
)
