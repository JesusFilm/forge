import type { RecommendationCandidateContext } from "./candidate"
import type { OrderedCandidate } from "./ranker"

export type ComposedCandidate = OrderedCandidate &
  Readonly<{ composedPosition: number }>

export const RECOMMENDATION_RECENT_SUPPRESSION_REASON_CODES = [
  "recent_playback_start",
  "recent_selection",
  "repeatedly_served",
] as const
export type RecommendationRecentSuppressionReason =
  (typeof RECOMMENDATION_RECENT_SUPPRESSION_REASON_CODES)[number]

export type RecommendationSlateComposition = Readonly<{
  currentVideoId?: string | null
  recentVideos?: ReadonlyArray<
    Readonly<{
      targetMediaId: string
      reasonCodes: readonly RecommendationRecentSuppressionReason[]
    }>
  >
}>

export type RecommendationSlateSuppression = Readonly<{
  candidate: OrderedCandidate
  reasonCodes: ReadonlyArray<
    "current_video" | RecommendationRecentSuppressionReason
  >
}>

export type RecommendationSlateCompositionResult = Readonly<{
  composed: ComposedCandidate[]
  suppressions: RecommendationSlateSuppression[]
}>

export function composeMinimalSlate(
  ordered: readonly OrderedCandidate[],
  context: RecommendationCandidateContext,
  limit: number,
): ComposedCandidate[] {
  return composeRecommendationSlate(ordered, context, limit).composed
}

export function composeRecommendationSlate(
  ordered: readonly OrderedCandidate[],
  context: RecommendationCandidateContext,
  limit: number,
  composition: RecommendationSlateComposition = {},
): RecommendationSlateCompositionResult {
  const boundedLimit = Math.max(0, Math.min(6, Math.trunc(limit)))
  const seen = new Set<string>()
  const recentReasons = new Map(
    (composition.recentVideos ?? []).map((entry) => [
      entry.targetMediaId,
      [...new Set(entry.reasonCodes)],
    ]),
  )
  const composed: ComposedCandidate[] = []
  const suppressions: RecommendationSlateSuppression[] = []
  const recentRefill: OrderedCandidate[] = []
  for (const candidate of ordered) {
    if (composed.length >= boundedLimit) break
    if (seen.has(candidate.targetMediaId)) continue
    if (
      candidate.presentation.locale !== context.locale ||
      candidate.presentation.audioLanguageSlug !== context.audioLanguageSlug ||
      !candidate.presentation.watchPlayable ||
      !candidate.presentation.playbackId.trim()
    ) {
      continue
    }
    seen.add(candidate.targetMediaId)
    const reasonCodes = [
      ...(candidate.targetMediaId === composition.currentVideoId
        ? (["current_video"] as const)
        : []),
      ...(recentReasons.get(candidate.targetMediaId) ?? []),
    ]
    if (reasonCodes.length > 0) {
      suppressions.push({ candidate, reasonCodes })
      // The current Video is never eligible for refill. Recent-history
      // suppression is a composition preference: retain it as a deterministic
      // reserve so exact-six wins only after every fresh candidate is used.
      if (!reasonCodes.includes("current_video")) recentRefill.push(candidate)
      continue
    }
    composed.push({ ...candidate, composedPosition: composed.length })
  }
  for (const candidate of recentRefill) {
    if (composed.length >= boundedLimit) break
    composed.push({ ...candidate, composedPosition: composed.length })
  }
  return { composed, suppressions }
}
