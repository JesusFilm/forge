import { Pool } from "pg"
import { env } from "../config/env"

export type Admission = { runId: string; jobId: string; inputDigest: string }
export type AdmissionClaim = "claimed" | "started" | "conflict"
export type EnrichmentAdmissionStore = {
  reserve(input: Admission): Promise<void>
  claim(input: Admission): Promise<AdmissionClaim>
  finish(runId: string, status: "started" | "ambiguous"): Promise<void>
}

/** PostgreSQL is authoritative across restarts/replicas. No memory fallback. */
export function createEnrichmentAdmissionStore(
  pool: Pick<Pool, "query">,
): EnrichmentAdmissionStore {
  return {
    async reserve(input) {
      await pool.query(
        "INSERT INTO enrichment_admission.runs (run_id,job_id,input_digest) VALUES ($1,$2,$3)",
        [input.runId, input.jobId, input.inputDigest],
      )
    },
    async claim(input) {
      const result = await pool.query(
        "UPDATE enrichment_admission.runs SET status='starting' WHERE run_id=$1 AND job_id=$2 AND input_digest=$3 AND status='accepted' AND accepted_at > now() - interval '24 hours' RETURNING run_id",
        [input.runId, input.jobId, input.inputDigest],
      )
      if (result.rowCount === 1) return "claimed"
      const existing = await pool.query<{ status: string }>(
        "SELECT status FROM enrichment_admission.runs WHERE run_id=$1 AND job_id=$2 AND input_digest=$3",
        [input.runId, input.jobId, input.inputDigest],
      )
      return existing.rows[0]?.status === "started" ? "started" : "conflict"
    },
    async finish(runId, status) {
      const updated = await pool.query(
        "UPDATE enrichment_admission.runs SET status=$2 WHERE run_id=$1 AND status='starting'",
        [runId, status],
      )
      if (updated.rowCount !== 1)
        throw new Error("Admission status was not starting")
    },
  }
}
let store: EnrichmentAdmissionStore | undefined
export function getEnrichmentAdmissionStore(): EnrichmentAdmissionStore {
  store ??= createEnrichmentAdmissionStore(
    new Pool({
      connectionString: env.DATABASE_URL,
      max: 3,
      connectionTimeoutMillis: 5_000,
      query_timeout: 10_000,
      statement_timeout: 10_000,
    }),
  )
  return store
}
