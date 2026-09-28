// The verse change (owner, 2026-09-28). The old verse fades out as it moves a
// few points, and the new verse fades in as it moves the same few points: up
// or down for a verse, left or right for a chapter. A scrub is faster.
import type { SwipeAxis } from "./gesture"
import type { MoveDirection } from "./move"
import type { VerseSlide } from "./useReaderMovement"

/** A move from a swipe, an arrow, or the screen reader; or one scrub step. */
export type VersePace = "move" | "scrub"

/** The owner asked for a 0.3 s move (2026-09-25). */
export const VERSE_SLIDE_MS = 300
/** A scrub step is quick, so the verse keeps up with the thumb (2026-09-28). */
export const VERSE_SCRUB_SLIDE_MS = 150

const PACE_MS: Record<VersePace, number> = {
  move: VERSE_SLIDE_MS,
  scrub: VERSE_SCRUB_SLIDE_MS,
}

/** How far each verse moves while it fades, in points. */
export const VERSE_SLIDE_SHIFT = 12

/** A verse fainter than this is gone; it needs no still copy. */
const MIN_OPACITY = 0.02

/** A verse the live layer can show. `index` orders the verses of a chapter. */
export type StageVerse<V> = {
  key: string
  chapterKey: string
  index: number
  view: V
}

/** Where a verse is on screen: its opacity, and its offset in points. */
export type VersePlace = { opacity: number; x: number; y: number }

const AT_REST: VersePlace = { opacity: 1, x: 0, y: 0 }

/** A verse that leaves as a still copy, from where it was on screen. */
export type LeavingVerse<V, F> = VersePlace & { verse: StageVerse<V>; fit: F }

/** One verse change. `from` is null when no verse shows as it starts. The
 *  axis is "verse" (up and down) or "chapter" (left and right). */
export type StageChange<V, F> = {
  id: number
  pace: VersePace
  axis: SwipeAxis
  direction: MoveDirection
  from: LeavingVerse<V, F> | null
}

type Request = {
  pace: VersePace
  axis: SwipeAxis
  direction: MoveDirection | null
}

export type VerseStage<V, F> = {
  /** The last verse key and move id seen, so each one counts once. */
  seenKey: string | null
  seenSlideId: number
  /** The verse on the live layer. */
  shown: StageVerse<V> | null
  /** The last fit the live layer reported, for the still copy. */
  fit: { key: string; fit: F } | null
  change: StageChange<V, F> | null
  /** The newest change asked for whose verse is not on the live layer yet. */
  waiting: Request | null
  /** A change whose verse never reports its fit starts after a short wait. */
  forced: number | null
  serial: number
}

export type StageInput<V> = {
  live: StageVerse<V> | null
  /** The next verse's translation or chapter is loading. */
  loading: boolean
  slide: VerseSlide | null
  scrubbing: boolean
  reduceMotion: boolean
}

export function initialStage<V, F>(input: StageInput<V>): VerseStage<V, F> {
  return {
    seenKey: input.live?.key ?? null,
    seenSlideId: input.slide?.id ?? 0,
    shown: input.live,
    fit: null,
    change: null,
    waiting: null,
    forced: null,
    serial: 0,
  }
}

// Runs in render, so the still copy and the new verse commit together. A
// verse that arrives during a change waits here; `interruptChange` takes it,
// because only the component knows how far the running change has gone.
export function advanceStage<V, F>(
  stage: VerseStage<V, F>,
  input: StageInput<V>,
  sameView: (a: V, b: V) => boolean,
): VerseStage<V, F> {
  const { live, slide } = input
  const liveKey = live?.key ?? null
  const slideId = slide?.id ?? 0
  const moved = slide !== null && slideId !== stage.seenSlideId
  const changed = liveKey !== stage.seenKey
  let next = stage
  if (moved || changed) {
    next = { ...next, seenKey: liveKey, seenSlideId: slideId }
  }

  if (input.reduceMotion) {
    if (!live) return next.change || next.waiting ? stopAll(next) : next
    if (next.shown?.key === live.key && sameView(next.shown.view, live.view)) {
      return next.change || next.waiting ? stopAll(next) : next
    }
    return { ...stopAll(next), shown: live }
  }

  const request: Request | null = moved
    ? {
        pace: "move",
        axis: slide.axis ?? "verse",
        direction: slide.direction,
      }
    : changed && live && input.scrubbing
      ? { pace: "scrub", axis: "verse", direction: null }
      : null
  if (request) {
    next = { ...next, waiting: request }
  } else if (changed && live && !next.waiting) {
    // A jump or a new translation changes in place.
    next = { ...next, shown: live, change: null }
  }

  if (!live) {
    // A change needs a verse to go to. A failed load ends the wait too.
    if (next.change) next = { ...next, change: null }
    if (next.waiting && !input.loading) next = { ...next, waiting: null }
    return next
  }

  const shown = next.shown
  if (shown?.key === live.key) {
    if (!sameView(shown.view, live.view)) next = { ...next, shown: live }
    if (next.waiting && !next.change) next = { ...next, waiting: null }
    return next
  }
  if (next.change) return next
  const fit = next.fit
  if (next.waiting && shown && fit?.key === shown.key) {
    const id = next.serial + 1
    return {
      ...next,
      serial: id,
      change: {
        id,
        pace: next.waiting.pace,
        axis: next.waiting.axis,
        direction: directionBetween(shown, live, next.waiting.direction),
        from: { ...AT_REST, verse: shown, fit: fit.fit },
      },
      shown: live,
      waiting: null,
    }
  }
  return { ...next, shown: live, waiting: null }
}

