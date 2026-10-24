// R16's ladder only degrades on a REPORTED failure, and the two faults most likely on
// office wifi report nothing: a source that never starts, and one that starts then
// freezes. This clock turns that silence into a failure the ladder can answer.

/**
 * Time to first frame after the reel asks for playback. Generous on purpose: the poster
 * covers this whole window, so waiting looks like a slow transition, while a false skip
 * discards an excerpt that would have played (HLS start is ~1-3s, ~8s slow).
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
   * The reel WANTS this excerpt playing — deliberately not "the player is playing it".
   * Gating on readiness would disarm the clock for the never-starts fault it exists to
   * catch, because a source that never starts never reports itself ready.
   */
  playIntended: boolean
  /**
   * This ARM saw a frame for THIS excerpt. Must be cleared whenever the heartbeat is —
   * a confirmation that outlives its heartbeat reports a cold re-buffer as playing, and
   * that pair (confirmed, no heartbeat) is the one state no deadline below covers.
   */
  confirmed: boolean
  /** Since playIntended went true for this excerpt. Covers the load, which is why it is
   *  read only before confirmation — after that it would still be counting the load. */
  msSincePlayRequested: number
  /** Since the playhead last moved. Seeded at confirmation, so null means no heartbeat
   *  has landed yet — at most one timeUpdate interval, never a freeze. */
  msSincePlayheadAdvance: number | null
}

export type ReelWatchdogVerdict = "ok" | "load-timeout" | "stalled"

/**
 * Both verdicts are the same outcome to the reel — an excerpt that did not deliver —
 * and are kept distinct only so the reason is legible in telemetry and tests.
 */
export function classifyReelWatchdog({
  playIntended,
  confirmed,
  msSincePlayRequested,
  msSincePlayheadAdvance,
}: ReelWatchdogInputs): ReelWatchdogVerdict {
  if (!playIntended) return "ok"

  if (!confirmed) {
    return msSincePlayRequested >= REEL_LOAD_DEADLINE_MS ? "load-timeout" : "ok"
  }

  // Unreachable: confirmation and the heartbeat are seeded together and cleared
  // together, so confirmed implies a heartbeat. If this ever fires, that pairing broke —
  // and the caller has a player it believes is playing that no deadline is watching.
  if (msSincePlayheadAdvance == null) return "ok"

  return msSincePlayheadAdvance >= REEL_STALL_DEADLINE_MS ? "stalled" : "ok"
}
