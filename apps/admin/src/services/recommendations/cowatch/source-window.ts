import { RecommendationInputError } from "../errors"

export const COWATCH_SOURCE_WINDOW_VERSION = "episode-event-window-v1" as const
export const COWATCH_LEGACY_SOURCE_WINDOW_VERSION =
  "legacy-outcome-write-window-v1" as const
export const COWATCH_MAX_SOURCE_WINDOW_MS = 180 * 86_400_000

export type CowatchSourceWindow = Readonly<{
  version: typeof COWATCH_SOURCE_WINDOW_VERSION
  windowStart: Date
  windowEnd: Date
  evaluationAsOf: Date
}>

export function assertCowatchSourceWindow(
  scope: CowatchSourceWindow,
  now: Date,
): void {
  if (
    scope.version !== COWATCH_SOURCE_WINDOW_VERSION ||
    ![scope.windowStart, scope.windowEnd, scope.evaluationAsOf, now].every(
      (value) => value instanceof Date && Number.isFinite(value.getTime()),
    ) ||
    scope.windowStart >= scope.windowEnd ||
    scope.windowEnd > scope.evaluationAsOf ||
    scope.evaluationAsOf > now ||
    scope.windowEnd.getTime() - scope.windowStart.getTime() >
      COWATCH_MAX_SOURCE_WINDOW_MS
  ) {
    throw new RecommendationInputError(
      "Co-watch source scope requires ordered event bounds within 180 days and a closed evaluation cutoff",
    )
  }
}
