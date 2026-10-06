import { describe, expect, it } from "vitest"

import fixture from "./__fixtures__/prodigal-history-short.json"
import type { Manifest } from "./shorts-cutdown"
import {
  StudioExportError,
  objectPositionFor,
  planHistoryShort,
} from "./studio-export"

// The Prodigal backdrop as measured by frame matching against the LUMO film
// (2026-10-06): one piece, film = 0.85 × backdrop + 3.67 s.
const PRODIGAL_PLAN = {
  speed: 0.85,
  dissolveSec: 0,
  segments: [{ startSec: 3.67, lengthSec: 200 }],
}

const manifest = (extra: Record<string, unknown> = {}): Manifest => ({
  ...(fixture as unknown as Manifest),
  bgPlan: PRODIGAL_PLAN,
  ...extra,
})

describe("planHistoryShort", () => {
  const plan = planHistoryShort({ manifest: manifest() })

  it("lays captions out on the frames the owner approved in Studio", () => {
    // Project prodigal-history-devotional-look-20261005, revision 2.
    expect(plan.durationInFrames).toBe(472)
    expect(plan.captionsEndFrame).toBe(349)
    expect(
      plan.lines.map((l) => [l.startFrame, l.startFrame + l.durationInFrames]),
    ).toEqual([
      [0, 43],
      [43, 139],
      [139, 220],
      [220, 269],
      [269, 349],
    ])
    expect(plan.lines[0].text).toBe("Feeding pigs.")
    // Word offsets from the line's first word ("a" starts 0.232 s in).
    expect(plan.lines[1].wordTimes.split(",").slice(0, 3)).toEqual([
      "0.00",
      "0.23",
      "0.31",
    ])
  })

  it("puts the narration where the composition plays each card", () => {
    expect(plan.narration.map((n) => n.startFrame)).toEqual([0, 43, 220])
  })

  it("plays the film on from shot to shot instead of restarting it", () => {
    expect(plan.shots).toHaveLength(6)
    // Backdrop 40.77 s → film 38.32 s.
    expect(plan.shots[0].filmStartMs).toBe(38322)
    for (let k = 1; k < plan.shots.length; k++)
      expect(plan.shots[k].filmStartMs).toBe(plan.shots[k - 1].filmEndMs)
    const last = plan.shots.at(-1)!
    expect(last.startFrame + last.durationInFrames).toBe(472)
  })

  it("jumps only where the backdrop itself cut to another piece", () => {
    const cut = planHistoryShort({
      manifest: manifest({
        bgPlan: {
          speed: 1,
          dissolveSec: 0,
          segments: [
            { startSec: 100, lengthSec: 43 },
            { startSec: 10, lengthSec: 100 },
          ],
        },
      }),
    })
    // The backdrop reaches piece 2 at 43 s; the short starts at 40.77 s, so
    // its third shot (from 4.63 s) is the first one on piece 2.
    expect(cut.shots[0].filmStartMs).toBe(140767)
    expect(cut.shots[1].filmStartMs).toBe(cut.shots[0].filmEndMs)
    expect(cut.shots[2].filmStartMs).toBe(12400)
  })

  it("frames each shot on the Smart Crop subject", () => {
    const framed = planHistoryShort({
      manifest: manifest(),
      focusPath: [
        { atSec: 0, x: 0.37 },
        { atSec: 4.6, x: 0.5 },
      ],
    })
    expect(framed.shots[0].focusX).toBe(objectPositionFor(0.37))
    expect(framed.shots[3].focusX).toBe(0.5)
  })

  it("refuses a pack without a recorded backdrop plan", () => {
    expect(() =>
      planHistoryShort({ manifest: manifest({ bgPlan: undefined }) }),
    ).toThrow(StudioExportError)
  })
})

describe("objectPositionFor", () => {
  it("keeps the centre at the centre and clamps at the edges", () => {
    expect(objectPositionFor(0.5)).toBe(0.5)
    expect(objectPositionFor(0.05)).toBe(0)
    expect(objectPositionFor(0.95)).toBe(1)
    // A subject at 37% of the width: the window's left edge lands at 21%.
    expect(objectPositionFor(0.37)).toBeCloseTo(0.31, 2)
  })
})
