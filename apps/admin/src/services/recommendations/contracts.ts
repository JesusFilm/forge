import { z } from "zod"

/** Stable, intentionally small public and persisted contract identifiers. */
export const RECOMMENDATION_CONTRACTS = {
  delivery: "semantic-recommendation-v1",
  evidence: "recommendation-evidence-v1",
  playbackContext: "recommendation-playback-context-v1",
  surface: "watch-below-player-v1",
  strategy: "semantic-transcript-pgvector-v1",
  outcome: "legacy-position-v0",
} as const

export const ACTIVE_WATCH_PROXY_VERSION = "active-watch-proxy-v1" as const
export const RECOMMENDATION_CONTENT_ACTION_CONTRACT =
  "recommendation-content-action-v1" as const
export const RECOMMENDATION_PROFILE_CONTRACT =
  "recommendation-profile-v1" as const
export const RECOMMENDATION_PROFILE_SESSION_LINK_HOURS = 24

export const MAX_DELIVERY_ITEMS = 6
export const MAX_DELIVERY_RESPONSE_BYTES = 64 * 1024
export const MAX_EVIDENCE_REQUEST_BYTES = 8 * 1024
export const MAX_EVIDENCE_EVENTS = 16
export const MAX_EPISODE_FACTS = 128
export const MAX_RECOMMENDATION_CONTRIBUTORS = 16
export const DELIVERY_RETRIEVAL_BUDGET_MS = 1_500
export const WATCH_LAZY_BOUNDARY_BUDGET_MS = 2_000
export const CANDIDATE_POOL_TTL_SECONDS = 60
export const RECOMMENDATION_RAW_RETENTION_DAYS = 29
export const RECOMMENDATION_RETENTION_PROPAGATION_HOURS = 24
export const RECOMMENDATION_RETENTION_HARD_CEILING_DAYS = 30

export const RecommendationPlaybackSourceSchema = z.enum([
  "recommendation",
  "search",
  "share",
  "acquisition",
  "editorial",
  "direct",
])
export type RecommendationPlaybackSource = z.infer<
  typeof RecommendationPlaybackSourceSchema
>

export const RecommendationPlaybackContextInputSchema = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_CONTRACTS.playbackContext),
    sessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    mediaId: z.string().min(1).max(191),
    idempotencyKey: z.string().min(16).max(191),
    source: RecommendationPlaybackSourceSchema,
    sourceRef: z.string().min(1).max(191).optional(),
    claimNonce: z.string().min(16).max(191).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      (input.source === "recommendation" && input.claimNonce == null) ||
      (input.source !== "recommendation" && input.claimNonce != null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Recommendation playback provenance is invalid",
      })
    }
  })

export const RecommendationEvidenceKind = z.enum([
  "render",
  "impression",
  "selection",
  "playback_attempt",
  "playback_start",
  "playback_progress",
  "playback_seek",
  "playback_active_visible_playing",
  "playback_end",
  "playback_error",
])
export type RecommendationEvidenceKind = z.infer<
  typeof RecommendationEvidenceKind
>

export const TERMINAL_RECOMMENDATION_FACT_KINDS = [
  "playback_end",
  "playback_error",
] as const satisfies readonly RecommendationEvidenceKind[]

export type TerminalRecommendationFactKind =
  (typeof TERMINAL_RECOMMENDATION_FACT_KINDS)[number]

export function isTerminalRecommendationFactKind(
  kind: string,
): kind is TerminalRecommendationFactKind {
  return (TERMINAL_RECOMMENDATION_FACT_KINDS as readonly string[]).includes(
    kind,
  )
}

const boundedIdentifier = z.string().min(1).max(191)
const isoDate = z.string().datetime({ offset: true })

/**
 * `lane` is the immutable compatibility label introduced with experiment
 * delivery. It does not imply a live assignment; `executionMode` is the
 * additive execution truth and must never be inferred for historic rows.
 */
export const RecommendationAssignmentLaneSchema = z.enum([
  "semantic_control",
  "profile_challenger",
  "semantic_fallback",
])
export type RecommendationAssignmentLane = z.infer<
  typeof RecommendationAssignmentLaneSchema
>

