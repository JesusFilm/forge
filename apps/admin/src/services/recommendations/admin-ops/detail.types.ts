import type {
  RecommendationAuditKind,
  RecommendationDeliveryResult,
  RecommendationEpisodeState,
  RecommendationExperimentEvaluationState,
  RecommendationRequestState,
} from "@prisma/client"

export type RecommendationFactMetrics = Readonly<{
  initiation?: "manual" | "automatic"
  positionSeconds?: number
  fromSeconds?: number
  toSeconds?: number
  durationSeconds?: number
  progress?: number
  wallElapsedMilliseconds?: number
  activeMilliseconds?: number
  coverage?: "complete" | "partial"
  missingReason?: "visibility_unavailable" | "player_state_unavailable"
  completed?: boolean
  reason?: "ended" | "route_exit" | "pagehide" | "hidden"
  code?: string
}>

export type RecommendationEpisodeDetail = Readonly<{
  id: string
  itemId: string
  state: "pending" | "claimed" | "finalized" | "timed_out"
  mediaId: string
  createdAt: Date
  claimedAt: Date | null
  finalizedAt: Date | null
  activeUntil: Date
  facts: Array<
    Readonly<{
      id: string
      sequence: number
      kind: string
      occurredAt: Date
      receivedAt: Date
      late: boolean
      occurredOutOfOrder: boolean
      metrics: RecommendationFactMetrics
    }>
  >
  outcomes: Array<
    Readonly<{
      id: string
      classifierVersion: string
      factWatermark: number
      revision: number
      supersedesRevision: number | null
      qualifiedView: boolean
      viewQualityWeight: number | null
      viewQualityWeightReason: string | null
      activePlaybackMilliseconds: number | null
      durationSeconds: number | null
      durationCohort: "short" | "medium" | "long" | "unknown" | null
      activeCoverage: "complete" | "partial" | "missing" | null
      reasons: string[]
      learningEligible: boolean
      eligibilityState: "pending" | "eligible" | "excluded" | "quarantined"
      eligibilityPolicyVersion: string | null
      eligibilityRevision: number | null
      eligibilityReasonCodes: string[]
      eligibleScopes: string[]
      contributionWeight: number | null
      createdAt: Date
    }>
  >
}>

