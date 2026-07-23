import { describe, expect, it } from "vitest"

import {
  assessOrbitFramePerformance,
  resolveLanguageOrbitQuality,
} from "./language-orbit-quality"

describe("language orbit quality", () => {
  it("uses the high tier for a wide fine-pointer container within the DPR cap", () => {
    expect(
      resolveLanguageOrbitQuality({
        quality: "auto",
        width: 1200,
        coarsePointer: false,
        devicePixelRatio: 2,
        reducedMotion: false,
      }),
    ).toMatchObject({
      tier: "high",
      dpr: 1.75,
      sphereSegments: 72,
      starCount: 900,
      orbitScale: 1,
      frameloop: "always",
    })
  })

  it("uses the low tier for mobile and caps DPR at 1.5", () => {
    expect(
      resolveLanguageOrbitQuality({
        quality: "auto",
        width: 390,
        coarsePointer: true,
        devicePixelRatio: 3,
        reducedMotion: false,
      }),
    ).toMatchObject({
      tier: "low",
      dpr: 1.5,
      sphereSegments: 40,
      starCount: 360,
      orbitScale: 0.78,
      frameloop: "always",
    })
  })

  it("honors explicit quality overrides", () => {
    expect(
      resolveLanguageOrbitQuality({
        quality: "low",
        width: 1440,
        coarsePointer: false,
        devicePixelRatio: 2,
        reducedMotion: false,
      }).tier,
    ).toBe("low")
    expect(
      resolveLanguageOrbitQuality({
        quality: "high",
        width: 320,
        coarsePointer: true,
        devicePixelRatio: 3,
        reducedMotion: false,
      }).tier,
    ).toBe("high")
  })

  it("selects a static demand-rendered composition for reduced motion", () => {
    expect(
      resolveLanguageOrbitQuality({
        quality: "auto",
        width: 1200,
        coarsePointer: false,
        devicePixelRatio: 2,
        reducedMotion: true,
      }),
    ).toMatchObject({ frameloop: "demand", twinkle: false })
  })

  it("downgrades only after a sustained slow sample and never for a transient", () => {
    expect(assessOrbitFramePerformance(Array(119).fill(42))).toBe("hold")
    expect(
      assessOrbitFramePerformance([
        ...Array(108).fill(16),
        ...Array(12).fill(42),
      ]),
    ).toBe("hold")
    expect(
      assessOrbitFramePerformance([
        ...Array(84).fill(16),
        ...Array(36).fill(42),
      ]),
    ).toBe("downgrade")
  })
})