export const RecommendationExecutionModeSchema = z.enum([
  "semantic_contextual",
  "hybrid_personalized",
  "semantic_fallback",
])
export type RecommendationExecutionMode = z.infer<
  typeof RecommendationExecutionModeSchema
>

export const RecommendationShortfallReasonSchema = z.enum([
  "insufficient_candidates",
  "seed_material_unavailable",
  "eligibility_exhausted",
  "deadline_exhausted",
])
export type RecommendationShortfallReason = z.infer<
  typeof RecommendationShortfallReasonSchema
>

export const RecommendationCandidateContributorSchema = z
  .object({
    generator: z.string().min(1).max(64),
    generatorVersion: z.string().min(1).max(64),
    rank: z.number().int().min(1).max(64),
  })
  .strict()
export type RecommendationCandidateContributor = z.infer<
  typeof RecommendationCandidateContributorSchema
>

const RecommendationDeliveryItemAdditiveSchema = z
  .object({
    contributors: z
      .array(RecommendationCandidateContributorSchema)
      .max(MAX_RECOMMENDATION_CONTRIBUTORS)
      .optional(),
  })
  .passthrough()

/**
 * Compatibility parser for the additive fields on semantic-recommendation-v1.
 * Older responses intentionally omit every new field. In particular, a
 * historic `profile_challenger` lane does not acquire hybrid semantics merely
 * by being parsed by newer code.
 */
export const RecommendationDeliveryAdditiveMetadataSchema = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_CONTRACTS.delivery),
    requestedCount: z.number().int().min(0).max(MAX_DELIVERY_ITEMS).optional(),
    composedCount: z.number().int().min(0).max(MAX_DELIVERY_ITEMS).optional(),
    shortfallReason: RecommendationShortfallReasonSchema.nullable().optional(),
    personalization: z
      .object({
        lane: RecommendationAssignmentLaneSchema,
        executionMode: RecommendationExecutionModeSchema.optional(),
      })
      .passthrough()
      .optional(),
    items: z.array(RecommendationDeliveryItemAdditiveSchema),
  })
  .passthrough()
  .superRefine((delivery, context) => {
    const countFieldsPresent = [
      delivery.requestedCount,
      delivery.composedCount,
    ].filter((value) => value != null).length
    if (countFieldsPresent === 1) {
      context.addIssue({
        code: "custom",
        message: "Recommendation counts must be added as one contract unit",
      })
    }
    if (
      delivery.requestedCount != null &&
      delivery.composedCount != null &&
      delivery.composedCount > delivery.requestedCount
    ) {
      context.addIssue({
        code: "custom",
        message: "Composed recommendation count exceeds requested count",
      })
    }
    if (
      delivery.requestedCount != null &&
      delivery.composedCount != null &&
      ((delivery.composedCount < delivery.requestedCount &&
        delivery.shortfallReason == null) ||
        (delivery.composedCount === delivery.requestedCount &&
          delivery.shortfallReason != null))
    ) {
      context.addIssue({
        code: "custom",
        message: "Recommendation shortfall reason disagrees with counts",
      })
    }
    if (
      delivery.composedCount != null &&
      delivery.composedCount !== delivery.items.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Composed recommendation count disagrees with response items",
      })
    }
    const personalization = delivery.personalization
    if (
      personalization?.executionMode != null &&
      !(
        (personalization.lane === "semantic_control" &&
          personalization.executionMode === "semantic_contextual") ||
        (personalization.lane === "profile_challenger" &&
          personalization.executionMode === "hybrid_personalized") ||
        (personalization.lane === "semantic_fallback" &&
          personalization.executionMode === "semantic_fallback")
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Recommendation assignment lane and execution mode disagree",
      })
    }
  })

export function boundedRecommendationContributors(
  contributors: readonly RecommendationCandidateContributor[],
): RecommendationCandidateContributor[] {
  const accepted: RecommendationCandidateContributor[] = []
  const seen = new Set<string>()
  for (const contributor of contributors) {
    const parsed =
      RecommendationCandidateContributorSchema.safeParse(contributor)
    if (!parsed.success) continue
    const key = `${parsed.data.generator}\u0000${parsed.data.generatorVersion}`
    if (seen.has(key)) continue
    seen.add(key)
    accepted.push(parsed.data)
    if (accepted.length === MAX_RECOMMENDATION_CONTRIBUTORS) break
  }
  return accepted
}

