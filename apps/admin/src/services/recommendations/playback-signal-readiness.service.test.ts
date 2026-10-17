import { describe, expect, it } from "vitest"
import { decidePlaybackSignalReadiness } from "./playback-signal-readiness.service"

describe("playback signal readiness", () => {
  it("keeps sparse families inconclusive and never authorizes ranking", () => {
    expect(
      decidePlaybackSignalReadiness({
        episodes: 99,
        v2Summaries: 99,
        observed: 99,
        partial: 0,
        missing: 0,
      }),
    ).toMatchObject({
      decision: "inconclusive",
      ingestionHealth: "unknown",
      rankingInfluence: false,
    })
  })

  it("distinguishes healthy, repairable, and nonfunctional collection", () => {
    expect(
      decidePlaybackSignalReadiness({
        episodes: 100,
        v2Summaries: 100,
        observed: 80,
        partial: 10,
        missing: 10,
      }).decision,
    ).toBe("eligible_for_shadow_evaluation")
    expect(
      decidePlaybackSignalReadiness({
        episodes: 100,
        v2Summaries: 100,
        observed: 79,
        partial: 11,
        missing: 10,
      }).decision,
    ).toBe("revise")
    expect(
      decidePlaybackSignalReadiness({
        episodes: 500,
        v2Summaries: 500,
        observed: 0,
        partial: 100,
        missing: 400,
      }).decision,
    ).toBe("retire")
  })

  it("does not retire or qualify a new collector from legacy-only episodes", () => {
    expect(
      decidePlaybackSignalReadiness({
        episodes: 500,
        v2Summaries: 0,
        observed: 0,
        partial: 500,
        missing: 0,
      }),
    ).toMatchObject({
      decision: "inconclusive",
      reasonCodes: ["insufficient_v2_sample"],
    })
  })

  it("does not let one family's missing facts hide the other's readiness", () => {
    const navigation = decidePlaybackSignalReadiness({
      episodes: 150,
      v2Summaries: 150,
      observed: 30,
      partial: 90,
      missing: 30,
    })
    const qoe = decidePlaybackSignalReadiness({
      episodes: 150,
      v2Summaries: 150,
      observed: 140,
      partial: 5,
      missing: 5,
    })
    expect(navigation.decision).toBe("revise")
    expect(qoe.decision).toBe("eligible_for_shadow_evaluation")
  })
})
