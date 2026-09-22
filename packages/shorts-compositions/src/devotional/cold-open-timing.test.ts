import { describe, expect, it } from "vitest"

import {
  ACCENT_COOL_SEC,
  FOCUS_BLUR_PX,
  FOCUS_STAGGER_SEC,
  STAMP_ENTRY_SCALE,
  STAMP_WORD_SEC,
  TYPEWRITER_CPS,
  accentMix,
  buildSeconds,
  coldOpenTimeline,
  cursorVisible,
  focusWordState,
  mixColour,
  stampScale,
  stampedWordIndex,
  typedCharCount,
} from "./cold-open-timing"

const FPS = 30

describe("buildSeconds", () => {
  it("scales a typed line by its character count", () => {
    expect(buildSeconds("ABCDEFGHIJKLM", "typewriter")).toBeCloseTo(
      13 / TYPEWRITER_CPS,
    )
  })

  it("gives a stamped line one beat per word", () => {
    expect(buildSeconds("ONE TWO THREE", "stamp")).toBeCloseTo(
      3 * STAMP_WORD_SEC,
    )
  })

  it("staggers a focus line and adds the last word's resolve", () => {
    // 3 words => 2 gaps of stagger, plus one resolve.
    expect(buildSeconds("ONE TWO THREE", "focus")).toBeCloseTo(
      2 * FOCUS_STAGGER_SEC + 0.24,
    )
  })

  it("returns zero for an empty line", () => {
    expect(buildSeconds("   ", "stamp")).toBe(0)
  })
})

describe("coldOpenTimeline", () => {
  const lines = [
    { text: "FIRST LINE", anim: "typewriter" as const },
    { text: "SECOND LINE", anim: "stamp" as const },
    { text: "THIRD LINE", anim: "focus" as const },
  ]

  it("covers the card exactly, with no gap and no overrun", () => {
    const w = coldOpenTimeline(lines, 195, FPS)
    expect(w).toHaveLength(3)
    expect(w[0]?.startFrame).toBe(0)
    expect(w.at(-1)?.endFrame).toBe(195)
    for (let i = 1; i < w.length; i++) {
      expect(w[i]?.startFrame).toBe(w[i - 1]?.endFrame)
    }
  })

  it("honours an explicit duration and shares the rest evenly", () => {
    const w = coldOpenTimeline(
      [
        { text: "PINNED", anim: "stamp" as const, durationSec: 3 },
        { text: "FREE ONE", anim: "focus" as const },
        { text: "FREE TWO", anim: "focus" as const },
      ],
      9 * FPS,
      FPS,
    )
    expect(w[0]?.endFrame).toBe(3 * FPS)
    // 6s left over, split evenly between the two unpinned lines.
    expect((w[1]?.endFrame ?? 0) - (w[1]?.startFrame ?? 0)).toBe(3 * FPS)
  })

  it("never leaves a line shorter than its own entrance", () => {
    // One second of card for a line that needs far longer to type.
    const w = coldOpenTimeline(
      [
        {
          text: "A VERY LONG LINE THAT CANNOT POSSIBLY TYPE IN TIME",
          anim: "typewriter",
        },
      ],
      FPS,
      FPS,
    )
    expect(w[0]?.endFrame).toBe(FPS)
  })

  it("scales back when pinned durations overrun the card", () => {
    const w = coldOpenTimeline(
      [
        { text: "A", anim: "stamp" as const, durationSec: 10 },
        { text: "B", anim: "stamp" as const, durationSec: 10 },
      ],
      4 * FPS,
      FPS,
    )
    expect(w.at(-1)?.endFrame).toBe(4 * FPS)
    expect(w[0]?.endFrame).toBeLessThan(4 * FPS)
  })

  it("returns nothing for a card with no lines or no frames", () => {
    expect(coldOpenTimeline([], 120, FPS)).toEqual([])
    expect(coldOpenTimeline(lines, 0, FPS)).toEqual([])
  })
})

describe("typewriter", () => {
  it("reveals nothing before it starts and everything at the end", () => {
    expect(typedCharCount(-0.1, 10)).toBe(0)
    expect(typedCharCount(0, 10)).toBe(0)
    expect(typedCharCount(100, 10)).toBe(10)
  })

  it("advances at the configured rate", () => {
    expect(typedCharCount(1, 999)).toBe(TYPEWRITER_CPS)
  })

  it("holds the cursor solid while typing, then blinks", () => {
    expect(cursorVisible(0.31, true)).toBe(true)
    const a = cursorVisible(0, false)
    const b = cursorVisible(1 / 2.6 + 0.01, false)
    expect(a).not.toBe(b)
  })
})

describe("stamp", () => {
  it("shows one word per beat and stops at the last", () => {
    expect(stampedWordIndex(-1, 3)).toBe(-1)
    expect(stampedWordIndex(0, 3)).toBe(0)
    expect(stampedWordIndex(STAMP_WORD_SEC * 1.5, 3)).toBe(1)
    expect(stampedWordIndex(STAMP_WORD_SEC * 99, 3)).toBe(2)
  })

  it("settles from oversized to actual size", () => {
    expect(stampScale(0)).toBeCloseTo(STAMP_ENTRY_SCALE)
    expect(stampScale(5)).toBeCloseTo(1)
  })
})

describe("focus", () => {
  it("keeps a word hidden until its turn", () => {
    const s = focusWordState(0, 2)
    expect(s.opacity).toBe(0)
    expect(s.blurPx).toBe(FOCUS_BLUR_PX)
  })

  it("resolves to sharp and opaque", () => {
    const s = focusWordState(10, 0)
    expect(s.opacity).toBe(1)
    expect(s.blurPx).toBeCloseTo(0)
  })

  it("staggers later words behind earlier ones", () => {
    const first = focusWordState(FOCUS_STAGGER_SEC, 0)
    const second = focusWordState(FOCUS_STAGGER_SEC, 1)
    expect(first.opacity).toBeGreaterThan(second.opacity)
  })
})

describe("accent colour", () => {
  it("arrives warm and cools to the heading colour", () => {
    expect(accentMix(0)).toBe(0)
    expect(accentMix(ACCENT_COOL_SEC)).toBeCloseTo(1)
  })

  it("never cools a word the line pins as its accent", () => {
    expect(accentMix(99, true)).toBe(0)
  })

  it("returns the endpoints cleanly and blends in between", () => {
    expect(mixColour("#a", "#b", 0)).toBe("#a")
    expect(mixColour("#a", "#b", 1)).toBe("#b")
    expect(mixColour("#a", "#b", 0.5)).toContain("color-mix")
  })
})
