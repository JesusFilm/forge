import {
  MAX_CANDIDATE_NOMINATIONS,
  type RecommendationCandidateContext,
} from "../candidate"
import type { OrderedCandidate } from "../ranker"
import { nominationEligibilityReasons } from "../eligibility"
import type {
  ComposedCandidate,
  RecommendationSlateComposition,
} from "../slate"

export const SHADOW_SLATE_POLICY_VERSION = "source-interest-theme-mmr-shadow-v1"

/** Canonical IDs supplied by a published editorial adapter, never inferred. */
export type ShadowSlateEditorial =
  | Readonly<{ mode: "fixed"; targetMediaIds: readonly string[] }>
  | Readonly<{
      mode: "approved_pool"
      approvedMediaIds: readonly string[]
    }>
  | Readonly<{
      mode: "pinned_fill"
      approvedMediaIds: readonly string[]
      pins: ReadonlyArray<Readonly<{ targetMediaId: string; position: number }>>
    }>

export type ShadowSlateItemEvidence = Readonly<{
  candidateKey: string
  targetMediaId: string
  orderedPosition: number
  composedPosition: number | null
  reasonCodes: string[]
  score: number | null
  themeSimilarity: number | null
  sourceGain: number
  interestGain: number
}>

export type ShadowSlateResult = Readonly<{
  policyVersion: string
  decision: "pending"
  fallbackReason: string | null
  composed: ComposedCandidate[]
  evidence: ShadowSlateItemEvidence[]
  coverage: Readonly<{
    sources: number
    availableSources: number
    interests: number
    availableInterests: number
    recentItems: number
    itemsWithThemes: number
  }>
}>

/**
 * A row-only counterfactual. No live caller, profile mutation, or promotion path.
 * Weights are a versioned hypothesis requiring calibration and a separate
 * terminal decision. Missing theme labels provide no similarity evidence.
 */
