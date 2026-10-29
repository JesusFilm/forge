import { readFile } from "node:fs/promises"
import { Pool } from "pg"
import { expect, it } from "vitest"
import { createEnrichmentAdmissionStore } from "./enrichment-admission-store"

// Explicit disposable database only; never use runtime DATABASE_URL.
const url = process.env.ENRICHMENT_ADMISSION_TEST_DATABASE_URL
it.skipIf(!url)(
  "enforces digest binding and once-only starts across connections and restarts",
  async () => {
    const pool1 = new Pool({ connectionString: url, max: 4 })
    const pool2 = new Pool({ connectionString: url, max: 4 })
    try {
      await pool1.query(
        await readFile(
          new URL(
            "../../migrations/005-enrichment-admission.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      )
      const store1 = createEnrichmentAdmissionStore(pool1),
        store2 = createEnrichmentAdmissionStore(pool2)
      const runId = `test-${crypto.randomUUID()}`
      const admission = { runId, jobId: "job", inputDigest: "a".repeat(64) }
      await store1.reserve(admission)
      expect(
        await store2.claim({ ...admission, inputDigest: "b".repeat(64) }),
      ).toBe("conflict")
      expect(await store2.claim({ ...admission, jobId: "other-job" })).toBe(
        "conflict",
      )
      const claims = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          (i % 2 ? store1 : store2).claim(admission),
        ),
      )
      expect(claims.filter((status) => status === "claimed")).toHaveLength(1)
      expect(claims.filter((status) => status === "conflict")).toHaveLength(7)
      // A fresh adapter/process cannot replay a start after a crash while starting.
      expect(await createEnrichmentAdmissionStore(pool2).claim(admission)).toBe(
        "conflict",
      )
      await store1.finish(runId, "started")
      expect(await store2.claim(admission)).toBe("started")
      const ambiguous = { ...admission, runId: `${runId}-ambiguous` }
      await store2.reserve(ambiguous)
      expect(await store1.claim(ambiguous)).toBe("claimed")
      await store1.finish(ambiguous.runId, "ambiguous")
      expect(await store2.claim(ambiguous)).toBe("conflict")
      const expired = { ...admission, runId: `${runId}-expired` }
      await store1.reserve(expired)
      await pool1.query(
        "UPDATE enrichment_admission.runs SET accepted_at=now()-interval '25 hours' WHERE run_id=$1",
        [expired.runId],
      )
      expect(await store2.claim(expired)).toBe("conflict")
    } finally {
      await Promise.all([pool1.end(), pool2.end()])
    }
  },
)
