import { datadogLog } from "../datadog"

/**
 * Never-silent fallback signal (R11): when the body reverts to the frozen config
 * (Experience null / error / zero shelves), emit one structured Datadog log so a
 * prolonged prod fallback is observable (R7 — routes the former console.warn gap
 * through the telemetry sink).
 */
// "error-recovered" = the Experience fetch failed but a cached last-good body
// was reused instead of falling to config; logged so an outage stays observable.
// "topup-error" = the divergent-coreId hydration fetch failed, so those cards
// render un-hydrated (mux thumbnail + slug) while the rest of Home is intact.
export type WatchHomeFallbackReason =
  | "null"
  | "error"
  | "empty"
  | "error-recovered"
  | "topup-error"

// Two of the five reasons fire while the Experience body IS live, so the name
// alone overstates severity. body_source:config means "users saw frozen
// content"; body_source:experience means "degraded but admin-curated".
const EXPERIENCE_BODY_REASONS: ReadonlySet<WatchHomeFallbackReason> = new Set([
  "error-recovered",
  "topup-error",
])

export function logWatchHomeFallback(args: {
  reason: WatchHomeFallbackReason
}): void {
  datadogLog.warn("watch_home_fallback", {
    reason: args.reason,
    body_source: EXPERIENCE_BODY_REASONS.has(args.reason)
      ? "experience"
      : "config",
  })
}
