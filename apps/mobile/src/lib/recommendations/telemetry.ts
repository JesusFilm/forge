/**
 * Datadog signals for the recommendation client. Every attribute is
 * `rec_`-prefixed (Datadog reserves `source`, `status`, `message`, ...), and no
 * token, capability, nonce, episode id or request id ever reaches a log.
 */
import { datadogLog } from "../datadog"

export function reportRecommendationIdentity(
  event: string,
  context: Record<string, string | number | boolean> = {},
): void {
  datadogLog.info("recommendation.identity", { rec_event: event, ...context })
}

export function reportRecommendationDelivery(
  result: string,
  reason: string,
  attempt: number,
): void {
  const log = result === "served" ? datadogLog.info : datadogLog.warn
  log("recommendation.delivery", {
    rec_result: result,
    rec_reason: reason,
    rec_attempt: attempt,
  })
}

export function reportRecommendationEvidence(
  kind: string,
  outcome: string,
): void {
  const log = outcome === "sent" ? datadogLog.info : datadogLog.warn
  log("recommendation.evidence", { rec_kind: kind, rec_outcome: outcome })
}

export function reportRecommendationPlaybackDegraded(
  reason: string,
  disposition: "dropped" | "retrying",
  factCount: number,
): void {
  datadogLog.warn("recommendation.playback_degraded", {
    rec_reason: reason,
    rec_disposition: disposition,
    rec_fact_count: factCount,
  })
}