export type RecommendationRequestDetailData = Readonly<{
  id: string
  contractVersion: string
  surfaceVersion: string
  strategyVersion: string
  classifierVersion: string
  seedMediaId: string
  locale: string
  expectedItemCount: number
  state: "prepared" | "issued" | "issuance_failed"
  result: "served" | "fallback" | "empty" | "unavailable"
  fallbackReason: string | null
  retrievalLatencyMs: number | null
  responseBytes: number | null
  createdAt: Date
  issuedAt: Date | null
  manifest: Readonly<{
    id: string
    strategyVersion: string
    contractVersion: string
    surfaceVersion: string
    generator: string
    maxItems: number
  }>
  controlReadiness: Readonly<{
    revision: number
    state: "ready" | "not-ready" | "inconclusive" | "data-unhealthy"
    policyVersion: string
    windowStart: Date
    windowEnd: Date
    evaluatedAt: Date
    explanation: string
  }> | null
  experiment: Readonly<{
    bypassReason: string | null
    assignment: Readonly<{
      id: string
      experimentId: string
      experimentVersion: string
      arm: "control" | "challenger"
      assignmentProbability: number
      configurationFingerprint: string
      generation: number
      effectiveManifestId: string
      actualExposureCount: number
    }> | null
    evaluation: Readonly<{
      revision: number
      state: "pass" | "fail" | "inconclusive" | "data-unhealthy"
      inputFingerprint: string
      evaluatedAt: Date
    }> | null
  }> | null
  personalization: Readonly<{
    lane: "semantic_control" | "profile_challenger" | "semantic_fallback"
    executionMode:
      | "semantic_contextual"
      | "hybrid_personalized"
      | "semantic_fallback"
      | null
    effectiveManifestId: string
    reasonCode: string | null
    projectionScope: "session" | "durable" | null
    projectionVersion: string | null
    projectionGeneration: number | null
    interestCount: number
    sessionIntentPresent: boolean
    retrievalLatencyMs: number | null
    feedbackSourceRequestIds: string[]
  }> | null
  candidateExecution: Readonly<{
    purpose: string
    requestedCount: number
    composedCount: number
    shortfallReason:
      | "insufficient_candidates"
      | "seed_material_unavailable"
      | "eligibility_exhausted"
      | "deadline_exhausted"
      | null
    versions: Readonly<{
      context: string
      generator: string
      union: string
      eligibility: string
      ranker: string
      composer: string
    }>
    parity: Readonly<{
      candidateEligibility: "passed" | "failed" | "not_evaluated"
      ranker: "passed" | "failed" | "not_evaluated"
    }>
    counts: Readonly<{
      nominated: number
      canonicalized: number
      deduplicated: number
      rejected: number
      scored: number
      ordered: number
      composed: number
    }>
    evidenceComplete: boolean
    fallbackReason: string | null
    stages: Array<
      Readonly<{
        stage:
          | "nominated"
          | "canonicalized"
          | "deduplicated"
          | "rejected"
          | "scored"
          | "ordered"
          | "composed"
        ordinal: number
        candidateKey: string
        targetMediaId: string | null
        sourceGenerator: string | null
        sourceRank: number | null
        sourceScore: number | null
        sourceCount: number
        sourceSummaries: string[]
        contributors: Array<
          Readonly<{
            generator: string
            generatorVersion: string
            rank: number
          }>
        >
        normalizedScore: number | null
        rrfScore: number | null
        deterministicScore: number | null
        finalPosition: number | null
        reasonCodes: string[]
      }>
    >
    suppressions: Array<
      Readonly<{
        targetMediaId: string
        orderedPosition: number | null
        reasonCodes: string[]
        contributors: Array<
          Readonly<{
            generator: string
            generatorVersion: string
            rank: number
          }>
        >
      }>
    >
  }> | null
  shadowComparisons: Array<
    Readonly<{
      evaluationId: string
      runId: string
      generatorVersion: string
      evaluationState: "active" | "terminal"
      runState: "pending" | "claimed" | "published" | "failed" | "fenced"
      sampleOrdinal: number
      versions: Readonly<{
        sampling: string
        context: string
        eligibility: string
        retention: string
      }>
      usedProfileProjection: boolean
      privacyGeneration: number | null
      liveSlateUnchanged: boolean | null
      counts: Readonly<{
        nominated: number | null
        eligible: number | null
        rejected: number | null
      }>
      metrics: Readonly<{
        coverage: number | null
        overlap: number | null
        novelty: number | null
        diversity: number | null
        rejection: number | null
        latencyMs: number | null
        cohortQuality: number | null
        inputFreshnessMs: number | null
      }>
      inputCapturedAt: Date
      finishedAt: Date | null
      decision: Readonly<{
        state: "promote_to_experiment" | "revise" | "retire" | "inconclusive"
        reasonCode: string
        reevaluationCondition: string
        decidedAt: Date
      }> | null
      nominations: Array<
        Readonly<{
          ordinal: number
          candidateKey: string
          targetMediaId: string
          generator: string
          generatorVersion: string
          sourceRank: number
          sourceScore: number
          eligible: boolean
          reasonCodes: string[]
          shadowPosition: number | null
          overlapsLive: boolean
          provenanceKeys: string[]
          provenance: Readonly<Record<string, string | number>>
        }>
      >
    }>
  >
  items: Array<
    Readonly<{
      id: string
      position: number
      targetMediaId: string
      canonicalHref: string
      candidateGenerator: string
      provenance: Readonly<{ sceneIndex?: number; similarity?: number }>
      presentation: Readonly<{
        videoTitle?: string
        audioLanguageSlug?: string
        startSeconds?: number
        endSeconds?: number
      }>
      renderedAt: Date | null
      impressionAt: Date | null
      selectedAt: Date | null
      visibilityPolicy: string | null
      explanation: string | null
      composition: Readonly<{
        orderedPosition: number | null
        finalPosition: number
        movement: number | null
        refill: boolean
        reasonCodes: string[]
        contributors: Array<
          Readonly<{
            generator: string
            generatorVersion: string
            rank: number
          }>
        >
      }> | null
    }>
  >
  lifecycleEvents: Array<
    Readonly<{
      id: string
      itemId: string
      kind: "rendered" | "impression" | "selection"
      receivedAt: Date
      occurredAt: Date
      occurredOutOfOrder: boolean
    }>
  >
  episodes: RecommendationEpisodeDetail[]
  contentActions: Array<
    Readonly<{
      id: string
      itemId: string | null
      episodeId: string | null
      actionClass: string
      actionKind: string
      actorClass: string
      purpose: string
      actionDetail: string | null
      targetMediaId: string
      candidateGenerator: string | null
      destinationState: "none" | "active" | "deleted"
      occurredAt: Date
      receivedAt: Date
      late: boolean
      learningEligible: boolean
      eligibilityState: "pending" | "eligible" | "excluded" | "quarantined"
      eligibilityPolicyVersion: string | null
      eligibilityRevision: number | null
      eligibilityReasonCodes: string[]
      eligibleScopes: string[]
      contributionWeight: number | null
      replayCount: number
      conflictCount: number
    }>
  >
  audits: Array<
    Readonly<{
      id: string
      kind: string
      reasonCode: string
      count: number
      occurredAt: Date
    }>
  >
  conflicts: Array<
    Readonly<{
      id: string
      attempts: number
      firstSeenAt: Date
      lastSeenAt: Date
    }>
  >
}>

