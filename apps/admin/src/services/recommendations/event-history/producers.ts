import {
  createRecommendationEventEnvelope,
  type RecommendationEventEnvelope,
  type RecommendationEventFamily,
} from "./envelope"

/** Deliberately narrow historical fields. Opaque capability and viewer digests stay in PG. */
const fields = {
  request: [
    "requestId",
    "manifestId",
    "strategyVersion",
    "seedMediaId",
    "locale",
    "result",
    "state",
    "fallbackReason",
    "expectedItemCount",
    "issuedAt",
    "retrievalLatencyMs",
    "responseBytes",
    "experimentAssignmentId",
  ],
  "served-item": [
    "requestId",
    "itemId",
    "position",
    "targetMediaId",
    "candidateGenerator",
    "audioLanguageSlug",
    "videoSlug",
    "videoTitle",
    "startSeconds",
    "endSeconds",
    "durationSeconds",
  ],
  evidence: [
    "requestId",
    "itemId",
    "eventId",
    "kind",
    "payloadDigest",
    "visibilityPolicy",
    "visibilityCapability",
    "receivedAt",
    "candidateRunId",
    "stage",
    "ordinal",
    "targetMediaId",
    "sourceGenerator",
    "sourceRank",
    "sourceScore",
    "normalizedScore",
    "rrfScore",
    "deterministicScore",
    "finalPosition",
    "reasonCodes",
    "purpose",
    "generatorVersion",
    "rankerVersion",
    "composerVersion",
    "nominatedCount",
    "rejectedCount",
    "scoredCount",
    "orderedCount",
    "requestedCount",
    "composedCount",
    "shortfallReason",
    "fallbackReason",
    "evidenceComplete",
  ],
  selection: [
    "requestId",
    "itemId",
    "eventId",
    "payloadDigest",
    "attributionEligibleAt",
    "receivedAt",
  ],
  "playback-episode": [
    "episodeId",
    "requestId",
    "itemId",
    "selectionId",
    "mediaId",
    "discoverySource",
    "state",
    "generation",
    "nextFactSequence",
    "historyRevision",
    "activeUntil",
    "hardUntil",
    "finalizedAt",
  ],
  "playback-fact": [
    "episodeId",
    "requestId",
    "itemId",
    "eventId",
    "sequence",
    "kind",
    "payloadDigest",
    "late",
    "receivedAt",
    "fact",
  ],
  outcome: [
    "outcomeId",
    "episodeId",
    "requestId",
    "itemId",
    "classifierVersion",
    "factWatermark",
    "inputDigest",
    "supersedesId",
    "qualifiedView",
    "viewQualityWeight",
    "viewQualityWeightReason",
    "activePlaybackMilliseconds",
    "activeIntervals",
    "durationSeconds",
    "durationCohort",
    "activeCoverage",
    "reasons",
    "generation",
    "learningEligible",
  ],
  "content-action": [
    "actionId",
    "eventId",
    "requestId",
    "itemId",
    "episodeId",
    "targetMediaId",
    "actionClass",
    "actionKind",
    "actorClass",
    "purpose",
    "candidateGenerator",
    "destinationAuditId",
    "late",
    "learningEligible",
    "receivedAt",
  ],
  correction: [
    "decisionId",
    "sourceKey",
    "sourceType",
    "outcomeId",
    "contentActionId",
    "selectionId",
    "policyVersion",
    "actorClass",
    "state",
    "reasonCodes",
    "eligibleScopes",
    "contributionWeight",
    "contributionOrdinal",
    "distinctSupport",
    "identityConcentration",
    "inputDigest",
    "evidenceWatermark",
    "decidedAt",
  ],
} as const

type ProducerFamily = keyof typeof fields

export function recommendationHistoryEvent(input: {
  family: ProducerFamily
  logicalId: string
  revision: number
  occurredAt: Date
  acceptedAt: Date
  expiresAt: Date
  payload: Record<string, unknown>
}): RecommendationEventEnvelope {
  return createRecommendationEventEnvelope({
    ...input,
    family: input.family as RecommendationEventFamily,
    allowedFields: fields[input.family],
  })
}

export function selectionAttributionCorrectionEvent(selection: {
  id: string
  requestId: string
  itemId: string
  eventId: string
  payloadDigest: string
  occurredAt: Date
  receivedAt: Date
  expiresAt: Date
  attributionEligibleAt: Date
}): RecommendationEventEnvelope {
  return recommendationHistoryEvent({
    family: "selection",
    logicalId: selection.id,
    revision: 2,
    occurredAt: selection.occurredAt,
    acceptedAt: selection.attributionEligibleAt,
    expiresAt: selection.expiresAt,
    payload: {
      requestId: selection.requestId,
      itemId: selection.itemId,
      eventId: selection.eventId,
      payloadDigest: selection.payloadDigest,
      attributionEligibleAt: selection.attributionEligibleAt.toISOString(),
      receivedAt: selection.receivedAt.toISOString(),
    },
  })
}
