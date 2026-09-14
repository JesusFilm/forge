import { describe, expect, it } from "vitest"

import {
  anchorsForShots,
  bgFocusForCards,
  type FaceSample,
} from "./face-crop-anchors"

const sample = (atSec: number, ...cxs: number[]): FaceSample => ({
  atSec,
  // Largest first: the detector sorts by area and the anchor reads [0].
  faces: cxs.map((cx, i) => ({ cx, cy: 0.4, area: 0.05 - i * 0.01 })),
})

describe("anchorsForShots", () => {
  it("anchors each shot on its own faces, not on the whole take", () => {
    const shots = anchorsForShots(
      [sample(0, 0.8), sample(0.5, 0.8), sample(2, 0.2), sample(2.5, 0.2)],
      [1.5],
      3,
    )
    expect(shots.map((s) => s.x)).toEqual([0.8, 0.2])
  })

  it("takes the median, so one false positive cannot move the anchor", () => {
    // Haar's false positives land on folds of cloth and patches of wall. A mean
    // would be dragged to 0.44 by the outlier; the median ignores it.
    const shots = anchorsForShots(
      [sample(0, 0.8), sample(0.5, 0.8), sample(1, 0.05), sample(1.5, 0.8)],
      [],
      2,
    )
    expect(shots[0].x).toBe(0.8)
  })

  it("reports no anchor for a shot with nobody in it", () => {
    // A landscape or a crowd from behind. Inventing a position here would be
    // worse than the centre crop, so the card keeps the centre crop.
    const shots = anchorsForShots([{ atSec: 0, faces: [] }], [], 1)
    expect(shots[0].x).toBeNull()
  })
})

describe("bgFocusForCards", () => {
  const shots = [
    { startSec: 0, endSec: 5, x: 0.8 },
    { startSec: 5, endSec: 10, x: 0.2 },
  ]
  const holds = { introHoldSec: 0, outroHoldSec: 0 }

  it("gives a card the anchors inside its own window, timed from its start", () => {
    // Each card runs 4.8s (4s of audio + the 0.8s breath tail), so the first
    // sits inside shot one and the second opens 0.2s before the cut at 5s.
    const focus = bgFocusForCards(
      [{ durationSec: 4 }, { durationSec: 4 }],
      shots,
      holds,
    )
    expect(focus[0]).toEqual([{ atSec: 0, x: 0.8 }])
    expect(focus[1]).toEqual([
      { atSec: 0, x: 0.8 },
      { atSec: 0.2, x: 0.2 },
    ])
  })

  it("does not let a video card consume the shared background take", () => {
    // The video card plays its OWN clip, so the card after it must resume where
    // the card before it stopped — mirroring bgStartFrames in DevotionalVideo.
    // Without this the anchors slide by the clip's whole length and land on the
    // wrong shots, which is how the first attempt broke good frames.
    const focus = bgFocusForCards(
      [
        { durationSec: 4 },
        { kind: "video", durationSec: 30 },
        { durationSec: 4 },
      ],
      shots,
      holds,
    )
    expect(focus[1]).toBeNull()
    expect(focus[2]).toEqual([
      { atSec: 0, x: 0.8 },
      { atSec: 0.2, x: 0.2 },
    ])
  })

  it("leaves a card alone when every anchor in it is near centre", () => {
    // Nothing to correct: writing 0.5 would be the same crop with more moving
    // parts, and it would hide that the feature did nothing here.
    const focus = bgFocusForCards(
      [{ durationSec: 4 }],
      [{ startSec: 0, endSec: 5, x: 0.51 }],
      holds,
    )
    expect(focus[0]).toBeNull()
  })

  it("ignores a shot too brief to be worth re-aiming for", () => {
    const focus = bgFocusForCards(
      [{ durationSec: 9 }],
      [
        { startSec: 0, endSec: 4, x: 0.8 },
        { startSec: 4, endSec: 4.5, x: 0.1 },
        { startSec: 4.5, endSec: 10, x: 0.8 },
      ],
      holds,
    )
    expect(focus[0]).toEqual([
      { atSec: 0, x: 0.8 },
      { atSec: 4.5, x: 0.8 },
    ])
  })
})