export const RecommendationContentActionClassSchema = z.enum([
  "human_action",
  "machine_disposition",
  "reported_value",
])
export const RecommendationContentActionKindSchema = z.enum([
  "share",
  "save",
  "course_add",
  "continuation",
  "machine_disposition",
  "reported_value",
])
export const RecommendationContentActionActorClassSchema = z.enum([
  "human_anonymous",
  "human_signed_in",
  "machine",
  "internal",
  "test",
])
export const RecommendationRequestPurposeSchema = z.enum([
  "watch",
  "find_to_share",
  "course_build",
  "experience_generation",
])

export const RecommendationContentActionSchema = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_CONTENT_ACTION_CONTRACT),
    sessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    eventId: boundedIdentifier,
    occurredAt: isoDate,
    mediaId: boundedIdentifier,
    actionClass: RecommendationContentActionClassSchema,
    actionKind: RecommendationContentActionKindSchema,
    actorClass: RecommendationContentActionActorClassSchema,
    purpose: RecommendationRequestPurposeSchema,
    actionDetail: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/)
      .nullable(),
    destination: z
      .object({
        artifactType: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
        artifactId: boundedIdentifier,
      })
      .strict()
      .nullable(),
  })
  .strict()

export type RecommendationContentActionInput = z.infer<
  typeof RecommendationContentActionSchema
>

export const RecommendationEvidenceEventSchema = z
  .object({
    eventId: boundedIdentifier,
    kind: RecommendationEvidenceKind,
    occurredAt: isoDate,
    itemId: boundedIdentifier.optional(),
    episodeId: boundedIdentifier.optional(),
    sequence: z.number().int().nonnegative().max(10_000).optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict()

export const RecommendationEvidenceBatchSchema = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_CONTRACTS.evidence),
    events: z
      .array(RecommendationEvidenceEventSchema)
      .min(1)
      .max(MAX_EVIDENCE_EVENTS),
  })
  .strict()

export type RecommendationEvidenceBatch = z.infer<
  typeof RecommendationEvidenceBatchSchema
>

const positionSeconds = z.number().finite().min(0).max(86_400)
const durationSeconds = z.number().finite().positive().max(86_400)
const progress = z.number().finite().min(0).max(1)
const wallElapsedMilliseconds = z
  .number()
  .int()
  .min(0)
  .max(6 * 60 * 60 * 1_000)
const playbackEventBase = {
  eventId: boundedIdentifier,
  occurredAt: isoDate,
} as const

