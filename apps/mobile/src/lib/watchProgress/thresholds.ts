/**
 * Web-parity playback thresholds (KTD6): bar percent = position/duration,
 * hidden below 1%, snapped to full at >= 90%, resume offered only between
 * those bounds, resume seeks to at most one second before the end, and
 * resuming never autoplays (the caller's job). Same numbers web ships so
 * cross-device behavior feels identical.
 */

export const VISIBLE_MIN_RATIO = 0.01
export const COMPLETE_RATIO = 0.9
export const RESUME_END_GUARD_SECONDS = 1

export function progressRatio(
  positionSeconds: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) {
    return 0
  }
  if (durationSeconds <= 0) return 0
  return Math.min(1, Math.max(0, positionSeconds / durationSeconds))
}

export function isBarVisible(ratio: number): boolean {
  return ratio >= VISIBLE_MIN_RATIO
}

export function isCompleted(ratio: number): boolean {
  return ratio >= COMPLETE_RATIO
}

/** The bar's fill: completed snaps to full, otherwise the raw ratio. */
export function barFillRatio(ratio: number): number {
  return isCompleted(ratio) ? 1 : ratio
}

/** Resume is offered only between visible and completed. */
export function isResumeEligible(ratio: number): boolean {
  return isBarVisible(ratio) && !isCompleted(ratio)
}

/** Seek target: never closer than one second to the end, never negative. */
export function resumePositionSeconds(
  positionSeconds: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds)) {
    return 0
  }
  const latestAllowed = Math.max(0, durationSeconds - RESUME_END_GUARD_SECONDS)
  return Math.min(Math.max(0, positionSeconds), latestAllowed)
}
