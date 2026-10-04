// The clock of one devotional video part (KTD8, R13, R15). The player ticks
// every 0.25 s, and a projection fills the time between ticks. In the last
// stretch before the stop, a per-frame read of the player takes over. The part
// stops a guard length before its end, so no frame or sound of the skipped
// range that follows reaches the screen. Pure: the caller gives every time.
import type { PartRange } from "./devotionals"

/** The player's `timeUpdateEventInterval`. */
export const PART_TICK_SECONDS = 0.25

/** The per-frame read starts this long before the stop. It spans more than a
 *  whole drifting tick, so no tick period can skip it. */
export const PART_FRAME_WATCH_SECONDS = 1.5

/** The part stops this long before its end. On the simulator a stop landed up
 *  to 0.013 s late, and a card can start one frame before its range. The
 *  device check with a speaker and AirPods confirms the length. */
export const PART_END_GUARD_SECONDS = 0.2

/** A seek target can read back a little under itself through a float. */
export const PART_START_TOLERANCE_SECONDS = 0.05

/** The cover lifts only after the media time passes the start by this much:
 *  then the player draws frames from the new position, never a stale frame. */
export const PART_REVEAL_LEAD_SECONDS = 0.1

/** A part that has not started by then shows "Try again". */
export const PART_START_BACKSTOP_MS = 8000

/** A media time and the wall time when it was true. */
export type PartClock = {
  readonly mediaSec: number
  readonly wallMs: number
  readonly running: boolean
}

export function startClock(
  mediaSec: number,
  wallMs: number,
  running: boolean,
): PartClock {
  return { mediaSec, wallMs, running }
}

/** The media time now: the base plus the wall time since, while it runs. */
export function projectClock(clock: PartClock, wallMs: number): number {
  if (!clock.running) return clock.mediaSec
  return clock.mediaSec + (wallMs - clock.wallMs) / 1000
}

/** A tick that moved is the truth, so the clock rebases on it. */
export function tickClock(
  clock: PartClock,
  mediaSec: number,
  wallMs: number,
): PartClock {
  if (!Number.isFinite(mediaSec) || mediaSec === clock.mediaSec) return clock
  return { mediaSec, wallMs, running: clock.running }
}

export function partStopAt(part: PartRange): number {
  return part.endSec - PART_END_GUARD_SECONDS
}

export function partStopDue(timeSec: number, part: PartRange): boolean {
  return timeSec >= partStopAt(part)
}

/** Which time the stop check reads: the projection, or the player itself. */
export function watchMode(
  projectedSec: number,
  part: PartRange,
): "projected" | "frame" {
  return projectedSec >= partStopAt(part) - PART_FRAME_WATCH_SECONDS
    ? "frame"
    : "projected"
}

/** The part may play: the source is ready and the seek has landed. */
export function startGateOpen({
  ready,
  positionSec,
  part,
}: {
  ready: boolean
  positionSec: number
  part: PartRange
}): boolean {
  return (
    ready &&
    Math.abs(positionSec - part.startSec) <= PART_START_TOLERANCE_SECONDS
  )
}

/** Float noise: 62.3 - 62.2 is a little under 0.1. */
const FLOAT_SLACK_SECONDS = 1e-6

export function partStarted(positionSec: number, part: PartRange): boolean {
  return (
    positionSec - part.startSec >=
    PART_REVEAL_LEAD_SECONDS - FLOAT_SLACK_SECONDS
  )
}

export function startBackstopDue(armedAtMs: number, nowMs: number): boolean {
  return nowMs - armedAtMs >= PART_START_BACKSTOP_MS
}

/** 0 at the start, 1 at the stop. */
export function partProgress(timeSec: number, part: PartRange): number {
  const length = partStopAt(part) - part.startSec
  if (!(length > 0) || !Number.isFinite(timeSec)) return 0
  return Math.min(1, Math.max(0, (timeSec - part.startSec) / length))
}
