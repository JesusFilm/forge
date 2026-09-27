import type { Prisma } from "@prisma/client"

export const CANDIDATE_TRACE_FORMAT_VERSION = 1

export type CandidateEvidenceRow = Omit<
  Prisma.RecommendationCandidateStageEvidenceCreateManyInput,
  "id" | "createdAt" | "reasonCodes" | "sourceEvidence" | "expiresAt"
> & {
  id: string
  reasonCodes: string[]
  sourceEvidence: Prisma.InputJsonValue
  createdAt: Date
  expiresAt: Date
}

/** The payload retains each stage observation verbatim except run-owned
 * identity and expiry. Keeping named fields makes old/new detail comparable.
 */
export function candidateTracePayload(rows: readonly CandidateEvidenceRow[]) {
  const stages = rows.map(
    ({ runId: _runId, expiresAt: _expiresAt, ...row }) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }),
  )
  // JSON.stringify rejects values JSONB would otherwise silently turn into
  // null, including nonfinite scores nested inside source evidence.
  JSON.stringify(stages, (_key, value: unknown) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Candidate evidence requires finite numbers")
    }
    return value
  })
  return { stages }
}