export type DetailRootRow = Readonly<{
  id: string
  contractVersion: string
  surfaceVersion: string
  strategyVersion: string
  classifierVersion: string
  seedMediaId: string
  locale: string
  expectedItemCount: number
  state: RecommendationRequestState
  result: RecommendationDeliveryResult
  fallbackReason: string | null
  retrievalLatencyMs: number | null
  responseBytes: number | null
  createdAt: Date
  issuedAt: Date | null
  manifestId: string
  manifestStrategyVersion: string
  manifestContractVersion: string
  manifestSurfaceVersion: string
  manifestGenerator: string
  manifestMaxItems: number
  experimentBypassReason: string | null
  assignmentId: string | null
  assignmentExperimentId: string | null
  experimentVersion: string | null
  assignmentArm: "control" | "challenger" | null
  assignmentProbability: number | null
  assignmentConfigurationDigest: string | null
  assignmentGeneration: number | null
  effectiveManifestId: string | null
  actualExposureCount: bigint | number
}>

export type DetailItemRow = Readonly<{
  id: string
  position: number
  targetMediaId: string
  canonicalHref: string
  candidateGenerator: string
  sceneIndex: number | null
  similarity: number | null
  videoTitle: string | null
  audioLanguageSlug: string | null
  startSeconds: number | null
  endSeconds: number | null
  renderedId: string | null
  renderedOccurredAt: Date | null
  renderedReceivedAt: Date | null
  impressionId: string | null
  impressionVisibilityPolicy: string | null
  impressionOccurredAt: Date | null
  impressionReceivedAt: Date | null
  selectionId: string | null
  selectionOccurredAt: Date | null
  selectionReceivedAt: Date | null
}>

export type DetailControlReadinessRow = Readonly<{
  revision: number
  state: "ready" | "not_ready" | "inconclusive" | "data_unhealthy"
  policyVersion: string
  windowStart: Date
  windowEnd: Date
  evaluatedAt: Date
  explanation: string
}>

export type DetailCandidateRunRow = Readonly<{
  id: string
  purpose: string
  contextVersion: string
  generatorVersion: string
  unionVersion: string
  eligibilityVersion: string
  rankerVersion: string
  composerVersion: string
  candidateEligibilityParity: "passed" | "failed" | "not_evaluated"
  rankerParity: "passed" | "failed" | "not_evaluated"
  nominatedCount: number
  canonicalizedCount: number
  deduplicatedCount: number
  rejectedCount: number
  scoredCount: number
  orderedCount: number
  requestedCount: number
  composedCount: number
  shortfallReason:
    | "insufficient_candidates"
    | "seed_material_unavailable"
    | "eligibility_exhausted"
    | "deadline_exhausted"
    | null
  evidenceComplete: boolean
  fallbackReason: string | null
}>

export type DetailPersonalizationRow = Readonly<{
  lane: "semantic_control" | "profile_challenger" | "semantic_fallback"
  executionMode:
    | "semantic_contextual"
    | "hybrid_personalized"
    | "semantic_fallback"
    | null
  effectiveManifestId: string
  reasonCode: string | null
  projectionScope: "session" | "durable" | null
  projectionVersion: string | null
  projectionGeneration: number | null
  interestCount: number
  sessionIntentPresent: boolean
  retrievalLatencyMs: number | null
  feedbackSourceRequestIds: string[]
}>

export type DetailCandidateStageRow = Readonly<{
  stage: RecommendationRequestDetailData["candidateExecution"] extends infer T
    ? NonNullable<T> extends { stages: Array<infer S> }
      ? S extends { stage: infer U }
        ? U
        : never
      : never
    : never
  ordinal: number
  candidateKey: string
  targetMediaId: string | null
  sourceGenerator: string | null
  sourceRank: number | null
  sourceScore: number | null
  sourceCount: number
  sourceSummaries: string[]
  contributors?: Array<{
    generator: string
    generatorVersion: string
    rank: number
  }>
  normalizedScore: number | null
  rrfScore: number | null
  deterministicScore: number | null
  finalPosition: number | null
  reasonCodes: string[]
}>

