import { describe, expect, it } from "vitest"

import {
  anchorsForShots,
  bgFocusForCards,
  stabiliseAnchors,
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

  it("leaves a card alone when the stabiliser kept it centred throughout", () => {
    // `null` is the stabiliser's "centre is fine here". Writing 0.5 across the
    // card would be the same picture with more moving parts, and it would hide
    // that nothing here needed correcting.
    const focus = bgFocusForCards(
      [{ durationSec: 4 }],
      [{ startSec: 0, endSec: 5, x: null }],
      holds,
    )
    expect(focus[0]).toBeNull()
  })

  it("says 'back to centre' out loud when the card was anchored a moment ago", () => {
    // Skipping the centre shot would leave the card holding the previous
    // framing into a shot the stabiliser judged not to need it.
    const focus = bgFocusForCards(
      [{ durationSec: 9 }],
      [
        { startSec: 0, endSec: 4, x: 0.85 },
        { startSec: 4, endSec: 10, x: null },
      ],
      holds,
    )
    expect(focus[0]).toEqual([
      { atSec: 0, x: 0.85 },
      { atSec: 4, x: 0.5 },
    ])
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
    // The brief shot is skipped, and the shot after it repeats the framing
    // already in force, so the card carries ONE step rather than three.
    expect(focus[0]).toEqual([{ atSec: 0, x: 0.8 }])
  })
})

describe("stabiliseAnchors", () => {
  const shot = (startSec: number, endSec: number, x: number | null) => ({
    startSec,
    endSec,
    x,
  })

  it("holds centre while the face still fits in it", () => {
    // The crop keeps a band a little under a third of the source wide, so a
    // face a little off centre is already fully in frame. Moving for it buys
    // nothing and costs a visible lurch.
    const out = stabiliseAnchors([shot(0, 4, 0.5), shot(4, 8, 0.58)])
    expect(out.map((s) => s.x)).toEqual([null, null])
  })

  it("moves only when the face would fall outside the frame it is holding", () => {
    const out = stabiliseAnchors([shot(0, 4, 0.5), shot(4, 8, 0.8)])
    expect(out.map((s) => s.x)).toEqual([null, 0.8])
  })

  it("does not swing back and forth across a shot/reverse-shot exchange", () => {
    // A dialogue cuts between two angles every few seconds. Re-aiming on each
    // one produced twenty moves in a three-minute devotional and read as the
    // picture jumping about. Once the crop moves it HOLDS, so the exchange
    // settles on one framing instead of swinging back and forth across it.
    const out = stabiliseAnchors([
      shot(0, 3, 0.45),
      shot(3, 6, 0.8),
      shot(6, 9, 0.45),
      shot(9, 12, 0.8),
    ])
    expect(out.map((s) => s.x)).toEqual([null, 0.8, 0.8, 0.8])
  })

  it("returns to centre rather than chasing the next face", () => {
    // Once it must move off 0.8, centre frames this face perfectly well, and
    // centre is where the devotional should spend its time.
    const out = stabiliseAnchors([shot(0, 4, 0.85), shot(4, 8, 0.46)])
    expect(out.map((s) => s.x)).toEqual([0.85, null])
  })

  it("keeps the framing through a shot with nobody in it", () => {
    // A cutaway to a landscape should not reset the frame; the conversation
    // resumes on the same angle afterwards.
    const out = stabiliseAnchors([
      shot(0, 4, 0.85),
      shot(4, 6, null),
      shot(6, 9, 0.85),
    ])
    expect(out.map((s) => s.x)).toEqual([0.85, 0.85, 0.85])
  })
})
