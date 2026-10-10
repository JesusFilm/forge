import type { Prisma } from "@prisma/client"
import { timeRecommendationOperation } from "@/lib/recommendation-runtime-observation"

type EvidenceRow = Omit<
  Prisma.RecommendationCandidateStageEvidenceCreateManyInput,
  "id" | "createdAt" | "reasonCodes" | "sourceEvidence" | "expiresAt"
> & {
  id: string
  reasonCodes: string[]
  sourceEvidence: Prisma.InputJsonValue
  expiresAt: Date
  createdAt?: Date
}

/** One bound payload avoids thousands of Prisma scalar argument conversions.
 * All FK, expiry, uniqueness and evidence checks remain inside the caller's
 * issuance transaction. This is not an asynchronous audit write.
 */
export async function persistCandidateStageEvidence(
  tx: Pick<Prisma.TransactionClient, "$executeRaw">,
  rows: readonly EvidenceRow[],
): Promise<number> {
  if (rows.length === 0) return 0
  return timeRecommendationOperation(
    "candidate_evidence.insert",
    async () => {
      // Prisma supplies @default(now()) at write construction. A database
      // default would instead use the earlier transaction-start timestamp.
      const createdAt = new Date()
      const payload = JSON.stringify(
        rows.map((row) => ({ ...row, createdAt: row.createdAt ?? createdAt })),
        (_key, value: unknown) => {
          // JSON would turn NaN/Infinity into null and evade nullable score checks.
          if (typeof value === "number" && !Number.isFinite(value)) {
            throw new TypeError("Candidate evidence requires finite numbers")
          }
          return value
        },
      )
      return tx.$executeRaw`
      INSERT INTO "recommendation_candidate_stage_evidence" (
        "id", "run_id", "stage", "ordinal", "candidate_key", "target_media_id",
        "source_generator", "source_rank", "source_score", "normalized_score",
        "rrf_score", "deterministic_score", "final_position", "reason_codes",
        "source_evidence", "expires_at", "created_at"
      )
      SELECT
        row."id", row."runId", row."stage", row."ordinal", row."candidateKey",
        row."targetMediaId", row."sourceGenerator", row."sourceRank",
        row."sourceScore", row."normalizedScore", row."rrfScore",
        row."deterministicScore", row."finalPosition", row."reasonCodes",
        row."sourceEvidence", row."expiresAt", row."createdAt"
      FROM jsonb_to_recordset(${payload}::jsonb) AS row(
        "id" text, "runId" text, "stage" text, "ordinal" integer,
        "candidateKey" text, "targetMediaId" text, "sourceGenerator" text,
        "sourceRank" integer, "sourceScore" double precision,
        "normalizedScore" double precision, "rrfScore" double precision,
        "deterministicScore" double precision, "finalPosition" integer,
        "reasonCodes" text[], "sourceEvidence" jsonb, "expiresAt" timestamptz, "createdAt" timestamptz
      )
    `
    },
    rows.length,
  )
}