function stopAll<V, F>(stage: VerseStage<V, F>): VerseStage<V, F> {
  return { ...stage, change: null, waiting: null }
}

/** A scrub has no direction of its own; a move keeps its own across books. */
function directionBetween<V>(
  from: StageVerse<V>,
  to: StageVerse<V>,
  asked: MoveDirection | null,
): MoveDirection {
  if (from.chapterKey === to.chapterKey && from.index !== to.index) {
    return to.index > from.index ? "forward" : "back"
  }
  return asked ?? "forward"
}

/** A newer verse waits while a change runs: the component interrupts it. */
export function needsInterrupt<V, F>(
  stage: VerseStage<V, F>,
  live: StageVerse<V> | null,
): boolean {
  const { change, shown, waiting } = stage
  return (
    change !== null &&
    waiting !== null &&
    live !== null &&
    shown !== null &&
    shown.key !== live.key
  )
}

// The running change stops at `progress`, and the verse on screen at that
// point leaves from where it is. The two verses never show together, so the
// one visible verse is all that needs a still copy.
export function interruptChange<V, F>(
  stage: VerseStage<V, F>,
  live: StageVerse<V>,
  progress: number,
): VerseStage<V, F> {
  const { change, shown, waiting } = stage
  if (!change || !shown || !waiting || shown.key === live.key) return stage
  const curves = slideCurves(
    change.direction,
    change.axis,
    change.from,
    changeTiming(change).split,
  )
  const at = (curve: SlideCurve) => curveAt(curve, progress)
  // A verse that has not reported its fit is still hidden.
  const shownFit = stage.fit?.key === shown.key ? stage.fit.fit : null
  const incoming = shownFit === null ? 0 : at(curves.incoming.opacity)
  let from: LeavingVerse<V, F> | null = null
  if (shownFit !== null && incoming >= MIN_OPACITY) {
    from = {
      verse: shown,
      fit: shownFit,
      opacity: incoming,
      x: at(curves.incoming.translateX),
      y: at(curves.incoming.translateY),
    }
  } else if (change.from) {
    const opacity = at(curves.outgoing.opacity)
    if (opacity >= MIN_OPACITY) {
      from = {
        ...change.from,
        opacity,
        x: at(curves.outgoing.translateX),
        y: at(curves.outgoing.translateY),
      }
    }
  }
  const id = stage.serial + 1
  return {
    ...stage,
    serial: id,
    change: {
      id,
      pace: waiting.pace,
      axis: waiting.axis,
      direction: directionBetween(
        from?.verse ?? shown,
        live,
        waiting.direction,
      ),
      from,
    },
    shown: live,
    waiting: null,
  }
}

/** The live layer measured its verse; the still copy draws with this fit. */
export function reportFit<V, F>(
  stage: VerseStage<V, F>,
  key: string,
  fit: F,
  sameFit: (a: F, b: F) => boolean,
): VerseStage<V, F> {
  if (stage.fit?.key === key && sameFit(stage.fit.fit, fit)) return stage
  return { ...stage, fit: { key, fit } }
}

export function endChange<V, F>(
  stage: VerseStage<V, F>,
  id: number,
): VerseStage<V, F> {
  return stage.change?.id === id ? { ...stage, change: null } : stage
}

export function forceChange<V, F>(
  stage: VerseStage<V, F>,
  id: number,
): VerseStage<V, F> {
  return stage.change?.id === id && stage.forced !== id
    ? { ...stage, forced: id }
    : stage
}

/** The old verse waited too long for the next chapter; the move ends. */
export function endWait<V, F>(stage: VerseStage<V, F>): VerseStage<V, F> {
  return stage.waiting ? { ...stage, waiting: null } : stage
}

