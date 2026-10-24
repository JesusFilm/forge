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

/**
 * How soon after the release pause a return to the foreground still counts as
 * the viewer EXPANDING the window rather than closing it.
 *
 * The same stop event fires for both, so the release pauses immediately and
 * this window lets an expand undo it. It is compared against a recorded
 * timestamp, never used to schedule work: the first version of this fix
 * deferred the pause behind a `setTimeout` and the callback did not run for
 * about ten seconds once the activity was stopped, so the viewer kept hearing
 * audio after closing the window. A clock reading survives that suspension; a
 * scheduled callback does not.
 */
export const PIP_EXPAND_GRACE_MS = 3000

/** Which edge of the picture-in-picture latch just fired. */
export type PipHoldTransition = "started" | "released" | "none"

export type PipHoldDecision = {
  /**
   * Record that the app is away with the window carrying the video.
   *
   * Armed on the window STARTING, not on the background event, because the
   * window starts a beat later: at the background event the latch is still
   * clear, so the ordinary branch runs and saves a was-playing snapshot.
   * Without this the return from a CLOSED window reads that stale snapshot and
   * resumes a video the viewer dismissed.
   */
  armLeftUnderPip: boolean
  /**
   * Undo the ordinary background pause. The window is meant to carry this
   * video and the pause already stopped it, so without this the app appears to
   * dismiss with no window at all.
   */
  resume: boolean
  /**
   * Run the pause the latch had suspended. Releasing fires no AppState event,
   * so nothing else ever carries it and the audio keeps playing.
   */
  pause: boolean
}

const NO_PIP_ACTION: PipHoldDecision = {
  armLeftUnderPip: false,
  resume: false,
  pause: false,
}

/**
 * What a picture-in-picture latch edge should do.
 *
 * Pure so the expand-versus-close disambiguation and the cast veto are one
 * tested thing rather than four inline guard copies — every bug fixed in this
 * area so far has been a guard that was missing from one copy.
 */
export function pipHoldTransitionDecision(input: {
  transition: PipHoldTransition
  /** Only the root host's view enters the OS window. */
  armsPip: boolean
  foreground: boolean
  /** A session owns transport; never start local audio under one (KTD4). */
  castActive: boolean
  wasPlaying: boolean
}): PipHoldDecision {
  const { transition, armsPip, foreground, castActive, wasPlaying } = input

  if (transition === "started") {
    if (!armsPip || foreground) return NO_PIP_ACTION
    return {
      armLeftUnderPip: true,
      resume: !castActive && wasPlaying,
      pause: false,
    }
  }

  if (transition === "released") {
    if (foreground || castActive) return NO_PIP_ACTION
    return { armLeftUnderPip: false, resume: false, pause: true }
  }

  return NO_PIP_ACTION
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