export const RecommendationPlaybackEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...playbackEventBase,
      kind: z.literal("playback_attempt"),
      payload: z
        .object({ initiation: z.enum(["manual", "automatic"]) })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...playbackEventBase,
      kind: z.literal("playback_start"),
      payload: z.object({ positionSeconds }).strict(),
    })
    .strict(),
  z
    .object({
      ...playbackEventBase,
      kind: z.literal("playback_progress"),
      payload: z
        .object({
          positionSeconds,
          durationSeconds: durationSeconds.nullable(),
          progress: progress.nullable(),
          wallElapsedMilliseconds,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...playbackEventBase,
      kind: z.literal("playback_seek"),
      payload: z
        .object({ fromSeconds: positionSeconds, toSeconds: positionSeconds })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...playbackEventBase,
      kind: z.literal("playback_active_visible_playing"),
      payload: z
        .object({
          activeMilliseconds: z.number().int().min(0).max(60_000).optional(),
          startedAt: isoDate.optional(),
          endedAt: isoDate.optional(),
          coverage: z.enum(["complete", "partial"]),
          missingReason: z
            .enum(["visibility_unavailable", "player_state_unavailable"])
            .optional(),
        })
        .strict()
        .superRefine((payload, context) => {
          const exactEndpointsPresent =
            payload.startedAt != null && payload.endedAt != null
          if (
            (payload.startedAt == null) !== (payload.endedAt == null) ||
            (!exactEndpointsPresent && payload.activeMilliseconds == null)
          ) {
            context.addIssue({
              code: "custom",
              message: "Active-playing interval evidence is incomplete",
            })
          }
          if (exactEndpointsPresent) {
            const startedAt = new Date(payload.startedAt!).getTime()
            const endedAt = new Date(payload.endedAt!).getTime()
            if (endedAt <= startedAt || endedAt - startedAt > 60_000) {
              context.addIssue({
                code: "custom",
                message: "Active-playing interval is out of bounds",
              })
            }
          }
          if (
            (payload.coverage === "complete" &&
              payload.missingReason != null) ||
            (payload.coverage === "partial" && payload.missingReason == null)
          ) {
            context.addIssue({
              code: "custom",
              message: "Active-playing coverage and missingness disagree",
            })
          }
        }),
    })
    .strict(),
  z
    .object({
      ...playbackEventBase,
      kind: z.literal("playback_end"),
      payload: z
        .object({
          reason: z.enum(["ended", "route_exit", "pagehide", "hidden"]),
          positionSeconds,
          durationSeconds: durationSeconds.nullable(),
          progress: progress.nullable(),
          completed: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...playbackEventBase,
      kind: z.literal("playback_error"),
      payload: z
        .object({
          code: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
          positionSeconds,
        })
        .strict(),
    })
    .strict(),
])

export type RecommendationPlaybackEvent = z.infer<
  typeof RecommendationPlaybackEventSchema
>

export const RecommendationPlaybackBatchSchema = z
  .object({
    contractVersion: z.literal(RECOMMENDATION_CONTRACTS.evidence),
    capability: z.string().min(1).max(4096),
    contextId: boundedIdentifier.optional(),
    episodeId: boundedIdentifier,
    sessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    mediaId: boundedIdentifier,
    events: z
      .array(RecommendationPlaybackEventSchema)
      .min(1)
      .max(MAX_EVIDENCE_EVENTS),
  })
  .strict()
  .superRefine((batch, context) => {
    const seen = new Set<string>()
    for (const [index, event] of batch.events.entries()) {
      if (seen.has(event.eventId)) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "eventId"],
          message: "Playback event ids must be unique within a batch",
        })
      }
      seen.add(event.eventId)
    }
  })

export type LegacyPositionInput = Readonly<{
  maxPositionSeconds: number
  maxProgress: number | null
}>

export type LegacyPositionOutcome = Readonly<{
  classifierVersion: typeof RECOMMENDATION_CONTRACTS.outcome
  qualifiedView: boolean
  viewQualityWeight: null
  viewQualityWeightReason: "continuous_weight_not_available"
  reasons: string[]
  learningEligible: false
}>

/**
 * The legacy position rule is retained only as a named, recomputable
 * comparator. It deliberately makes no active-attention or satisfaction claim.
 */
export function classifyLegacyPosition(
  input: LegacyPositionInput,
): LegacyPositionOutcome {
  const maxPositionSeconds = Number.isFinite(input.maxPositionSeconds)
    ? Math.max(0, input.maxPositionSeconds)
    : 0
  const maxProgress =
    input.maxProgress != null && Number.isFinite(input.maxProgress)
      ? Math.min(1, Math.max(0, input.maxProgress))
      : null
  const positionThreshold = maxPositionSeconds >= 30
  const progressThreshold = maxProgress != null && maxProgress >= 0.25
  const reasons = [
    ...(positionThreshold ? ["maximum_position_at_least_30_seconds"] : []),
    ...(!positionThreshold && progressThreshold
      ? ["maximum_progress_at_least_25_percent"]
      : []),
  ]
  return {
    classifierVersion: RECOMMENDATION_CONTRACTS.outcome,
    qualifiedView: positionThreshold || progressThreshold,
    viewQualityWeight: null,
    viewQualityWeightReason: "continuous_weight_not_available",
    reasons: reasons.length > 0 ? reasons : ["below_legacy_threshold"],
    learningEligible: false,
  }
}

export type ActivePlaybackInterval = Readonly<{
  startMilliseconds: number
  endMilliseconds: number
}>

/**
 * Returns the covered wall-clock duration of a set of active-playing
 * intervals. Facts can overlap after retry, lifecycle flushing, or a late
 * terminal batch, so summing their durations would overstate observable
 * foreground playback.
 */
