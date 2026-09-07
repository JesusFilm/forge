import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { expect, test } from "vitest"
import { env } from "../../config/env"
import { finishStudioExecution } from "./execution"

test.skipIf(!env.STUDIO_TEST_DATABASE_URL)(
  "terminal persistence cannot hang on a locked claim or write after its deadline",
  async () => {
    const url = env.STUDIO_TEST_DATABASE_URL
    if (url !== "postgresql://tataihono@127.0.0.1:55458/forge_studio_458_test")
      throw new Error("Dedicated458 database only")
    const pool = new Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 1000,
    })
    const id = `c${randomUUID().replaceAll("-", "")}`
    const blocker = await pool.connect()
    try {
      await pool.query(
        "INSERT INTO studio_agent_execution(id,instruction_digest) VALUES($1,$2)",
        [id, "a".repeat(64)],
      )
      await blocker.query("BEGIN")
      await blocker.query(
        "SELECT id FROM studio_agent_execution WHERE id=$1 FOR UPDATE",
        [id],
      )
      const started = performance.now()
      await expect(
        finishStudioExecution(pool, id, "completed", {
          signal: new AbortController().signal,
          timeoutMs: 200,
        }),
      ).rejects.toThrow()
      expect(performance.now() - started).toBeLessThan(2000)
      await blocker.query("ROLLBACK")
      expect(
        (
          await pool.query(
            "SELECT status FROM studio_agent_execution WHERE id=$1",
            [id],
          )
        ).rows[0].status,
      ).toBe("running")
      await finishStudioExecution(pool, id, "failed", {
        signal: new AbortController().signal,
        timeoutMs: 5000,
      })
      expect(
        (
          await pool.query(
            "SELECT status FROM studio_agent_execution WHERE id=$1",
            [id],
          )
        ).rows[0].status,
      ).toBe("failed")
    } finally {
      await blocker.query("ROLLBACK")
      blocker.release()
      await pool.query("DELETE FROM studio_agent_execution WHERE id=$1", [id])
      await pool.end()
    }
  },
)
