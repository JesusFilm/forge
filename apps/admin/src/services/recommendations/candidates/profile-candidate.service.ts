import type { CandidateNomination } from "../candidate"

/** Historical comparison shape. Profile retrieval was retired with its tables. */
export type LiveProfileCandidateResult = Readonly<{
  projection: Readonly<{
    id: string
    scope?: "durable" | "session"
    generation?: number
    projectionVersion: string
    inputDigest: string
    publishedAt: Date
    expiresAt: Date
    cohortQuality: number
    sessionIntentPresent?: boolean
    interestCount: number
    qualifiedInterestCount?: number
  }>
  nominations: CandidateNomination[]
}>
