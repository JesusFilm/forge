import { describe, expect, it } from "vitest"

import { pathFromKeyframes, shotsFromCuts } from "./clip-smart-crop"

describe("clip smart crop", () => {
  it("cuts the clip into shots and folds slivers into the shot before", () => {
    expect(shotsFromCuts([4, 4.3, 10], 15)).toEqual([
      { start: 0, end: 4.3 },
      { start: 4.3, end: 10 },
      { start: 10, end: 15 },
    ])
  })

  it("follows each shot's window and jumps on the cut, centre where unplanned", () => {
    const shots = [
      { start: 0, end: 5 },
      { start: 5, end: 9 },
    ]
    const path = pathFromKeyframes(
      shots,
      [
        [
          { x: 1000, width: 608 },
          { x: 1100, width: 608 },
        ],
        null,
      ],
      1920,
    )
    expect(path[0]).toEqual({ atSec: 0, x: 0.6792 })
    expect(path[1].atSec).toBeCloseTo(4.967, 3)
    expect(path[1].x).toBeCloseTo(0.7313, 3)
    expect(path[2]).toEqual({ atSec: 5, x: 0.5 })
  })
})
