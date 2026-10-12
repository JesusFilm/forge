import { describe, expect, it } from "vitest"

import {
  itemScreenSec,
  scheduleShots,
  shotsFromCuts,
  type ShotItem,
} from "./background-shots"

// The Ten Lepers window (LUMO Luke 17, film 117.2 to 184.2) and its cuts.
const shots = shotsFromCuts(
  [123.6, 127.5, 132.4, 135.4, 160.0, 168.4],
  117.2,
  184.2,
)
const total = (items: ShotItem[]) =>
  items.reduce((s, i) => s + itemScreenSec(i), 0)

describe("shotsFromCuts", () => {
  it("turns cut times into shots and folds slivers into a neighbour", () => {
    expect(shotsFromCuts([10, 10.5, 20], 0, 30)).toEqual([
      { startSec: 0, endSec: 10.5 },
      { startSec: 10.5, endSec: 20 },
      { startSec: 20, endSec: 30 },
    ])
  })
})

describe("scheduleShots", () => {
  const base = { shots, coverSec: 270, speed: 0.7 }

  it("covers the timeline", () => {
    expect(total(scheduleShots(base))).toBeGreaterThanOrEqual(270)
  })

  it("never shows the same shot twice in a row, except a take playing on", () => {
    const items = scheduleShots({
      ...base,
      stillsAt: [162, 176],
      anchors: [
        { atSec: 16, sourceSec: 137.6 },
        { atSec: 20, sourceSec: 138.5 },
        { atSec: 131, sourceSec: 177.8 },
      ],
    })
    for (let i = 1; i < items.length; i++) {
      const [a, b] = [items[i - 1], items[i]]
      if (a.shot !== b.shot) continue
      // Same shot only as the take carrying on into its next piece.
      expect(a.kind === "clip" && b.kind === "clip").toBe(true)
      if (a.kind === "clip" && b.kind === "clip")
        expect(b.startSec).toBeGreaterThan(a.startSec)
    }
  })

  it("plays the scene in film order first", () => {
    const items = scheduleShots(base)
    const firstPass = items
      .filter(
        (i): i is Extract<ShotItem, { kind: "clip" }> => i.kind === "clip",
      )
      .slice(0, 6)
      .map((i) => i.startSec)
    expect(firstPass).toEqual([...firstPass].sort((x, y) => x - y))
  })

  it("brings stills in only once the scene has played through", () => {
    const items = scheduleShots({ ...base, stillsAt: [162] })
    const firstStill = items.findIndex((i) => i.kind === "still")
    expect(firstStill).toBeGreaterThan(0)
    expect(total(items.slice(0, firstStill)) * 0.7).toBeGreaterThanOrEqual(
      184.2 - 117.2 - 0.5,
    )
  })

  it("slows the chosen shots smoothly and leaves the others at the base speed", () => {
    const items = scheduleShots({ ...base, slowShotsAt: [161], slowSpeed: 0.5 })
    const clips = items.filter(
      (i): i is Extract<ShotItem, { kind: "clip" }> => i.kind === "clip",
    )
    expect(clips.some((c) => c.smooth && c.speed === 0.5)).toBe(true)
    for (const c of clips)
      if (c.startSec < 160 || c.startSec >= 168.4)
        expect([c.speed, c.smooth]).toEqual([0.7, false])
  })

  it("follows an anchor unless it would repeat the shot just shown", () => {
    const items = scheduleShots({
      ...base,
      anchors: [{ atSec: 40, sourceSec: 162 }],
    })
    let t = 0
    const at40 = items.find((i) => {
      const hit = t >= 38.5
      t += itemScreenSec(i)
      return hit
    })
    expect(at40?.shot).toBe(5)
  })

  it("keeps a repeat as far from its last showing as the pool allows", () => {
    const items = scheduleShots({
      ...base,
      slowShotsAt: [161, 170],
      stillsAt: [133.5, 164.5, 174.5],
    })
    const seen = new Map<string, number>()
    let t = 0
    let closest = Infinity
    for (const i of items) {
      const key =
        i.kind === "still" ? `s${i.atSec}` : `c${i.startSec.toFixed(1)}`
      const last = seen.get(key)
      if (last !== undefined) closest = Math.min(closest, t - last)
      seen.set(key, t)
      t += itemScreenSec(i)
    }
    expect(closest).toBeGreaterThan(60)
    for (let k = 1; k < items.length; k++)
      expect(items[k].kind === "still" && items[k - 1].kind === "still").toBe(
        false,
      )
  })
})
