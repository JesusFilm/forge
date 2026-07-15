// R16's ladder only degrades on a REPORTED failure, and the two faults most likely
// on office wifi report nothing: a source that never starts, and one that starts then
// freezes. This is the clock that turns silence into a failure the ladder can answer.
// React-free and colocated so it is unit-testable (KTD-8, mirrors reelPlayerGate).

/**
 * Time to first frame after we ASK the player to play. Generous on purpose: the
 * poster covers this whole window, so waiting looks like a slow transition, while a
 * false skip discards an excerpt that would have played (HLS start is ~1-3s, ~8s slow).
 */
export const REEL_LOAD_DEADLINE_MS = 12_000

/**
 * Playhead silence that means frozen, not slow. Tighter than the load deadline because
 * the viewer is looking at a stuck VIDEO frame, not a poster. timeUpdateEventInterval
 * is 1s, so six missed beats is unambiguous rather than jitter (AE5's "few seconds").
 */
export const REEL_STALL_DEADLINE_MS = 6_000

export type ReelWatchdogInputs = {
  /**
   * The reel wants this excerpt audible NOW. Every deadline hangs off this: the reel
   * PAUSES the player under chapter cards, interstitials and background, so a bare
   * "the playhead isn't moving" would fire on every chapter.
   */
  shouldPlay: boolean
  /** The player confirmed THIS excerpt playing — the first frame landed. */
  confirmed: boolean
  /** Since shouldPlay went true for this excerpt, not since the stream resolved: the
   *  fetch owns its own timeout, and the player cannot start while we hold it paused. */
  msSincePlayRequested: number
  /** Since the playhead last moved; null until it moves at all. */
  msSincePlayheadAdvance: number | null
}

export type ReelWatchdogVerdict = "ok" | "load-timeout" | "stalled"

/**
 * Both verdicts are the same outcome to the reel — an excerpt that did not deliver —
 * and are kept distinct only so the reason is legible in telemetry and tests.
 */
export function classifyReelWatchdog({
  shouldPlay,
  confirmed,
  msSincePlayRequested,
  msSincePlayheadAdvance,
}: ReelWatchdogInputs): ReelWatchdogVerdict {
  if (!shouldPlay) return "ok"

  if (!confirmed) {
    return msSincePlayRequested >= REEL_LOAD_DEADLINE_MS ? "load-timeout" : "ok"
  }

  // Confirmed but the playhead has never moved is still a stall, not a load: the
  // player claimed it was playing, so the load deadline no longer applies.
  if (msSincePlayheadAdvance == null) {
    return msSincePlayRequested >= REEL_STALL_DEADLINE_MS ? "stalled" : "ok"
  }

  return msSincePlayheadAdvance >= REEL_STALL_DEADLINE_MS ? "stalled" : "ok"
}
