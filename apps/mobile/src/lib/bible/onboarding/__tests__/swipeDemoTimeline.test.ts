// The first-run swipe demo timeline (feat-553 R16): three cycles of a verse
// swipe then a chapter swipe, a pause after each cycle, then a fade-out.
import {
  SWIPE_DEMO_CYCLES,
  SWIPE_DEMO_FADE_OUT_MS,
  SWIPE_DEMO_MS,
  SWIPE_DEMO_PAUSE_MS,
  demoOpacityKeyframes,
  partOpacityKeyframes,
  partTravelKeyframes,
  type Keyframes,
} from "../swipeDemoTimeline"

/** What `Animated` reads for a clamped interpolation at time `t`. */
function valueAt({ inputRange, outputRange }: Keyframes, t: number): number {
  if (t <= inputRange[0]!) return outputRange[0]!
  for (let i = 1; i < inputRange.length; i += 1) {
    const from = inputRange[i - 1]!
    const to = inputRange[i]!
    if (t <= to) {
      if (to === from) return outputRange[i]!
      const share = (t - from) / (to - from)
      return (
        outputRange[i - 1]! + share * (outputRange[i]! - outputRange[i - 1]!)
      )
    }
  }
  return outputRange[outputRange.length - 1]!
}

/** The spans, in whole milliseconds, where the keyframes are above zero. */
function visibleSpans(keyframes: Keyframes): [number, number][] {
  const spans: [number, number][] = []
  let start: number | null = null
  for (let t = 0; t <= SWIPE_DEMO_MS; t += 1) {
    const visible = valueAt(keyframes, t) > 0
    if (visible && start === null) start = t
    if (!visible && start !== null) {
      spans.push([start, t])
      start = null
    }
  }
  if (start !== null) spans.push([start, SWIPE_DEMO_MS])
  return spans
}

const verse = partOpacityKeyframes("verse")
const chapter = partOpacityKeyframes("chapter")

describe("the swipe demo timeline (R16)", () => {
  it("plays at least three cycles", () => {
    expect(SWIPE_DEMO_CYCLES).toBeGreaterThanOrEqual(3)
    expect(visibleSpans(verse)).toHaveLength(SWIPE_DEMO_CYCLES)
    expect(visibleSpans(chapter)).toHaveLength(SWIPE_DEMO_CYCLES)
  })

  it("shows the verse swipe, then the chapter swipe, in each cycle", () => {
    const verses = visibleSpans(verse)
    const chapters = visibleSpans(chapter)
    for (let cycle = 0; cycle < SWIPE_DEMO_CYCLES; cycle += 1) {
      expect(chapters[cycle]![0]).toBeGreaterThanOrEqual(verses[cycle]![1])
    }
  })

  it("pauses at least 0.5 s after each cycle, with nothing shown", () => {
    const verses = visibleSpans(verse)
    const chapters = visibleSpans(chapter)
    const fadeFrom = SWIPE_DEMO_MS - SWIPE_DEMO_FADE_OUT_MS
    for (let cycle = 0; cycle < SWIPE_DEMO_CYCLES; cycle += 1) {
      const cycleEnd = chapters[cycle]![1]
      const next =
        cycle + 1 < SWIPE_DEMO_CYCLES ? verses[cycle + 1]![0] : fadeFrom
      expect(next - cycleEnd).toBeGreaterThanOrEqual(SWIPE_DEMO_PAUSE_MS)
    }
    expect(SWIPE_DEMO_PAUSE_MS).toBe(500)
  })

  it("keeps the demo shown until the last pause ends, then fades it out", () => {
    const whole = demoOpacityKeyframes()
    const lastChapterEnd = visibleSpans(chapter)[SWIPE_DEMO_CYCLES - 1]![1]
    expect(valueAt(whole, lastChapterEnd + SWIPE_DEMO_PAUSE_MS)).toBe(1)
    expect(valueAt(whole, SWIPE_DEMO_MS - SWIPE_DEMO_FADE_OUT_MS / 2)).toBe(0.5)
    expect(valueAt(whole, SWIPE_DEMO_MS)).toBe(0)
    expect(SWIPE_DEMO_FADE_OUT_MS).toBeGreaterThan(0)
  })

  it("moves the finger up for a verse and left for a chapter in every cycle", () => {
    const up = partTravelKeyframes("verse", 80)
    const left = partTravelKeyframes("chapter", 80)
    for (const [keyframes, spans] of [
      [up, visibleSpans(verse)],
      [left, visibleSpans(chapter)],
    ] as const) {
      for (const [start, end] of spans) {
        expect(valueAt(keyframes, start)).toBe(40)
        expect(valueAt(keyframes, end)).toBe(-40)
      }
    }
  })

  it("gives Animated input ranges that never go backwards", () => {
    for (const keyframes of [
      verse,
      chapter,
      partTravelKeyframes("verse", 80),
      demoOpacityKeyframes(),
    ]) {
      const { inputRange } = keyframes
      for (let i = 1; i < inputRange.length; i += 1) {
        expect(inputRange[i]!).toBeGreaterThanOrEqual(inputRange[i - 1]!)
      }
      expect(inputRange[inputRange.length - 1]).toBeLessThanOrEqual(
        SWIPE_DEMO_MS,
      )
    }
  })
})
