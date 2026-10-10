import { datadogLog } from "../datadog"

// SYNC: mirrors apps/mobile/src/lib/watchHome/logWatchHomeFallback.ts, but emits
// through datadogLog (mobile has no telemetry sink yet) and adds `topup-error`.
export type WatchHomeFallbackReason =
  | "null"
  | "error"
  | "empty"
  | "error-recovered"
  | "topup-error"

/**
 * Every Home revert/degrade is observable (R12): emit through datadogLog with the
 * reason as a FIRST-CLASS context attribute (facetable in Datadog), never
 * interpolated into the message. Distinguishes null / error / empty /
 * error-recovered (last-good reuse) / topup-error (divergent items dropped).
 */
export function logWatchHomeFallback(args: {
  reason: WatchHomeFallbackReason
}): void {
  datadogLog.warn("watch_home_fallback", { reason: args.reason })
}
