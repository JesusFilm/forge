import { describe, expect, it } from "vitest"

import {
  DEFAULT_INITIAL_LONGITUDE,
  createLanguageOrbitPhase,
} from "./language-orbit-phase"

describe("language orbit phase", () => {
  it("starts on the Europe and Africa longitude with a separate cloud phase", () => {
    const phase = createLanguageOrbitPhase()

    expect(phase.getEarthRotationY()).toBeCloseTo(
      (DEFAULT_INITIAL_LONGITUDE * Math.PI) / 180,
    )
    expect(phase.getCloudRotationY()).toBeCloseTo(
      ((DEFAULT_INITIAL_LONGITUDE + 2) * Math.PI) / 180,
    )
  })

  it("retains independent animation phases across renderer remounts", () => {
    const phase = createLanguageOrbitPhase()

    phase.setEarthRotationY(1)
    phase.setCloudRotationY(2)
    phase.setOrbitRotationY(3)
    phase.setStarTime(4)

    expect({
      earth: phase.getEarthRotationY(),
      cloud: phase.getCloudRotationY(),
      orbit: phase.getOrbitRotationY(),
      star: phase.getStarTime(),
    }).toEqual({ earth: 1, cloud: 2, orbit: 3, star: 4 })
  })
})
