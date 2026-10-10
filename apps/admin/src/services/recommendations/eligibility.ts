import type {
  CandidateNomination,
  CandidatePresentation,
  RecommendationCandidateContext,
} from "./candidate"
import type { CanonicalCandidate } from "./union"

export type EligibleCandidate = CanonicalCandidate &
  Readonly<{
    selectedNomination: CandidateNomination
    presentation: CandidatePresentation
  }>

export type RejectedCandidate = Readonly<{
  candidate: CanonicalCandidate
  reasonCodes: string[]
}>

export type CandidateEligibilityResult = Readonly<{
  eligible: EligibleCandidate[]
  rejected: RejectedCandidate[]
}>

export function nominationEligibilityReasons(
  nomination: CandidateNomination,
  context: RecommendationCandidateContext,
): string[] {
  const reasons: string[] = []
  if (nomination.source.rejectionReason) {
    reasons.push(nomination.source.rejectionReason)
  }
  if (
    !nomination.presentation.localePublished ||
    nomination.presentation.locale !== context.locale
  ) {
    reasons.push("locale_unavailable")
  }
  if (nomination.presentation.audioLanguageSlug !== context.audioLanguageSlug) {
    reasons.push("audio_locale_unavailable")
  }
  if (!nomination.presentation.watchPlayable) {
    reasons.push("watch_restricted")
  }
  if (!nomination.presentation.playbackId.trim()) {
    reasons.push("playback_unavailable")
  }
  if (!nomination.presentation.imageUrl?.trim()) {
    reasons.push("image_unavailable")
  }
  return [...new Set(reasons)].slice(0, 16)
}

export function evaluateCandidateEligibility(
  candidates: readonly CanonicalCandidate[],
  context: RecommendationCandidateContext,
): CandidateEligibilityResult {
  const eligible: EligibleCandidate[] = []
  const rejected: RejectedCandidate[] = []

  for (const candidate of candidates) {
    const orderedNominations = [...candidate.nominations].sort(
      (left, right) =>
        left.source.rank - right.source.rank ||
        left.targetMediaId.localeCompare(right.targetMediaId),
    )
    const selectedNomination = orderedNominations.find(
      (nomination) =>
        nominationEligibilityReasons(nomination, context).length === 0,
    )
    if (selectedNomination) {
      eligible.push({
        ...candidate,
        candidateKey: selectedNomination.targetMediaId,
        targetMediaId: selectedNomination.targetMediaId,
        canonicalIdentity: selectedNomination.canonicalIdentity,
        selectedNomination,
        presentation: selectedNomination.presentation,
      })
      continue
    }
    rejected.push({
      candidate,
      reasonCodes: [
        ...new Set(
          orderedNominations.flatMap((nomination) =>
            nominationEligibilityReasons(nomination, context),
          ),
        ),
      ].slice(0, 16),
    })
  }

  return { eligible, rejected }
}
