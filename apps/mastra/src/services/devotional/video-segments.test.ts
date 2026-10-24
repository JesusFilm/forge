import { describe, expect, it } from "vitest"

import { buildDevotionalSegments } from "./video-segments"
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
    "God entered history. The Word became flesh. He dwelt among us. He understands. He came near. That changes everything.",
  questions: [
    "What does the incarnation mean to you?",
    "Where do you need Him?",
  ],
  furtherReading: null,
  blockOrder: ["hook", "scripture", "reflection", "questions"],
}

describe("buildDevotionalSegments", () => {
  it("emits hook, scripture, reflection(s), questions in order", () => {
    const segs = buildDevotionalSegments(DEVOTIONAL)
    expect(segs[0].kind).toBe("hook")
    expect(segs[1].kind).toBe("scripture")
    expect(segs.at(-1)?.kind).toBe("questions")
    expect(segs.filter((s) => s.kind === "reflection").length).toBeGreaterThan(
      0,
    )
  })

  it("each segment has display lines and spoken text", () => {
    for (const s of buildDevotionalSegments(DEVOTIONAL)) {
      expect(s.lines.length).toBeGreaterThan(0)
      expect(s.spokenText.trim().length).toBeGreaterThan(0)
    }
  })

  it("hook speaks title + summary; scripture speaks reference + verse", () => {
    const segs = buildDevotionalSegments(DEVOTIONAL)
    expect(segs[0].spokenText).toBe("Christmas Day. The Word made flesh.")
    expect(segs[1].spokenText).toBe(
      "John 1:14. And the Word became flesh and dwelt among us.",
    )
  })

  it("narrates the questions on its card (for video sync)", () => {
    const q = buildDevotionalSegments(DEVOTIONAL).at(-1)
    expect(q?.spokenText).toContain("What does the incarnation mean to you?")
  })
})