export function composeShadowSlate(input: {
  ordered: readonly OrderedCandidate[]
  context: RecommendationCandidateContext
  limit: number
  composition?: RecommendationSlateComposition
  editorial?: ShadowSlateEditorial
  policyVersion?: string
}): ShadowSlateResult {
  const limit = Number.isFinite(input.limit)
    ? Math.max(0, Math.min(6, Math.trunc(input.limit)))
    : 0
  const ordered = input.ordered.slice(0, MAX_CANDIDATE_NOMINATIONS)
  const policyVersion = (
    input.policyVersion ?? SHADOW_SLATE_POLICY_VERSION
  ).slice(0, 64)
  let fallbackReason: string | null =
    policyVersion === SHADOW_SLATE_POLICY_VERSION ? null : "policy_unavailable"
  const evidence = new Map<string, ShadowSlateItemEvidence>()
  const recent = new Map(
    (input.composition?.recentVideos ?? [])
      .slice(0, MAX_CANDIDATE_NOMINATIONS)
      .filter((entry) => entry.reasonCodes.length > 0)
      .map((entry) => [entry.targetMediaId, entry.reasonCodes]),
  )
  const approved =
    input.editorial == null
      ? null
      : new Set(
          (input.editorial.mode === "fixed"
            ? input.editorial.targetMediaIds
            : input.editorial.approvedMediaIds
          ).slice(0, MAX_CANDIDATE_NOMINATIONS),
        )
  const seen = new Set<string>()
  const candidates = ordered.filter((candidate) => {
    const reasons: string[] = []
    if (seen.has(candidate.targetMediaId)) reasons.push("duplicate_video")
    seen.add(candidate.targetMediaId)
    if (candidate.targetMediaId === input.composition?.currentVideoId)
      reasons.push("current_video")
    if (
      nominationEligibilityReasons(candidate.selectedNomination, input.context)
        .length > 0
    )
      reasons.push("eligibility_mismatch")
    if (approved && !approved.has(candidate.targetMediaId))
      reasons.push("outside_approved_pool")
    evidence.set(candidate.candidateKey, {
      candidateKey: candidate.candidateKey,
      targetMediaId: candidate.targetMediaId,
      orderedPosition: candidate.orderedPosition,
      composedPosition: null,
      reasonCodes: reasons.length
        ? reasons
        : recent.has(candidate.targetMediaId)
          ? [
              ...(recent.get(candidate.targetMediaId) ?? []),
              "recent_history_deferred",
            ]
          : ["outside_row_limit"],
      score: null,
      themeSimilarity: null,
      sourceGain: 0,
      interestGain: 0,
    })
    return reasons.length === 0
  })
  const candidateById = new Map(
    candidates.map((candidate) => [candidate.targetMediaId, candidate]),
  )
  const composed: ComposedCandidate[] = []
  const usedSources = new Set<string>()
  const usedInterests = new Set<string>()
  const pins = new Map<number, OrderedCandidate>()
  if (
    input.editorial &&
    !validEditorial(input.editorial, limit, candidateById)
  ) {
    fallbackReason = "editorial_constraints_unavailable"
    for (const candidate of candidates) {
      updateEvidence(candidate, [fallbackReason])
    }
    return result()
  }
  if (input.editorial?.mode === "pinned_fill") {
    for (const pin of input.editorial.pins) {
      const candidate = candidateById.get(pin.targetMediaId)
      if (candidate) pins.set(pin.position, candidate)
    }
  }
  const reserved = new Set(
    [...pins.values()].map((candidate) => candidate.targetMediaId),
  )
  const remaining = new Map(
    candidates.map((candidate) => [candidate.targetMediaId, candidate]),
  )

  if (input.editorial?.mode === "fixed") {
    for (const targetMediaId of input.editorial.targetMediaIds.slice(
      0,
      limit,
    )) {
      const candidate = candidateById.get(targetMediaId)
      if (candidate) select(candidate, ["fixed_editorial_order"])
    }
  } else {
    while (composed.length < limit && remaining.size > 0) {
      const pinned = pins.get(composed.length)
      if (pinned) {
        select(pinned, ["editorial_pin"])
        continue
      }
      const available = [...remaining.values()].filter(
        (candidate) => !reserved.has(candidate.targetMediaId),
      )
      const fresh = available.filter(
        (candidate) => !recent.has(candidate.targetMediaId),
      )
      const pool = fresh.length ? fresh : available
      if (!pool.length) break
      const scored = pool.map((candidate) => ({
        candidate,
        ...features(candidate),
      }))
      if (!fallbackReason)
        scored.sort(
          (left, right) =>
            right.score - left.score ||
            left.candidate.orderedPosition - right.candidate.orderedPosition ||
            left.candidate.targetMediaId.localeCompare(
              right.candidate.targetMediaId,
            ),
        )
      const chosen = scored[0]
      if (!chosen) break
      select(chosen.candidate, [
        fallbackReason
          ? "deterministic_rank_fallback"
          : "mmr_source_interest_coverage",
      ])
    }
  }
  if (composed.length < limit && !fallbackReason)
    fallbackReason = "sparse_eligible_pool"
  return result()

  function updateEvidence(
    candidate: OrderedCandidate,
    reasonCodes: string[],
    values: Partial<ShadowSlateItemEvidence> = {},
  ) {
    const prior = evidence.get(candidate.candidateKey)
    if (prior)
      evidence.set(candidate.candidateKey, { ...prior, reasonCodes, ...values })
  }

  function features(candidate: OrderedCandidate) {
    const themeSimilarity = composed.reduce(
      (maximum, selected) =>
        Math.max(
          maximum,
          similarity(
            candidate.presentation.themes,
            selected.presentation.themes,
          ),
        ),
      0,
    )
    const sources = sourceKeys(candidate)
    const interests = interestKeys(candidate)
    const sourceGain = sources.filter(
      (source) => !usedSources.has(source),
    ).length
    const interestGain = interests.filter(
      (interest) => !usedInterests.has(interest),
    ).length
    return {
      themeSimilarity,
      sourceGain,
      interestGain,
      score: round(
        0.75 * finiteScore(candidate.deterministicScore) -
          0.2 * themeSimilarity +
          (0.025 * sourceGain) / Math.max(1, sources.length) +
          (0.025 * interestGain) / Math.max(1, interests.length),
      ),
    }
  }

  function select(candidate: OrderedCandidate, reasonCodes: string[]) {
    const values = features(candidate)
    const composedPosition = composed.length
    const recentReasons = recent.get(candidate.targetMediaId)
    updateEvidence(
      candidate,
      [
        ...reasonCodes,
        ...(recentReasons
          ? [
              ...recentReasons,
              reasonCodes.includes("editorial_pin") ||
              reasonCodes.includes("fixed_editorial_order")
                ? "editorial_overrides_recent_preference"
                : "recent_history_refill",
            ]
          : []),
        candidate.orderedPosition === composedPosition
          ? "position_retained"
          : "position_moved",
      ],
      { ...values, composedPosition },
    )
    composed.push({ ...candidate, composedPosition })
    remaining.delete(candidate.targetMediaId)
    sourceKeys(candidate).forEach((source) => usedSources.add(source))
    interestKeys(candidate).forEach((interest) => usedInterests.add(interest))
  }

  function result(): ShadowSlateResult {
    return {
      policyVersion,
      decision: "pending",
      fallbackReason,
      composed,
      evidence: [...evidence.values()],
      coverage: {
        sources: usedSources.size,
        availableSources: new Set(candidates.flatMap(sourceKeys)).size,
        interests: usedInterests.size,
        availableInterests: new Set(candidates.flatMap(interestKeys)).size,
        recentItems: composed.filter((candidate) =>
          recent.has(candidate.targetMediaId),
        ).length,
        itemsWithThemes: composed.filter(
          (candidate) => themeSet(candidate.presentation.themes).size > 0,
        ).length,
      },
    }
  }
}

