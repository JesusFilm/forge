import { createRecommendationEventEnvelope } from "./envelope"

export type VisitSnapshot = {
  kind: "admission" | "delivery"
  visitId: string
  experimentId: string
  revision: number
  occurredAt: Date
  acceptedAt: Date
  expiresAt: Date
  sourceVideoId: string
  locale: string
  audioLanguageSlug: string
  eligibility: string
  qualification: string
  exclusionReason: string | null
  arm: string | null
  deliveryResult: string
  actualStrategy: string | null
  deliveryRequestId: string | null
  fallbackReason: string | null
}

/** Only explicit report dimensions leave operational PostgreSQL. */
export function experimentVisitHistoryEvent(input: VisitSnapshot) {
  return createRecommendationEventEnvelope({
    family: "experiment-visit",
    logicalId: `ab-visit:${input.visitId}`,
    revision: input.revision,
    occurredAt: input.occurredAt,
    acceptedAt: input.acceptedAt,
    expiresAt: input.expiresAt,
    payload: {
      kind: input.kind,
      visitId: input.visitId,
      experimentId: input.experimentId,
      sourceVideoId: input.sourceVideoId,
      locale: input.locale,
      audioLanguageSlug: input.audioLanguageSlug,
      eligibility: input.eligibility,
      qualification: input.qualification,
      exclusionReason: input.exclusionReason,
      arm: input.arm,
      deliveryResult: input.deliveryResult,
      actualStrategy: input.actualStrategy,
      deliveryRequestId: input.deliveryRequestId,
      fallbackReason: input.fallbackReason,
    },
    allowedFields: [
      "kind",
      "visitId",
      "experimentId",
      "sourceVideoId",
      "locale",
      "audioLanguageSlug",
      "eligibility",
      "qualification",
      "exclusionReason",
      "arm",
      "deliveryResult",
      "actualStrategy",
      "deliveryRequestId",
      "fallbackReason",
    ],
  })
}

export type BaselineSnapshot = {
  kind: "admission" | "delivery"
  visitId: string
  runId: string
  revision: number
  occurredAt: Date
  acceptedAt: Date
  expiresAt: Date
  sourceVideoId: string
  locale: string
  audioLanguageSlug: string
  deliveryResult: string
}

export function baselineVisitHistoryEvent(input: BaselineSnapshot) {
  return createRecommendationEventEnvelope({
    family: "experiment-visit",
    logicalId: `baseline-visit:${input.visitId}`,
    revision: input.revision,
    occurredAt: input.occurredAt,
    acceptedAt: input.acceptedAt,
    expiresAt: input.expiresAt,
    payload: {
      kind: input.kind,
      visitId: input.visitId,
      runId: input.runId,
      sourceVideoId: input.sourceVideoId,
      locale: input.locale,
      audioLanguageSlug: input.audioLanguageSlug,
      deliveryResult: input.deliveryResult,
    },
    allowedFields: [
      "kind",
      "visitId",
      "runId",
      "sourceVideoId",
      "locale",
      "audioLanguageSlug",
      "deliveryResult",
    ],
  })
}

export function visitRequestHistoryEvent(input: {
  scope: "ab" | "baseline"
  visitId: string
  requestId: string
  occurredAt: Date
  acceptedAt: Date
  expiresAt: Date
}) {
  return createRecommendationEventEnvelope({
    family: "experiment-visit",
    logicalId: `${input.scope === "ab" ? "ab-visit" : "baseline-visit"}:${input.visitId}/request:${input.requestId}`,
    revision: 1,
    occurredAt: input.occurredAt,
    acceptedAt: input.acceptedAt,
    expiresAt: input.expiresAt,
    payload: {
      kind: "request-link",
      scope: input.scope,
      visitId: input.visitId,
      requestId: input.requestId,
    },
    allowedFields: ["kind", "scope", "visitId", "requestId"],
  })
}
