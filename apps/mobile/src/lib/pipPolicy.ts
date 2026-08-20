/**
 * The AppState branch decision for a video the adapter owns (R13, KTD12).
 *
 * Playback must survive the app leaving the foreground when the operating
 * system's picture-in-picture window is carrying it — Android reports
 * picture-in-picture entry as `background`, not `inactive`, so the latch is the
 * only way to tell the two apart. The decision is a record rather than a bare
 * boolean because the background branch does three things, and a lone `pause`
 * flag silently drops the resume instruction and the progress flush.
 *
 * React-native-free: the state union matches `AppStateStatus` member for
 * member, so a caller passes the event value straight through.
 */

export type AppStateLike =
  | "active"
  | "background"
  | "inactive"
  | "unknown"
  | "extension"

export type AppStateBranchDecision = {
  pause: boolean
  /** Remember that playback was live, so foregrounding resumes it. */
  recordWasPlaying: boolean
  /** Force a watch-progress write for the position reached. */
  flushProgress: boolean
}

const NO_ACTION: AppStateBranchDecision = {
  pause: false,
  recordWasPlaying: false,
  flushProgress: false,
}

export function appStateBranchDecision(
  nextState: AppStateLike,
  pipActive: boolean,
): AppStateBranchDecision {
  // Foregrounding is not a pause decision. Whether to resume is read from the
  // live player, because a pause made inside picture-in-picture must survive.
  if (nextState === "active") return NO_ACTION

  // iOS reports `inactive` for a call, the notification shade, or the app
  // switcher — the app has not left, and pausing there is the wedge R13 fixes.
  // A real departure always follows with `background`, which owns the flush.
  if (nextState === "inactive") return NO_ACTION

  // `background` and the iOS-only `unknown`/`extension` keep today's pause. Under
  // picture-in-picture playback never stopped, so there is nothing to resume —
  // but progress still checkpoints at the position reached.
  return {
    pause: !pipActive,
    recordWasPlaying: !pipActive,
    flushProgress: true,
  }
}
