/**
 * Which second of the film is on screen at a given second of the backdrop.
 *
 * bg.mp4 is a re-edit, not a window: pieces of the film joined end to end
 * (hard cuts, or dissolves at the seams) and then slowed as a whole. A
 * backdrop second is therefore not a film second, and a short cut from the
 * backdrop cannot be rebuilt on the catalog film (Shorts Studio plays the
 * film itself) without the plan that made it. The renderer records that plan
 * in the manifest as `bgPlan`; this module reads it back.
 */

export type BackgroundSegment = { startSec: number; lengthSec: number }

export type BackgroundPlan = {
  /** Film seconds per backdrop second (the whole joined take is slowed). */
  speed: number
  /** Source seconds each seam's dissolve overlaps; 0 for hard cuts. */
  dissolveSec: number
  /** Film pieces in the order they were joined (film seconds). */
  segments: BackgroundSegment[]
}

/**
 * The dissolve the seam join actually uses. A dissolve cannot be longer than
 * the shorter side of the seam it joins, and below 0.2s it reads as a glitch.
 * One function for the join and for the plan, so the recorded plan cannot
 * drift from the file that was built.
 */
export function seamDissolveSec(
  segments: ReadonlyArray<BackgroundSegment>,
  seamSec: number,
): number {
  if (segments.length < 2 || seamSec <= 0) return 0
  const shortest = Math.min(...segments.map((s) => s.lengthSec))
  return Math.max(0.2, Math.min(seamSec, shortest / 2))
}

/**
 * Which piece of the plan is on screen at backdrop second `bgSec`, and where
 * it starts on the joined (unslowed) timeline. Inside a dissolve the incoming
 * piece takes over at the dissolve's midpoint.
 */
export function pieceAt(
  plan: BackgroundPlan,
  bgSec: number,
): { index: number; joinedStartSec: number } {
  const joined = Math.max(0, bgSec) * plan.speed
  const d = plan.dissolveSec
  let offset = 0
  let index = 0
  let joinedStartSec = 0
  for (let i = 0; i < plan.segments.length; i++) {
    if (i > 0) offset -= d
    if (i > 0 && joined < offset + d / 2) break
    index = i
    joinedStartSec = offset
    offset += plan.segments[i].lengthSec
  }
  return { index, joinedStartSec }
}

/**
 * The film second shown at backdrop second `bgSec`. Past the end of the plan
 * the last piece holds its last frame (as the file does).
 */
export function filmSecondAt(plan: BackgroundPlan, bgSec: number): number {
  const { index, joinedStartSec } = pieceAt(plan, bgSec)
  const piece = plan.segments[index]
  const into = Math.max(0, bgSec) * plan.speed - joinedStartSec
  return piece.startSec + Math.min(into, piece.lengthSec)
}
