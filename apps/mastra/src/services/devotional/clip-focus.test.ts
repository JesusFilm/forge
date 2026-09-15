import { describe, expect, it } from "vitest"

import {
  buildClipPath,
  clipPictureChanges,
  dominantTrack,
  smoothShot,
} from "./clip-focus"
import type { FaceSample } from "./face-crop-anchors"

const s = (atSec: number, ...faces: [number, number][]): FaceSample => ({
  atSec,
  faces: faces.map(([cx, area]) => ({ cx, cy: 0.3, area })),
})

describe("dominantTrack", () => {
  it("follows the person present most, not the one largest for a moment", () => {
    // Jesus at 0.40 through the shot; a listener's big profile at 0.75 for two
    // samples. Largest-now would swing to the listener; presence stays put.
    const shot = [
      s(0, [0.4, 0.03]),
      s(0.25, [0.4, 0.03], [0.75, 0.09]),
      s(0.5, [0.41, 0.03], [0.75, 0.09]),
      s(0.75, [0.41, 0.03]),
    ]
    const track = dominantTrack(shot)
    expect(track.every((x) => Math.abs(x - 0.4) < 0.02)).toBe(true)
  })

  it("ignores detections too small to be faces", () => {
    const shot = [s(0, [0.9, 0.002]), s(0.25, [0.9, 0.002], [0.4, 0.03])]
    const track = dominantTrack(shot)
    expect(Number.isNaN(track[0])).toBe(true)
    expect(track[1]).toBeCloseTo(0.4)
  })
})

describe("smoothShot", () => {
  it("never exceeds the smart-crop pan speed", () => {
    const x = smoothShot([0.3, 0.3, 0.3, 0.7, 0.7, 0.7, 0.7, 0.7], 0.25)
    const step = Math.max(...x.slice(1).map((v, i) => Math.abs(v - x[i])))
    expect(step / 0.25).toBeLessThanOrEqual(240 / 1920 + 1e-9)
  })

  it("keeps the full 9:16 window on the frame", () => {
    // The window is the whole vertical frame now: (9/16)/(16/9) of the width.
    const x = smoothShot([0.01, 0.01, 0.99, 0.99], 0.25)
    for (const v of x) {
      expect(v).toBeGreaterThanOrEqual(81 / 256 / 2)
      expect(v).toBeLessThanOrEqual(1 - 81 / 256 / 2)
    }
  })
})

describe("buildClipPath", () => {
  it("smooths inside a shot and jumps at a cut", () => {
    const samples = [
      s(0, [0.35, 0.03]),
      s(0.25, [0.35, 0.03]),
      s(0.5, [0.35, 0.03]),
      // cut at 0.75: the subject is now far right
      s(0.75, [0.7, 0.03]),
      s(1.0, [0.7, 0.03]),
      s(1.25, [0.7, 0.03]),
    ]
    const path = buildClipPath(samples, [0.75], 0.25)
    expect(path).toHaveLength(6)
    // Before the cut the window sits on the left subject, after it on the
    // right one — no glide across the cut, since the picture changed anyway.
    expect(path[2].x).toBeCloseTo(0.35, 1)
    expect(path[3].x).toBeCloseTo(0.7, 1)
    expect(path[3].atSec - path[2].atSec).toBeCloseTo(0.25)
  })

  it("returns nothing for an empty clip", () => {
    expect(buildClipPath([], [])).toEqual([])
  })
})

describe("clipPictureChanges", () => {
  const s = (atSec: number, ...cx: number[]): FaceSample => ({
    atSec,
    faces: cx.map((c) => ({ cx: c, cy: 0.3, area: 0.03 })),
  })

  it("does not call two people alternating in the detector a cut", () => {
    // The background planner's rule (largest face jumped) produced thirty
    // "changes" in thirty seconds on exactly this pattern.
    const out = clipPictureChanges(
      [s(0, 0.3), s(0.25, 0.7), s(0.5, 0.3, 0.7), s(0.75, 0.7), s(1, 0.3)],
      [],
    )
    expect(out).toEqual([])
  })

  it("calls it a cut when nobody is where they were", () => {
    const out = clipPictureChanges(
      [s(0, 0.3, 0.5), s(0.25, 0.3, 0.5), s(0.5, 0.8)],
      [],
    )
    expect(out).toEqual([0.5])
  })

  it("keeps ffmpeg's cuts and merges changes closer than a second", () => {
    const out = clipPictureChanges(
      [s(0, 0.3), s(0.25, 0.8), s(0.5, 0.2)],
      [0.2],
      0.008,
      1.0,
    )
    expect(out).toEqual([0.2])
  })
})
