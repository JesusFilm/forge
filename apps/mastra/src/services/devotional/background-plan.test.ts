import { describe, expect, it } from "vitest"

import { planBackgroundSegments } from "./devotional-render"

/**
 * The backdrop is assembled from pieces of one window so it can cover a
 * timeline longer than the footage. Two things must hold: it must cover the
 * whole timeline (an earlier version silently produced 35s for a 178s timeline
 * and froze under the entire reflection), and every restart must land where a
 * restart is meant to be — the moment the reflection opens.
 */
const total = (segs: { lengthSec: number }[]) =>
  segs.reduce((s, x) => s + x.lengthSec, 0)

describe("planBackgroundSegments", () => {
  const base = { startSec: 39, windowLen: 95, coverSec: 183, speed: 0.85 }

  it("supplies enough source to cover the timeline", () => {
    // 183s of screen at 0.85 needs ~155.6s of film.
    expect(total(planBackgroundSegments(base))).toBeCloseTo(183 * 0.85, 1)
  })

  it("starts every piece at the same point, so each reads as the scene restarting", () => {
    for (const seg of planBackgroundSegments(base)) {
      expect(seg.startSec).toBe(39)
    }
  })

  it("cuts the first piece exactly at the reflection, so the restart is deliberate", () => {
    const segs = planBackgroundSegments({ ...base, restartAtSec: 22 })
    // 22s of screen at 0.85 = 18.7s of film before the restart.
    expect(segs[0].lengthSec).toBeCloseTo(22 * 0.85, 1)
    expect(total(segs)).toBeCloseTo(183 * 0.85, 1)
  })

  it("never asks for more of the window than exists", () => {
    for (const seg of planBackgroundSegments(base)) {
      expect(seg.lengthSec).toBeLessThanOrEqual(95)
    }
  })

  it("needs a single pass when the window is long enough", () => {
    // 40s of screen at 0.85 = 34s of film, inside a 95s window.
    const segs = planBackgroundSegments({ ...base, coverSec: 40 })
    expect(segs).toHaveLength(1)
  })

  it("splits a pre-reflection stretch longer than the window", () => {
    // Pathological but reachable: a very long opening. It must still be built
    // from window-sized pieces rather than asking for footage that isn't there.
    const segs = planBackgroundSegments({ ...base, restartAtSec: 200 })
    expect(segs.length).toBeGreaterThan(1)
    for (const seg of segs) expect(seg.lengthSec).toBeLessThanOrEqual(95)
  })

  it("covers the timeline for the narrow episode window too", () => {
    const segs = planBackgroundSegments({
      ...base,
      windowLen: 30,
      restartAtSec: 22,
    })
    expect(total(segs)).toBeCloseTo(183 * 0.85, 1)
    for (const seg of segs) expect(seg.lengthSec).toBeLessThanOrEqual(30)
  })
})
