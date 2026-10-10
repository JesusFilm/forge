import { describe, expect, it } from "vitest"

import {
  buildCards,
  buildDrawtextFilter,
  computeCardTimings,
  wrapText,
  _internal,
} from "./video-assembler"
import type { Devotional } from "./types"

const DEVOTIONAL: Devotional = {
  date: "2026-12-25",
  hook: {
    type: "holiday",
    title: "Christmas Day",
    summary: "The Word made flesh.",
    sourceUrl: null,
  },
  scripture: {
    reference: "John 1:14",
    text: "And the Word became flesh and dwelt among us.",
    translation: "ESV",
    needsCanonicalSource: true,
  },
  video: null,
  videoMatch: "none",
  reflection:
    "God entered history. The Word became flesh. He dwelt among us. He understands our struggles. He came near. That changes everything about how we live.",
  questions: [
    "What does the incarnation mean to you?",
    "Where do you need His nearness?",
  ],
  furtherReading: null,
  blockOrder: ["hook", "scripture", "reflection", "questions"],
}

describe("wrapText", () => {
  it("wraps to the max width without breaking words", () => {
    const lines = wrapText("the quick brown fox jumps", 9)
    expect(lines.every((l) => l.length <= 9 || !l.includes(" "))).toBe(true)
    expect(lines.join(" ")).toBe("the quick brown fox jumps")
  })

  it("preserves explicit newlines as separate lines", () => {
    expect(wrapText("a\nb", 80)).toEqual(["a", "b"])
  })
})

describe("buildCards", () => {
  it("produces hook, scripture, reflection(s), and questions cards in order", () => {
    const cards = buildCards(DEVOTIONAL)
    expect(cards[0].kind).toBe("hook")
    expect(cards[1].kind).toBe("scripture")
    expect(cards.at(-1)?.kind).toBe("questions")
    expect(cards.some((c) => c.kind === "reflection")).toBe(true)
    // scripture card includes the reference line
    expect(cards[1].lines.join(" ")).toContain("John 1:14")
  })
})

describe("computeCardTimings", () => {
  it("covers the full duration with each card at least the minimum", () => {
    const cards = buildCards(DEVOTIONAL)
    const timings = computeCardTimings(cards, 60, 2.5)
    expect(timings[0].start).toBe(0)
    expect(timings.at(-1)?.end).toBeCloseTo(60, 1)
    for (const t of timings)
      expect(t.end - t.start).toBeGreaterThanOrEqual(2.49)
    // monotonic, contiguous
    for (let i = 1; i < timings.length; i++) {
      expect(timings[i].start).toBeCloseTo(timings[i - 1].end, 5)
    }
  })
})

describe("buildDrawtextFilter", () => {
  it("emits one enabled drawtext per card and a [vout] sink", () => {
    const cards = buildCards(DEVOTIONAL)
    const timings = computeCardTimings(cards, 30)
    const filter = buildDrawtextFilter({
      videoLabel: "0:v",
      fontFile: "/System/Library/Fonts/Supplemental/Georgia.ttf",
      cards,
      timings,
      textFiles: cards.map((_, i) => `/tmp/card-${i}.txt`),
    })
    expect((filter.match(/drawtext=/g) ?? []).length).toBe(cards.length)
    expect(filter).toContain("between(t,0.00,")
    expect(filter).toContain("[vout]")
  })

  it("escapes colons in paths for the drawtext filter syntax", () => {
    expect(_internal.escapeDrawtextPath("/a:b/c.ttf")).toBe("/a\\:b/c.ttf")
    expect(_internal.escapeDrawtextPath("/no/colon.ttf")).toBe("/no/colon.ttf")
  })
})
