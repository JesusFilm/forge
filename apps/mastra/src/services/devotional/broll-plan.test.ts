import { framesFromDurations } from "@forge/shorts-compositions/devotional-card-timing"
import { describe, expect, it } from "vitest"

import {
  type BrollCue,
  matchCue,
  planBrollAnchors,
  planBrollSegments,
} from "./broll-plan"

const cue = (start: number, text: string): BrollCue => ({
  start,
  end: start + 3,
  text,
})

// A small parable: every cue says "son", only one says "pigs".
const CUES: BrollCue[] = [
  cue(0, "There was a man who had two sons."),
  cue(10, "The younger son set off for a distant country."),
  cue(35, "He was sent to his fields to feed pigs."),
  cue(60, "Bring the best robe and the fattened calf."),
  cue(90, "Meanwhile the older son was in the field."),
  cue(120, "The older son became angry and refused to go in."),
  cue(150, "My son, the father said, you are always with me."),
  cue(170, "This brother of yours was dead and is alive again."),
]

describe("matchCue", () => {
  it("picks the cue that shares the rare words", () => {
    const m = matchCue("Look at where he ended up. Feeding pigs.", CUES)
    expect(m?.cue.start).toBe(35)
    expect(m?.words).toEqual(expect.arrayContaining(["feed", "pig"]))
  })

  it("returns null when only common or stop words are shared", () => {
    expect(matchCue("The son was there, and he gave it all.", CUES)).toBeNull()
    expect(matchCue("anything", [])).toBeNull()
  })

  it("does not match the share-of-the-estate scene on verbs of giving", () => {
    const cues = [...CUES, cue(5, "Give me my share of the estate.")]
    expect(
      matchCue("His gladness is a gift he will share with them.", cues),
    ).toBeNull()
  })
})

describe("planBrollSegments", () => {
  const base = { windowStart: 0, windowLen: 200, speed: 0.85, dissolveSec: 1.2 }

  it("without anchors plays one run from the window start", () => {
    const segs = planBrollSegments({ ...base, anchors: [], coverSec: 100 })
    expect(segs).toHaveLength(1)
    expect(segs[0].startSec).toBe(0)
    expect(segs[0].lengthSec).toBeCloseTo(102 * 0.85)
  })

  it("starts each anchor's shot exactly at its screen time", () => {
    const segs = planBrollSegments({
      ...base,
      windowLen: 300,
      coverSec: 100,
      anchors: [{ atSec: 40, sourceSec: 150, why: "" }],
    })
    expect(segs.map((s) => s.startSec)).toEqual([0, 150])
    // One dissolve of extra footage on the first piece keeps the second
    // starting at 40s once the seam overlap is taken back out.
    // The seam overlaps dissolveSec of SOURCE (the join is slowed after).
    expect((segs[0].lengthSec - base.dissolveSec) / base.speed).toBeCloseTo(40)
  })

  it("keeps every anchor on time through seams and a wrap, as the xfade join lays them out", () => {
    const anchors = [
      { atSec: 20, sourceSec: 150, why: "" },
      { atSec: 70, sourceSec: 40, why: "" },
      { atSec: 110, sourceSec: 180, why: "" },
    ]
    const segs = planBrollSegments({
      ...base,
      windowLen: 200,
      coverSec: 160,
      anchors,
    })
    // concatWithSeamXfade: piece k starts at (sum of earlier lengths - k*d)
    // in source seconds, and the joined file is then slowed by `speed`.
    const d = base.dissolveSec
    let running = 0
    const startsOnScreen = segs.map((sg) => {
      const at = running / base.speed
      running += sg.lengthSec - d
      return at
    })
    for (const a of anchors) {
      const k = segs.findIndex((sg) => sg.startSec === a.sourceSec)
      expect(k).toBeGreaterThan(0)
      expect(startsOnScreen[k]).toBeCloseTo(a.atSec, 5)
    }
    for (const sg of segs) {
      expect(sg.startSec + sg.lengthSec).toBeLessThanOrEqual(200 + 1e-9)
    }
    // ...and the joined footage covers the whole timeline.
    const joinedScreen = (running + d) / base.speed
    expect(joinedScreen).toBeGreaterThanOrEqual(160)
  })

  it("drops a run too short to cut to", () => {
    const segs = planBrollSegments({
      ...base,
      coverSec: 100,
      anchors: [
        { atSec: 40, sourceSec: 150, why: "" },
        { atSec: 41, sourceSec: 60, why: "" },
      ],
    })
    expect(segs.map((s) => s.startSec)).toEqual([0, 60])
    expect(Math.min(...segs.map((s) => s.lengthSec))).toBeGreaterThan(2)
  })

  it("wraps to the window start instead of cutting to a sliver", () => {
    const segs = planBrollSegments({
      ...base,
      windowLen: 100,
      coverSec: 60,
      anchors: [{ atSec: 10, sourceSec: 99.5, why: "" }],
    })
    for (const s of segs) expect(s.lengthSec).toBeGreaterThan(1)
    expect(segs[1].startSec).toBe(0)
  })
})

describe("planBrollAnchors", () => {
  const paragraphs = [
    { text: "Picture the older son coming in from the field." },
    { text: "Look at where he ended up. Feeding pigs." },
    { text: "Look at where he ended up, still with the pigs." },
  ]
  const cards = [
    { kind: "video", durationSec: 200 },
    { kind: "step", durationSec: 3 },
    {
      kind: "reflection-focus",
      text: "Picture the older son coming in from the field.",
      durationSec: 3,
      tailSec: 0.35,
    },
    {
      kind: "reflection-focus",
      text: "Look at where he ended up. Feeding pigs.",
      durationSec: 4,
      holdSec: 1,
    },
    {
      kind: "reflection-focus",
      text: "Look at where he ended up, still with the pigs.",
      durationSec: 4,
    },
  ]

  it("places anchors on the same timeline the composition walks", () => {
    const anchors = planBrollAnchors({
      cards,
      paragraphs,
      cues: CUES,
      introHoldSec: 0,
      speed: 0.85,
      windowStart: 0,
      windowEnd: 200,
    })
    // framesFromDurations is the composition's own layout; the backdrop
    // skips the video card, so its timeline is the non-video cards laid end
    // to end.
    const frames = framesFromDurations(
      cards.filter((c) => c.kind !== "video") as Parameters<
        typeof framesFromDurations
      >[0],
      30,
      24,
    )
    expect(anchors.map((a) => a.atSec)).toEqual([
      frames[1].from / 30,
      frames[2].from / 30,
    ])
    expect(anchors.map((a) => a.sourceSec)).toEqual([90, 35])
  })

  it("does not replay the moment the previous paragraph already showed", () => {
    const anchors = planBrollAnchors({
      cards,
      paragraphs,
      cues: CUES,
      introHoldSec: 0,
      speed: 0.85,
      windowStart: 0,
      windowEnd: 200,
    })
    // Paragraph 3 is about the pigs again: it keeps rolling.
    expect(anchors).toHaveLength(2)
  })

  it("never picks a cue outside the scene's window", () => {
    const anchors = planBrollAnchors({
      cards,
      paragraphs,
      cues: CUES,
      introHoldSec: 0,
      speed: 0.85,
      windowStart: 50,
      windowEnd: 200,
    })
    expect(anchors.every((a) => a.sourceSec >= 50)).toBe(true)
  })
})
