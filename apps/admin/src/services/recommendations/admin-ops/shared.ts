import { createHmac } from "node:crypto"

export const RECOMMENDATION_TRACE_PAGE_SIZE = 50
export const RECOMMENDATION_TRACE_ACCESS_REASON = "trace_detail"
export const RECOMMENDATION_TRACE_ACCESS_RETENTION_DAYS = 90

export const RECOMMENDATION_OPS_DAY_MS = 86_400_000
export const RECOMMENDATION_TRACE_MAX_CURSOR_LENGTH = 512
export const boundedRecommendationReason = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const boundedRecommendationIdentifier = /^[A-Za-z0-9_-]{1,191}$/
export const boundedRecommendationActorDigest = /^[a-f0-9]{64}$/

export function recommendationTraceActorDigest(
  actorId: string,
  secret: string,
): string {
  return createHmac("sha256", secret)
    .update("recommendation-trace-actor:v1\0")
    .update(actorId)
    .digest("hex")
}

export type RecommendationOpsWindowPreset = "24h" | "7d" | "29d"

export type RecommendationOpsWindow = Readonly<{
  preset: RecommendationOpsWindowPreset
  start: Date
  end: Date
}>

export type RecommendationTraceFilters = Readonly<{
  requestState: "prepared" | "issued" | "issuance_failed" | null
  fallbackReason: string | null
  evidenceState:
    | "loss_suspected"
    | "replay"
    | "conflict"
    | "late"
    | "classifier_lag"
    | null
}>

export function firstRecommendationSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function resolveRecommendationOpsWindow(
  raw: string | string[] | undefined,
  now: Date = new Date(),
): RecommendationOpsWindow {
  const value = firstRecommendationSearchParam(raw)
  const preset: RecommendationOpsWindowPreset =
    value === "7d" || value === "29d" ? value : "24h"
  const durationMs =
    preset === "24h"
      ? RECOMMENDATION_OPS_DAY_MS
      : Number.parseInt(preset, 10) * RECOMMENDATION_OPS_DAY_MS
  return {
    preset,
    start: new Date(now.getTime() - durationMs),
    end: now,
  }
}

export function resolveRecommendationTraceFilters(input: {
  requestState?: string | string[]
  fallbackReason?: string | string[]
  evidenceState?: string | string[]
}): RecommendationTraceFilters {
  const requestState = firstRecommendationSearchParam(input.requestState)
  const fallbackReason = firstRecommendationSearchParam(input.fallbackReason)
  const evidenceState = firstRecommendationSearchParam(input.evidenceState)
  return {
    requestState:
      requestState === "prepared" ||
      requestState === "issued" ||
      requestState === "issuance_failed"
        ? requestState
        : null,
    fallbackReason:
      fallbackReason != null && boundedRecommendationReason.test(fallbackReason)
        ? fallbackReason
        : null,
    evidenceState:
      evidenceState === "loss_suspected" ||
      evidenceState === "replay" ||
      evidenceState === "conflict" ||
      evidenceState === "late" ||
      evidenceState === "classifier_lag"
        ? evidenceState
        : null,
  }
}