/** A change from rest waits for the new verse's fit. A verse that is already
 *  fading keeps its motion, so an interrupted change runs at once. */
export function changeReady<V, F>(stage: VerseStage<V, F>): boolean {
  const { change } = stage
  if (!change) return false
  if (!change.from || change.from.opacity < 1) return true
  return stage.fit?.key === stage.shown?.key || stage.forced === change.id
}

/** The change's length in ms, and the progress where the old verse is gone.
 *  A faint old verse fades out sooner, so the new verse comes in sooner. */
export function changeTiming(change: {
  pace: VersePace
  from: VersePlace | null
}): { duration: number; split: number } {
  const half = PACE_MS[change.pace] / 2
  const out = half * (change.from?.opacity ?? 0)
  return { duration: out + half, split: out / (out + half) }
}

export type StageStill<V, F> = {
  id: number
  leaving: LeavingVerse<V, F>
  /** False while the old verse waits in place for the next chapter. */
  moving: boolean
}

/** The still copy on screen, if any. */
export function stageStill<V, F>(
  stage: VerseStage<V, F>,
  input: Pick<StageInput<V>, "live" | "loading">,
): StageStill<V, F> | null {
  const { change, shown, fit } = stage
  if (input.live) {
    return change?.from
      ? { id: change.id, leaving: change.from, moving: true }
      : null
  }
  if (!stage.waiting || !input.loading || !shown || fit?.key !== shown.key) {
    return null
  }
  return {
    id: stage.serial + 1,
    leaving: { ...AT_REST, verse: shown, fit: fit.fit },
    moving: false,
  }
}

// ── The curves ──────────────────────────────────────────────────────────────

/** An interpolation over the change's progress, from 0 to 1. */
export type SlideCurve = { inputRange: number[]; outputRange: number[] }

type LayerCurves = {
  opacity: SlideCurve
  translateX: SlideCurve
  translateY: SlideCurve
}

export type SlideCurves = { outgoing: LayerCurves; incoming: LayerCurves }

/** Samples per curve. The native driver only interpolates in straight lines. */
const CURVE_STEPS = 8

const easeIn = (t: number) => t * t
const easeOut = (t: number) => 1 - (1 - t) ** 3

function curve(
  start: number,
  end: number,
  from: number,
  to: number,
  easing: (t: number) => number,
): SlideCurve {
  const inputRange: number[] = []
  const outputRange: number[] = []
  for (let step = 0; step <= CURVE_STEPS; step += 1) {
    const t = step / CURVE_STEPS
    inputRange.push(start + (end - start) * t)
    outputRange.push(from + (to - from) * easing(t))
  }
  return { inputRange, outputRange }
}

const still = (value: number): SlideCurve => ({
  inputRange: [0, 1],
  outputRange: [value, value],
})

// Forward moves both verses up for the next verse, and left for the next
// chapter. The old verse fades out until `split`, and the new verse fades in
// after it; they never overlap. The other axis holds where the verse was.
export function slideCurves(
  direction: MoveDirection,
  axis: SwipeAxis,
  from: VersePlace | null,
  split: number,
  shift: number = VERSE_SLIDE_SHIFT,
): SlideCurves {
  const sign = direction === "forward" ? -1 : 1
  const start = from ?? { opacity: 0, x: 0, y: 0 }
  const vertical = axis === "verse"
  const along = vertical ? start.y : start.x
  const across = vertical ? start.x : start.y
  const outgoingAlong =
    split > 0
      ? curve(0, split, along, along + sign * shift * start.opacity, easeIn)
      : still(along)
  const incomingAlong = curve(split, 1, -sign * shift, 0, easeOut)
  return {
    outgoing: {
      opacity: split > 0 ? curve(0, split, start.opacity, 0, easeIn) : still(0),
      translateX: vertical ? still(across) : outgoingAlong,
      translateY: vertical ? outgoingAlong : still(across),
    },
    incoming: {
      opacity: curve(split, 1, 0, 1, easeOut),
      translateX: vertical ? still(0) : incomingAlong,
      translateY: vertical ? incomingAlong : still(0),
    },
  }
}

/** A curve's value at `progress`, as the native driver computes it. */
export function curveAt(curve: SlideCurve, progress: number): number {
  const { inputRange: xs, outputRange: ys } = curve
  const last = xs.length - 1
  if (progress <= xs[0]!) return ys[0]!
  if (progress >= xs[last]!) return ys[last]!
  for (let i = 1; i <= last; i += 1) {
    const x0 = xs[i - 1]!
    const x1 = xs[i]!
    if (progress <= x1) {
      const t = x1 === x0 ? 1 : (progress - x0) / (x1 - x0)
      return ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t
    }
  }
  return ys[last]!
}
