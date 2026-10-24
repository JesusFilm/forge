import { createVideoIdentityDuplicateReasonResolver } from "@/services/video-dedup"
import {
  MAX_CANDIDATE_SOURCE_CONTRIBUTIONS,
  type CandidateNomination,
  type CandidateSourceEvidence,
} from "./candidate"

export type CanonicalCandidate = Readonly<{
  candidateKey: string
  targetMediaId: string
  canonicalIdentity: CandidateNomination["canonicalIdentity"]
  nominations: CandidateNomination[]
  sources: CandidateSourceEvidence[]
  deduplicationReasons: string[]
}>

export type Canonicalization = Readonly<{
  nominationKey: string
  candidateKey: string
  targetMediaId: string
  reasonCode: string
}>

export type CandidateUnionResult = Readonly<{
  candidates: CanonicalCandidate[]
  canonicalizations: Canonicalization[]
}>

export function unionAndCanonicalizeCandidates(
  nominations: readonly CandidateNomination[],
): CandidateUnionResult {
  const candidates: CanonicalCandidate[] = []
  const canonicalizations: Canonicalization[] = []
  const duplicateReason = createVideoIdentityDuplicateReasonResolver()

  for (const nomination of nominations) {
    let duplicate:
      | { candidate: CanonicalCandidate; identityReason: string }
      | undefined
    for (const kept of candidates) {
      if (kept.canonicalIdentity.videoId === nomination.targetMediaId) {
        duplicate = {
          candidate: kept,
          identityReason: "canonical_video_id",
        }
        break
      }
      const reason = duplicateReason(
        nomination.canonicalIdentity,
        kept.canonicalIdentity,
      )
      if (reason) {
        duplicate = {
          candidate: kept,
          identityReason: `canonical_${reason}`,
        }
        break
      }
    }

    if (!duplicate) {
      const candidateKey = nomination.targetMediaId
      candidates.push({
        candidateKey,
        targetMediaId: nomination.targetMediaId,
        canonicalIdentity: nomination.canonicalIdentity,
        nominations: [nomination],
        sources: [nomination.source],
        deduplicationReasons: [],
      })
      canonicalizations.push({
        nominationKey: nomination.nominationKey,
        candidateKey,
        targetMediaId: nomination.targetMediaId,
        reasonCode: "canonical_video_id",
      })
      continue
    }

    const { candidate, identityReason } = duplicate
    ;(candidate.nominations as CandidateNomination[]).push(nomination)
    if (candidate.sources.length < MAX_CANDIDATE_SOURCE_CONTRIBUTIONS) {
      ;(candidate.sources as CandidateSourceEvidence[]).push(nomination.source)
    }
    if (!candidate.deduplicationReasons.includes(identityReason)) {
      ;(candidate.deduplicationReasons as string[]).push(identityReason)
    }
    canonicalizations.push({
      nominationKey: nomination.nominationKey,
      candidateKey: candidate.candidateKey,
      targetMediaId: nomination.targetMediaId,
      reasonCode: identityReason,
    })
  }

  return { candidates, canonicalizations }
}
