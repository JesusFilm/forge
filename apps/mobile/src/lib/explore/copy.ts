/** m:ss for a place in a clip, which is never an hour long. */
function clipClock(seconds: number): string {
  const whole = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}

/** Working copy (final copy is deferred). Every Explore string lives here. */
export const EXPLORE_COPY = {
  mute: "Mute",
  unmute: "Unmute",
  share: "Share",
  keepWatching: "Keep watching",
  keepWatchingHint: "Opens the full video at this point",
  clipSurfaceHint: "Plays or pauses the clip",
  pagerActions: { next: "Next clip", previous: "Previous clip" },
  descriptionMore: "more",
  descriptionMoreLabel: "Show the full description",
  descriptionLess: "less",
  descriptionLessLabel: "Show less of the description",
  progressLabel: "Clip progress",
  progressValue: (elapsed: number, length: number) =>
    `${elapsed} of ${length} seconds`,
  /** The pill above a scrub: "0:12 / 0:48". */
  scrubTime: (elapsed: number, length: number) =>
    `${clipClock(elapsed)} / ${clipClock(length)}`,
  offlineTitle: "You're offline",
  offlineBody: "Check your connection, then try again.",
  retry: "Try again",
  emptyTitle: (languageName: string) => `No clips in ${languageName} yet`,
  emptyBody: "Pick another language on any video's page to see more clips.",
  clipFailed: "This clip can't play. Swipe for the next one.",
} as const