export type DetailShadowRunRow = Readonly<{
  evaluationId: string
  runId: string
  generatorVersion: string
  evaluationState: "active" | "terminal"
  runState: "pending" | "claimed" | "published" | "failed" | "fenced"
  sampleOrdinal: number
  samplingVersion: string
  contextVersion: string
  eligibilityVersion: string
  retentionPolicyVersion: string
  usedProfileProjection: boolean
  privacyGeneration: number | null
  liveSlateUnchanged: boolean | null
  nominatedCount: number | null
  eligibleCount: number | null
  rejectedCount: number | null
  coverage: number | null
  overlap: number | null
  novelty: number | null
  diversity: number | null
  rejection: number | null
  latencyMs: number | null
  cohortQuality: number | null
  inputFreshnessMs: number | null
  inputCapturedAt: Date
  finishedAt: Date | null
  decision:
    | "promote_to_experiment"
    | "revise"
    | "retire"
    | "inconclusive"
    | null
  decisionReasonCode: string | null
  reevaluationCondition: string | null
  decidedAt: Date | null
}>

export type DetailShadowNominationRow = Readonly<{
  runId: string
  ordinal: number
  candidateKey: string
  targetMediaId: string
  generator: string
  generatorVersion: string
  sourceRank: number
  sourceScore: number
  eligible: boolean
  reasonCodes: string[]
  shadowPosition: number | null
  overlapsLive: boolean
  provenanceKeys: string[]
  provenance: Record<string, string | number>
}>

export type DetailEpisodeRow = Readonly<{
  id: string
  itemId: string
  state: RecommendationEpisodeState
  mediaId: string
  createdAt: Date
  claimedAt: Date | null
  finalizedAt: Date | null
  activeUntil: Date
}>

export type DetailFactRow = Readonly<{
  id: string
  episodeId: string
  sequence: number
  kind: string
  occurredAt: Date
  receivedAt: Date
  late: boolean
  initiation: "manual" | "automatic" | null
  positionSeconds: number | null
  fromSeconds: number | null
  toSeconds: number | null
  durationSeconds: number | null
  progress: number | null
  wallElapsedMilliseconds: number | null
  activeMilliseconds: number | null
  coverage: "complete" | "partial" | null
  missingReason: "visibility_unavailable" | "player_state_unavailable" | null
  completed: boolean | null
  reason: "ended" | "route_exit" | "pagehide" | "hidden" | null
  code: string | null
}>

export type DetailOutcomeRow = Readonly<{
  id: string
  episodeId: string
  classifierVersion: string
  factWatermark: number
  revision: number
  supersedesRevision: number | null
  qualifiedView: boolean
  viewQualityWeight: number | null
  viewQualityWeightReason: string | null
  activePlaybackMilliseconds: number | null
  durationSeconds: number | null
  durationCohort: "short" | "medium" | "long" | "unknown" | null
  activeCoverage: "complete" | "partial" | "missing" | null
  reasons: string[]
  learningEligible: boolean
  eligibilityState: "pending" | "eligible" | "excluded" | "quarantined"
  eligibilityPolicyVersion: string | null
  eligibilityRevision: number | null
  eligibilityReasonCodes: string[]
  eligibleScopes: string[]
  contributionWeight: number | null
  createdAt: Date
}>

export type DetailAuditRow = Readonly<{
  id: string
  kind: RecommendationAuditKind
  reasonCode: string
  count: number
  occurredAt: Date
}>

export type DetailConflictRow = Readonly<{
  id: string
  attempts: number
  firstSeenAt: Date
  lastSeenAt: Date
}>

export type DetailContentActionRow = Readonly<{
  id: string
  itemId: string | null
  episodeId: string | null
  actionClass: string
  actionKind: string
  actorClass: string
  purpose: string
  actionDetail: string | null
  targetMediaId: string
  candidateGenerator: string | null
  destinationState: "none" | "active" | "deleted"
  occurredAt: Date
  receivedAt: Date
  late: boolean
  learningEligible: boolean
  eligibilityState: "pending" | "eligible" | "excluded" | "quarantined"
  eligibilityPolicyVersion: string | null
  eligibilityRevision: number | null
  eligibilityReasonCodes: string[]
  eligibleScopes: string[]
  contributionWeight: number | null
  replayCount: number
  conflictCount: number
}>

export type RecommendationDetailQueryData = Readonly<{
  root: DetailRootRow
  experimentEvaluation: Readonly<{
    revision: number
    state: RecommendationExperimentEvaluationState
    inputDigest: string
    evaluatedAt: Date
  }> | null
  personalization: DetailPersonalizationRow | null
  candidateRun: DetailCandidateRunRow | null
  candidateStages: DetailCandidateStageRow[]
  shadowRuns: DetailShadowRunRow[]
  shadowNominations: DetailShadowNominationRow[]
  items: DetailItemRow[]
  episodes: DetailEpisodeRow[]
  facts: DetailFactRow[]
  outcomes: DetailOutcomeRow[]
  contentActions: DetailContentActionRow[]
  audits: DetailAuditRow[]
  conflicts: DetailConflictRow[]
  controlReadiness: DetailControlReadinessRow | null
}>
