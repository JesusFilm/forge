// Pure timing maths for the `cold-open` card. No React, no Remotion — every
// function here is a plain calculation so the rhythm can be unit-tested
// without rendering a frame.
//
// A cold open is a short hook that runs BEFORE the devotional proper. Each
// line carries its own entrance, so the card builds a rhythm rather than
// repeating one animation three times.

/** Entrance animations a cold-open line can use. */
export const COLD_OPEN_ANIMS = ["typewriter", "stamp", "focus"] as const
export type ColdOpenAnim = (typeof COLD_OPEN_ANIMS)[number]

/** Characters per second for the `typewriter` entrance. */
export const TYPEWRITER_CPS = 26
/** Cursor blinks per second (full on/off cycle counts as one). */
export const CURSOR_BLINK_HZ = 2.6
/** Seconds a word spends warm (accent colour) before cooling to the heading colour. */
export const ACCENT_COOL_SEC = 0.3
/** Per-word beat for the `stamp` entrance. */
export const STAMP_WORD_SEC = 0.42
/** Seconds a stamped word takes to settle from its oversized entry. */
export const STAMP_SETTLE_SEC = 0.13
/** Scale a stamped word enters at before settling to 1. */
export const STAMP_ENTRY_SCALE = 1.18
/** Per-word stagger for the `focus` entrance. */
export const FOCUS_STAGGER_SEC = 0.19
/** Seconds one `focus` word takes to resolve from blurred to sharp. */
export const FOCUS_RESOLVE_SEC = 0.24
/** Blur (in layout px, before `px()` scaling) a `focus` word starts at. */
export const FOCUS_BLUR_PX = 15

export type ColdOpenLineSpec = {
  text: string
  anim: ColdOpenAnim
  /** Explicit on-screen length. When absent the line takes an even share. */
  durationSec?: number
}

export type ColdOpenWindow = {
  index: number
  text: string
  anim: ColdOpenAnim
  startFrame: number
  endFrame: number
  /** Frames the entrance itself occupies; the rest of the window is a hold. */
  buildFrames: number
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Smooth 0→1 with a soft landing. Matches the feel of `reveal`'s easing. */
export function easeOut(p: number): number {
  return 1 - (1 - clamp01(p)) ** 3
}

/** Seconds the entrance of one line occupies, before any hold. */
export function buildSeconds(text: string, anim: ColdOpenAnim): number {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 0
  switch (anim) {
    case "typewriter":
      return text.trim().length / TYPEWRITER_CPS
    case "stamp":
      return words.length * STAMP_WORD_SEC
    default:
      return (words.length - 1) * FOCUS_STAGGER_SEC + FOCUS_RESOLVE_SEC
  }
}

/**
 * Split the card's frames across its lines.
 *
 * Lines with an explicit `durationSec` keep it. Whatever is left over is
 * shared evenly between the rest, so a caller can pin one beat (the line that
 * must land on a cut) and let the others fill the gap. A line never gets less
 * than its own entrance length, because a line that vanishes before it has
 * finished appearing cannot be read.
 */
export function coldOpenTimeline(
  lines: ColdOpenLineSpec[],
  durationInFrames: number,
  fps: number,
): ColdOpenWindow[] {
  if (lines.length === 0 || durationInFrames <= 0 || fps <= 0) return []

  const builds = lines.map((l) => buildSeconds(l.text, l.anim))
  const total = durationInFrames / fps
  const pinned = lines.reduce((sum, l) => sum + (l.durationSec ?? 0), 0)
  const free = lines.filter((l) => l.durationSec == null)
  const share = free.length > 0 ? Math.max(0, total - pinned) / free.length : 0

  const seconds = lines.map((l, i) =>
    Math.max(l.durationSec ?? share, builds[i] ?? 0),
  )

  // Explicit durations plus the minimums can overrun the card; scale back so
  // the last line still ends exactly on the card boundary.
  const sum = seconds.reduce((a, b) => a + b, 0)
  const factor = sum > total && sum > 0 ? total / sum : 1

  const out: ColdOpenWindow[] = []
  let cursor = 0
  lines.forEach((line, index) => {
    const isLast = index === lines.length - 1
    const start = Math.round(cursor * fps)
    cursor += (seconds[index] ?? 0) * factor
    const end = isLast ? durationInFrames : Math.round(cursor * fps)
    out.push({
      index,
      text: line.text,
      anim: line.anim,
      startFrame: start,
      endFrame: end,
      buildFrames: Math.round((builds[index] ?? 0) * factor * fps),
    })
  })
  return out
}

/** How many characters of a typed line are visible after `elapsedSec`. */
export function typedCharCount(elapsedSec: number, length: number): number {
  if (elapsedSec <= 0) return 0
  return Math.min(length, Math.floor(elapsedSec * TYPEWRITER_CPS))
}

/** Whether the typing cursor is painted this instant. Solid while still typing. */
export function cursorVisible(elapsedSec: number, typing: boolean): boolean {
  if (typing) return true
  return Math.floor(elapsedSec * CURSOR_BLINK_HZ) % 2 === 0
}

/** Index of the word a `stamp` line is currently showing, or -1 before the first. */
export function stampedWordIndex(elapsedSec: number, count: number): number {
  if (elapsedSec < 0 || count === 0) return -1
  return Math.min(count - 1, Math.floor(elapsedSec / STAMP_WORD_SEC))
}

/** Scale of a stamped word `ageSec` after it landed. */
export function stampScale(ageSec: number): number {
  const settle = easeOut(ageSec / STAMP_SETTLE_SEC)
  return STAMP_ENTRY_SCALE - (STAMP_ENTRY_SCALE - 1) * settle
}

/** Opacity + blur of one `focus` word, `elapsedSec` into its line. */
export function focusWordState(
  elapsedSec: number,
  wordIndex: number,
): { opacity: number; blurPx: number; ageSec: number } {
  const ageSec = elapsedSec - wordIndex * FOCUS_STAGGER_SEC
  if (ageSec <= 0) return { opacity: 0, blurPx: FOCUS_BLUR_PX, ageSec }
  const p = easeOut(ageSec / FOCUS_RESOLVE_SEC)
  return {
    opacity: clamp01(ageSec / (FOCUS_RESOLVE_SEC * 0.62)),
    blurPx: FOCUS_BLUR_PX * (1 - p),
    ageSec,
  }
}

/**
 * How far a freshly arrived word has cooled from the accent colour to the
 * heading colour. 0 = fully accent, 1 = fully heading. A word named as the
 * line's accent never cools.
 */
export function accentMix(ageSec: number, holdAccent = false): number {
  if (holdAccent) return 0
  return easeOut(ageSec / ACCENT_COOL_SEC)
}

/** Blend two CSS colours for the warm-to-cool word transition. */
export function mixColour(from: string, to: string, t: number): string {
  const p = clamp01(t)
  if (p <= 0) return from
  if (p >= 1) return to
  return `color-mix(in srgb, ${to} ${(p * 100).toFixed(1)}%, ${from})`
}
