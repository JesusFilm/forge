import { describe, expect, it } from "vitest"
import { parseCoverageArgs } from "./diagnose-recommendation-coverage"

describe("recommendation coverage arguments", () => {
  it("requires explicit independent locale and audio identities", () => {
    expect(
      parseCoverageArgs([
        "--seed",
        "video-1",
        "--locale",
        "zh",
        "--audio",
        "mandarin-china",
      ]),
    ).toEqual({
      seedMediaId: "video-1",
      locale: "zh",
      audioLanguageSlug: "mandarin-china",
    })
    expect(() =>
      parseCoverageArgs(["--seed", "video-1", "--locale", "zh"]),
    ).toThrow()
  })

  it("rejects unknown flags and invalid audio instead of inferring a sibling", () => {
    expect(() => parseCoverageArgs(["--execute"])).toThrow()
    expect(() =>
      parseCoverageArgs([
        "--seed",
        "video-1",
        "--locale",
        "te",
        "--audio",
        "Telugu?",
      ]),
    ).toThrow()
  })

  it("prints help without requiring database configuration", () => {
    expect(parseCoverageArgs(["--help"])).toBeNull()
  })
})
