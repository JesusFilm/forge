/**
 * Never-silent fallback signal (R11): when the body reverts to the frozen config
 * (Experience null / error / zero shelves), emit one structured log so a prolonged
 * prod fallback is observable. No mobile telemetry sink yet, so `console.warn` for now.
 */
// "error-recovered" = the Experience fetch failed but a cached last-good body
// was reused instead of falling to config; logged so an outage stays observable.
export type WatchHomeFallbackReason =
  | "null"
  | "error"
  | "empty"
  | "error-recovered"

export function logWatchHomeFallback(args: {
  reason: WatchHomeFallbackReason
}): void {
  console.warn(`[WatchHome] fallback reason=${args.reason}`)
}
