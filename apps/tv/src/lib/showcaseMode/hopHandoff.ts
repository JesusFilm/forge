/**
 * Pure decision logic for the hop handoff (KTD-5): while one dub plays, the STANDBY
 * player preloads the next dub — loaded, exact-seeked to the boundary, first frame
 * decoded — so the boundary is a view flip, not a replaceAsync gap. replaceAsync
 * releases the AVPlayer item and blanks the surface for the whole HLS re-init, so no
 * mask timed over a single player can make a hop seamless; only a pre-armed second
 * player can. React-free and colocated tests, the reelPlayerGate.ts pattern.
 */

import type { ShowcaseStream } from "./types"

/**
 * The standby preload must resolve inside one hop segment (~10s) with margin for the
 * flip itself; past this the boundary falls back to the poster-masked swap.
 */
export const PRELOAD_DEADLINE_MS = 8000

/**
 * expo-video's currentTime setter is a zero-tolerance seek, so a LANDED preload seek
 * sits exactly on the boundary; a position further out than this is the tvOS dropped
 * seek (item not yet seekable) and needs the re-issue heal.
 */
export const PRELOAD_SEEK_TOLERANCE_SECONDS = 1

/**
 * Ready needs a little media buffered past the boundary, so the flip starts moving
 * instead of stalling on its first frame. If the player never reports that much, the
 * grace period lets a landed seek count as ready anyway — a brief post-flip stall
 * still beats a poster cut.
 */
export const PRELOAD_MIN_BUFFER_AHEAD_SECONDS = 1
export const PRELOAD_BUFFER_GRACE_MS = 4000

/**
 * At the flip the outgoing player has usually drifted (end-check sampling + start
 * lead) about half a second past the standby's parked boundary. Under this tolerance
 * the flip skips the align seek — a fresh zero-tolerance seek flushes the decoder on
 * the critical path, and a sub-second offset is invisible under the motion crossfade.
 */
export const ALIGNMENT_TOLERANCE_SECONDS = 0.75

/** The incoming view's opacity ramp over the outgoing frame — same footage, so short. */
export const HANDOFF_CROSSFADE_MS = 180

/**
 * Added to the outgoing clock when aiming the incoming player's start: it absorbs the
 * seek-settle + play-start latency, so when the reveal lands both players are moving
 * at roughly the same content position instead of the incoming lagging a beat.
 */
export const HANDOFF_START_LEAD_SECONDS = 0.5

export type StandbyPreloadPhase = "idle" | "loading" | "ready" | "failed"

/**
 * Identity of one hop's stream across the shell's object recreations: the dub's URL
 * plus its slice of the shared media timeline. Object identity does not survive the
 * hop advance (the shell rebuilds the stream from the plan on every projection).
 */
export function sameHopStream(
  a: Pick<ShowcaseStream, "hls" | "window"> | null,
  b: Pick<ShowcaseStream, "hls" | "window"> | null,
): boolean {
  if (a == null || b == null) return false
  return a.hls === b.hls && a.window.startSeconds === b.window.startSeconds
}

export type HopSwapMode = "flip" | "fallback" | "none"

/**
 * How the swap into `targetStream` is performed. `flip` hands the reel to the standby
 * player that already holds this stream; `fallback` is the poster-masked replaceAsync
 * on the live player; `none` for ordinary (non-hop) swaps. The boundary CONSUMES the
 * reservation either way, so a late-ready standby can never drop the poster mid-load.
 */
export function resolveHopSwapMode(args: {
  /** The swap into the target is a hop continuation (shell: hop plan index > 0). */
  hopSwap: boolean
  targetStream: Pick<ShowcaseStream, "hls" | "window"> | null
  /** The stream the standby player finished preloading, if any. */
  standbyReadyStream: Pick<ShowcaseStream, "hls" | "window"> | null
}): HopSwapMode {
  if (!args.hopSwap || args.targetStream == null) return "none"
  return sameHopStream(args.standbyReadyStream, args.targetStream)
    ? "flip"
    : "fallback"
}

export type PreloadVerdict = "ready" | "reseek" | "wait" | "failed"

/**
 * One poll tick of the standby preload. Position is polled, not event-driven — a
 * paused player emits no timeUpdate, and the tvOS dropped-seek heal (reelPlayerGate's
 * needsWindowStartSeek) only works at a choke point that keeps observing.
 */
export function preloadPollVerdict(args: {
  /** Standby's polled position; null when the native read threw (player released). */
  currentTime: number | null
  startSeconds: number
  /** Standby's buffered frontier; null/NaN when the platform does not report one. */
  bufferedPosition: number | null
  /**
   * The item reports readyToPlay. Position and buffer can read plausibly off an
   * item wedged in `loading`, and a flip armed on one plays nothing — the boundary
   * then rolls the cover into the watchdog instead of taking the clean poster cut.
   */
  statusReady: boolean
  elapsedMs: number
}): PreloadVerdict {
  if (args.elapsedMs >= PRELOAD_DEADLINE_MS) return "failed"
  if (args.currentTime == null || !Number.isFinite(args.currentTime)) {
    return "wait"
  }
  const landed =
    Math.abs(args.currentTime - args.startSeconds) <=
    PRELOAD_SEEK_TOLERANCE_SECONDS
  if (!landed) return "reseek"
  if (!args.statusReady) return "wait"
  const buffered =
    args.bufferedPosition != null &&
    Number.isFinite(args.bufferedPosition) &&
    args.bufferedPosition >=
      args.startSeconds + PRELOAD_MIN_BUFFER_AHEAD_SECONDS
  if (buffered || args.elapsedMs >= PRELOAD_BUFFER_GRACE_MS) return "ready"
  return "wait"
}

/**
 * Where the incoming player should fine-seek at the flip, or null to start from its
 * preloaded boundary position. The outgoing clock (plus the start lead) wins when it
 * is usable — it is the motion on screen — but never past the incoming window's end
 * (a final-slice hop can be shorter than the outgoing drift).
 */
export function alignmentSeekTarget(args: {
  /** The outgoing player's live position at the flip; null when the read threw. */
  outgoingTime: number | null
  incomingWindow: { startSeconds: number; endSeconds: number }
  /** The incoming standby's current (preloaded) position. */
  standbyTime: number | null
  /** Aim ahead of the outgoing clock by this much (HANDOFF_START_LEAD_SECONDS). */
  leadSeconds: number
}): number | null {
  const { outgoingTime, incomingWindow, standbyTime, leadSeconds } = args
  if (outgoingTime == null || !Number.isFinite(outgoingTime)) return null
  if (outgoingTime < incomingWindow.startSeconds) return null
  const target = Math.min(
    outgoingTime + leadSeconds,
    incomingWindow.endSeconds - 1,
  )
  if (target <= incomingWindow.startSeconds) return null
  if (
    standbyTime != null &&
    Number.isFinite(standbyTime) &&
    Math.abs(standbyTime - target) <= ALIGNMENT_TOLERANCE_SECONDS
  ) {
    return null
  }
  return target
}
