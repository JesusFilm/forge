import { describe, expect, it } from "vitest"

import {
  applyCuts,
  buildCues,
  cardStarts,
  manifestToSrt,
  noDashes,
  wrapTwoLines,
  type SrtManifest,
} from "./devotional-srt"

const w = (word: string, startSec: number, endSec: number) => ({
  word,
  startSec,
  endSec,
})

describe("cardStarts", () => {
  it("lays cards out as the composition does (audio + hold + tail, intro on the first)", () => {
    const m: SrtManifest = {
      introHoldSec: 1,
      outroHoldSec: 8,
      cards: [
        { kind: "video", durationSec: 10 },
        { kind: "step", durationSec: 2, holdSec: 1 },
        { kind: "reflection-focus", durationSec: 3, tailSec: 0 },
        { kind: "reflection-focus", durationSec: 3 },
      ],
    }
    // 10 + 1 intro + 0.8 tail = 11.8; step 2 + 1 + 0.8 = 3.8; then 3 + 0.
    expect(cardStarts(m)).toEqual([0, 11.8, 15.6, 18.6])
  })
})

describe("buildCues", () => {
  it("breaks at sentence ends and keeps lines within 42 characters", () => {
    const cues = buildCues([
      w("Look", 0, 0.2),
      w("at", 0.25, 0.3),
      w("who", 0.35, 0.5),
      w("tells", 0.55, 0.8),
      w("him", 0.85, 1),
      w("to", 1.05, 1.1),
      w("be", 1.15, 1.2),
      w("quiet.", 1.25, 1.6),
      w("Not", 2.4, 2.6),
      w("his", 2.65, 2.8),
      w("enemies.", 2.85, 3.3),
    ])
    expect(cues.map((c) => c.text)).toEqual([
      "Look at who tells him to be quiet.",
      "Not his enemies.",
    ])
    expect(cues[0].endSec).toBeLessThanOrEqual(cues[1].startSec)
  })

  it("never runs a cue past six seconds", () => {
    const words = Array.from({ length: 12 }, (_, i) =>
      w("so", i * 0.8, i * 0.8 + 0.3),
    )
    for (const c of buildCues(words))
      expect(c.endSec - c.startSec).toBeLessThanOrEqual(6.3)
  })
})

describe("wrapTwoLines", () => {
  it("splits a long cue near the middle, preferring a comma", () => {
    const t = wrapTwoLines(
      "but he shouted all the more, Son of David, have mercy on me!",
    )
    for (const line of t.split("\n"))
      expect(line.length).toBeLessThanOrEqual(42)
    expect(t.split("\n")).toHaveLength(2)
  })
})

describe("applyCuts", () => {
  it("drops cues inside a cut and shifts later ones back", () => {
    const out = applyCuts(
      [
        { startSec: 1, endSec: 2, text: "a" },
        { startSec: 11, endSec: 12, text: "cut" },
        { startSec: 21, endSec: 22, text: "b" },
      ],
      [{ fromSec: 10, toSec: 20 }],
    )
    expect(out).toEqual([
      { startSec: 1, endSec: 2, text: "a" },
      { startSec: 11, endSec: 12, text: "b" },
    ])
  })
})

describe("manifestToSrt", () => {
  it("adds the step lead to step words and writes SubRip stamps", () => {
    const srt = manifestToSrt({
      introHoldSec: 0,
      cards: [
        {
          kind: "step",
          durationSec: 2,
          stepLeadSec: 0.9,
          words: [w("Let's", 0, 0.3), w("look.", 0.4, 0.8)],
        },
      ],
    })
    expect(srt).toBe("1\n00:00:00,900 --> 00:00:01,950\nLet's look.\n")
  })
})

describe("noDashes", () => {
  it("turns range dashes into hyphens and word dashes into commas", () => {
    expect(noDashes("стихи восемнадцать–девятнадцать")).toBe(
      "стихи восемнадцать-девятнадцать",
    )
    expect(noDashes("He stopped — for one voice")).toBe(
      "He stopped, for one voice",
    )
  })
})
