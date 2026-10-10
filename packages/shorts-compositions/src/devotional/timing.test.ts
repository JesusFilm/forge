import { describe, expect, it } from "vitest"

import { computeCardFrames, framesFromDurations } from "./timing"
import type { DevotionalCard } from "./schema"

const audioCards: DevotionalCard[] = [
  { kind: "cover", title: "…", durationSec: 6, audioFile: "0.mp3" },
  { kind: "scripture", verse: "…", durationSec: 12, audioFile: "1.mp3" },
  {
    kind: "questions",
    questions: ["one"],
    durationSec: 24,
    audioFile: "2.mp3",
  },
]

const cards: DevotionalCard[] = [
  { kind: "cover", title: "Cover" },
  { kind: "scripture", verse: "…" },
  { kind: "reflection-full", paragraphs: ["a"] },
  { kind: "questions", questions: ["one", "two"] },
]

describe("computeCardFrames", () => {
  it("returns empty for no cards", () => {
    expect(computeCardFrames([], 900, 75)).toEqual([])
  })

  it("is contiguous and each card gets an equal, >= min share", () => {
    const total = 2800
    const frames = computeCardFrames(cards, total, 75)
    expect(frames).toHaveLength(cards.length)
    expect(frames[0].from).toBe(0)
    for (let i = 1; i < frames.length; i++) {
      expect(frames[i].from).toBe(
        frames[i - 1].from + frames[i - 1].durationInFrames,
      )
    }
    for (const f of frames)
      expect(f.durationInFrames).toBeGreaterThanOrEqual(75)
    // even split
    expect(frames[0].durationInFrames).toBe(frames[1].durationInFrames)
  })
})

describe("framesFromDurations", () => {
  it("times each card to its own audio + a per-card tail", () => {
    const frames = framesFromDurations(audioCards, 30, 12)
    expect(frames[0].durationInFrames).toBe(6 * 30 + 12)
    expect(frames[1].from).toBe(frames[0].durationInFrames)
  })

  it("extends ONLY the final card by the outro hold", () => {
    const withHold = framesFromDurations(audioCards, 30, 12, 240)
    const without = framesFromDurations(audioCards, 30, 12)
    expect(withHold[0].durationInFrames).toBe(without[0].durationInFrames)
    const last = withHold.length - 1
    expect(withHold[last].durationInFrames).toBe(
      without[last].durationInFrames + 240,
    )
  })
})