export function unionActivePlaybackIntervals(
  intervals: readonly ActivePlaybackInterval[],
): number {
  const ordered = intervals
    .map(({ startMilliseconds, endMilliseconds }) => ({
      startMilliseconds: Math.max(0, startMilliseconds),
      endMilliseconds: Math.max(0, endMilliseconds),
    }))
    .filter(
      ({ startMilliseconds, endMilliseconds }) =>
        Number.isFinite(startMilliseconds) &&
        Number.isFinite(endMilliseconds) &&
        endMilliseconds > startMilliseconds,
    )
    .sort(
      (left, right) =>
        left.startMilliseconds - right.startMilliseconds ||
        left.endMilliseconds - right.endMilliseconds,
    )
  if (ordered.length === 0) return 0

  let covered = 0
  let start = ordered[0]!.startMilliseconds
  let end = ordered[0]!.endMilliseconds
  for (const interval of ordered.slice(1)) {
    if (interval.startMilliseconds <= end) {
      end = Math.max(end, interval.endMilliseconds)
      continue
    }
    covered += end - start
    start = interval.startMilliseconds
    end = interval.endMilliseconds
  }
  return Math.round(covered + end - start)
}

export type ActiveWatchProxyInput = Readonly<{
  activeMilliseconds: number
  durationSeconds: number | null
  completed: boolean
  coverage: "complete" | "partial" | "missing"
}>

export type ActiveWatchProxyOutcome = Readonly<{
  classifierVersion: typeof ACTIVE_WATCH_PROXY_VERSION
  qualifiedView: boolean
  viewQualityWeight: number
  viewQualityWeightReason:
    | "active_fraction_of_duration"
    | "active_time_against_30_seconds_without_duration"
  activeMilliseconds: number
  durationSeconds: number | null
  durationCohort: "short" | "medium" | "long" | "unknown"
  coverage: ActiveWatchProxyInput["coverage"]
  reasons: string[]
  learningEligible: false
}>

/**
 * Observable playback proxy used beside, never in place of, the legacy
 * position comparator. Qualification retains the legacy 30-second-or-25%
 * shape but applies it to unioned foreground-playing time. The continuous
 * weight is the bounded active fraction of known media duration.
 */
export function classifyActiveWatchProxy(
  input: ActiveWatchProxyInput,
): ActiveWatchProxyOutcome {
  const activeMilliseconds = Number.isFinite(input.activeMilliseconds)
    ? Math.max(0, Math.round(input.activeMilliseconds))
    : 0
  const activeSeconds = activeMilliseconds / 1_000
  const durationSeconds =
    input.durationSeconds != null &&
    Number.isFinite(input.durationSeconds) &&
    input.durationSeconds > 0
      ? Math.min(86_400, input.durationSeconds)
      : null
  const activeTimeThreshold = activeSeconds >= 30
  const activeProgress =
    durationSeconds == null
      ? null
      : Math.min(1, Math.max(0, activeSeconds / durationSeconds))
  const activeProgressThreshold =
    activeProgress != null && activeProgress >= 0.25
  const qualifiedView = activeTimeThreshold || activeProgressThreshold
  const durationCohort =
    durationSeconds == null
      ? ("unknown" as const)
      : durationSeconds <= 60
        ? ("short" as const)
        : durationSeconds <= 300
          ? ("medium" as const)
          : ("long" as const)
  const reasons = [
    ...(activeTimeThreshold
      ? ["active_time_at_least_30_seconds"]
      : activeProgressThreshold
        ? ["active_time_at_least_25_percent"]
        : ["below_active_playback_threshold"]),
    `duration_cohort_${durationCohort}`,
    input.completed ? "terminal_completed" : "terminal_partial",
    ...(input.coverage === "partial"
      ? ["active_visible_playing_coverage_partial"]
      : input.coverage === "missing"
        ? ["active_visible_playing_coverage_missing"]
        : []),
  ]
  return {
    classifierVersion: ACTIVE_WATCH_PROXY_VERSION,
    qualifiedView,
    viewQualityWeight:
      activeProgress ?? Math.min(1, Math.max(0, activeSeconds / 30)),
    viewQualityWeightReason:
      activeProgress == null
        ? "active_time_against_30_seconds_without_duration"
        : "active_fraction_of_duration",
    activeMilliseconds,
    durationSeconds,
    durationCohort,
    coverage: input.coverage,
    reasons,
    learningEligible: false,
  }
}