function validEditorial(
  editorial: ShadowSlateEditorial,
  limit: number,
  candidates: ReadonlyMap<string, OrderedCandidate>,
): boolean {
  const ids =
    editorial.mode === "fixed"
      ? editorial.targetMediaIds
      : editorial.approvedMediaIds
  if (
    ids.length > MAX_CANDIDATE_NOMINATIONS ||
    new Set(ids).size !== ids.length
  )
    return false
  if (editorial.mode === "fixed")
    return ids.slice(0, limit).every((id) => candidates.has(id))
  if (editorial.mode !== "pinned_fill") return true
  return (
    editorial.pins.length <= limit &&
    new Set(editorial.pins.map((pin) => pin.position)).size ===
      editorial.pins.length &&
    new Set(editorial.pins.map((pin) => pin.targetMediaId)).size ===
      editorial.pins.length &&
    editorial.pins.every(
      (pin) =>
        Number.isInteger(pin.position) &&
        pin.position >= 0 &&
        pin.position < Math.min(limit, candidates.size) &&
        candidates.has(pin.targetMediaId),
    )
  )
}

function sourceKeys(candidate: OrderedCandidate): string[] {
  return [
    ...new Set(
      candidate.sources
        .filter((source) => source.rejectionReason == null)
        .map((source) => source.generator),
    ),
  ]
}

function interestKeys(candidate: OrderedCandidate): string[] {
  return [
    ...new Set(
      candidate.sources.flatMap((source) => {
        const ordinal = source.evidence.interestOrdinal
        const kind = source.evidence.interestKind
        return source.rejectionReason == null &&
          source.generator === "multi-interest-profile" &&
          typeof ordinal === "number" &&
          Number.isInteger(ordinal) &&
          ordinal >= 0 &&
          ordinal <= 4 &&
          (kind === "durable" || kind === "session")
          ? [`${kind}:${ordinal}`]
          : []
      }),
    ),
  ]
}

function themeSet(themes: readonly string[]): Set<string> {
  return new Set(
    themes
      .slice(0, 16)
      .map((theme) => theme.slice(0, 64).trim().toLowerCase())
      .filter(Boolean),
  )
}

function similarity(left: readonly string[], right: readonly string[]): number {
  const a = themeSet(left)
  const b = themeSet(right)
  const union = new Set([...a, ...b])
  return union.size === 0
    ? 0
    : [...a].filter((theme) => b.has(theme)).length / union.size
}

function finiteScore(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}
