import { describe, expect, it } from "vitest"
import { assertOriginalQualityHolds } from "./legacy-quality-holds"

describe("original quality holdout identity", () => {
  const synthetic = {
    qualitySelectorSha256:
      "c983ec02830d1b2df637c04e47fd75bdd66c26bd4e0caba0c38ff851561589a1",
    qualityRunIds: Array.from(
      { length: 64 },
      (_, i) => `synthetic-quality-${i}`,
    ),
    activeInvestigationRunIds: [],
  }

  it("rejects a fabricated 64-run list even with the real selector digest", () => {
    expect(() => assertOriginalQualityHolds(synthetic)).toThrow(
      "Original frozen quality holdout set",
    )
  })

  it("rejects changed selector and duplicate holdouts", () => {
    expect(() =>
      assertOriginalQualityHolds({
        ...synthetic,
        qualitySelectorSha256: "b".repeat(64),
      }),
    ).toThrow()
    expect(() =>
      assertOriginalQualityHolds({
        ...synthetic,
        qualityRunIds: [
          ...synthetic.qualityRunIds.slice(0, 63),
          synthetic.qualityRunIds[0],
        ],
      }),
    ).toThrow()
  })
})
