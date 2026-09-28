export const WATCH_EXPOSURE_REGISTRY = [
  {
    surface: "watch-video",
    block: "below-player",
    presentation: "recommendation-list",
    policyVersion: "watch-below-player-v1",
    instrumented: true,
    complete: true,
    source: "signed-delivery",
  },
  {
    surface: "watch-home",
    block: "for-you",
    presentation: "recommendation-list",
    policyVersion: "watch-for-you-v1",
    instrumented: true,
    complete: true,
    source: "signed-delivery",
  },
  {
    surface: "watch-home",
    block: "hero",
    presentation: "hero-card",
    policyVersion: "watch-exposure-v1",
    instrumented: true,
    complete: false,
    source: "anonymous-window",
  },
  {
    surface: "watch-home",
    block: "collections",
    presentation: "carousel",
    policyVersion: "watch-exposure-v1",
    instrumented: true,
    complete: false,
    source: "anonymous-window",
  },
  {
    surface: "watch-home",
    block: "collections",
    presentation: "grid",
    policyVersion: "watch-exposure-v1",
    instrumented: true,
    complete: false,
    source: "anonymous-window",
  },
  {
    surface: "watch-home",
    block: "authored",
    presentation: "authored-block",
    policyVersion: "watch-exposure-v1",
    instrumented: true,
    complete: false,
    source: "anonymous-window",
  },
  {
    surface: "watch-search",
    block: "results",
    presentation: "result-list",
    policyVersion: "watch-exposure-v1",
    instrumented: true,
    complete: false,
    source: "anonymous-window",
  },
  {
    surface: "watch-video",
    block: "editorial",
    presentation: "authored-block",
    policyVersion: "watch-exposure-v1",
    instrumented: true,
    complete: false,
    source: "anonymous-window",
  },
  {
    surface: "watch-video",
    block: "chapters",
    presentation: "carousel",
    policyVersion: "watch-exposure-v1",
    instrumented: true,
    complete: false,
    source: "anonymous-window",
  },
  {
    surface: "watch-series",
    block: "episodes",
    presentation: "episode-grid",
    policyVersion: "watch-exposure-v1",
    instrumented: true,
    complete: false,
    source: "anonymous-window",
  },
] as const

export function registeredAnonymousWatchSurface(
  surface: string,
  block: string,
  presentation: string,
  policyVersion: string,
): boolean {
  return WATCH_EXPOSURE_REGISTRY.some(
    (entry) =>
      entry.source === "anonymous-window" &&
      entry.instrumented &&
      entry.surface === surface &&
      entry.block === block &&
      entry.presentation === presentation &&
      entry.policyVersion === policyVersion,
  )
}
