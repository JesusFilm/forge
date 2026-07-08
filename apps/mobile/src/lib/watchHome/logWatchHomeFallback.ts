/**
 * Never-silent fallback signal (R11). When the Home body reverts to the frozen
 * config (Experience null / fetch error / zero renderable shelves), emit one
 * structured log carrying the reason, so a prolonged prod fallback is observable
 * rather than masked. Mobile has no telemetry sink today, so this is a
 * structured `console.warn` for now; a Datadog/Sentry sink is deferred.
 */
export type WatchHomeFallbackReason = "null" | "error" | "empty"

export function logWatchHomeFallback(args: {
  reason: WatchHomeFallbackReason
}): void {
  console.warn(`[WatchHome] fallback reason=${args.reason}`)
}
