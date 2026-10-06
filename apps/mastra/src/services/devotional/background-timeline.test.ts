import { describe, expect, it } from "vitest"

import { filmSecondAt, seamDissolveSec } from "./background-timeline"

describe("filmSecondAt", () => {
  it("undoes the slow-down of a single piece", () => {
    // Measured on the Prodigal backdrop (2026-10-06, frame matching against
    // the LUMO film): film = 0.85 × backdrop + 3.67 across the pigs scene.
    const plan = {
      speed: 0.85,
      dissolveSec: 0,
      segments: [{ startSec: 3.67, lengthSec: 200 }],
    }
    expect(filmSecondAt(plan, 40.77)).toBeCloseTo(38.32, 2)
    expect(filmSecondAt(plan, 0)).toBeCloseTo(3.67, 5)
  })

  it("jumps to the next piece at a hard cut", () => {
    const plan = {
      speed: 1,
      dissolveSec: 0,
      segments: [
        { startSec: 100, lengthSec: 10 },
        { startSec: 20, lengthSec: 10 },
      ],
    }
    expect(filmSecondAt(plan, 9.9)).toBeCloseTo(109.9, 5)
    expect(filmSecondAt(plan, 10.1)).toBeCloseTo(20.1, 5)
  })

  it("starts the incoming piece a dissolve early and hands over mid-dissolve", () => {
    // Joined: piece 1 starts at 10 - 2 = 8 (xfade offset); handover at 9.
    const plan = {
      speed: 0.5,
      dissolveSec: 2,
      segments: [
        { startSec: 100, lengthSec: 10 },
        { startSec: 20, lengthSec: 10 },
      ],
    }
    // backdrop 17.8s → joined 8.9 → still the outgoing piece.
    expect(filmSecondAt(plan, 17.8)).toBeCloseTo(108.9, 5)
    // backdrop 18.2s → joined 9.1 → incoming piece, 1.1s in.
    expect(filmSecondAt(plan, 18.2)).toBeCloseTo(21.1, 5)
  })

  it("holds the last piece's end past the plan", () => {
    const plan = {
      speed: 1,
      dissolveSec: 0,
      segments: [{ startSec: 5, lengthSec: 10 }],
    }
    expect(filmSecondAt(plan, 50)).toBe(15)
  })
})

describe("seamDissolveSec", () => {
  const two = [
    { startSec: 0, lengthSec: 10 },
    { startSec: 0, lengthSec: 1 },
  ]
  it("is zero for hard cuts and single pieces", () => {
    expect(seamDissolveSec(two, 0)).toBe(0)
    expect(seamDissolveSec([two[0]], 1)).toBe(0)
  })
  it("caps at half the shortest piece, floors at 0.2s", () => {
    expect(seamDissolveSec(two, 1)).toBe(0.5)
    expect(
      seamDissolveSec(
        [
          { startSec: 0, lengthSec: 0.2 },
          { startSec: 0, lengthSec: 5 },
        ],
        1,
      ),
    ).toBe(0.2)
  })
})
