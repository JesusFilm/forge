// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RECOMMENDATION_PLAYBACK_PROVENANCE_KEY } from "./recommendation-contracts"
import {
  consumeRecommendationPlaybackProvenance,
  markRecommendationPlaybackProvenance,
} from "./recommendation-playback-provenance"

describe("recommendation playback provenance", () => {
  beforeEach(() => {
    sessionStorage.clear()
    window.history.replaceState({}, "", "/watch/media.html?keep=value")
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it("consumes an internal source marker exactly once", () => {
    markRecommendationPlaybackProvenance({
      source: "search",
      sourceRef: "bounded-result",
    })

    expect(consumeRecommendationPlaybackProvenance()).toEqual({
      source: "search",
      sourceRef: "bounded-result",
    })
    expect(consumeRecommendationPlaybackProvenance()).toBeNull()
    expect(
      sessionStorage.getItem(RECOMMENDATION_PLAYBACK_PROVENANCE_KEY),
    ).toBeNull()
  })

  it.each(["share", "acquisition"] as const)(
    "accepts the allowlisted inbound %s source and removes the marker",
    (source) => {
      window.history.replaceState(
        { preserved: true },
        "",
        `/watch/media.html?keep=value&playback_source=${source}#chapter`,
      )

      expect(consumeRecommendationPlaybackProvenance()).toEqual({
        source,
      })
      expect(window.location.href).not.toContain("playback_source")
      expect(window.location.search).toBe("?keep=value")
      expect(window.location.hash).toBe("#chapter")
      expect(window.history.state).toEqual({ preserved: true })
      expect(consumeRecommendationPlaybackProvenance()).toBeNull()
    },
  )

  it("discards invalid, oversized, and recommendation-shaped markers", () => {
    sessionStorage.setItem(
      RECOMMENDATION_PLAYBACK_PROVENANCE_KEY,
      JSON.stringify({ source: "recommendation", sourceRef: "spoof" }),
    )
    expect(consumeRecommendationPlaybackProvenance()).toBeNull()

    markRecommendationPlaybackProvenance({
      source: "editorial",
      sourceRef: "x".repeat(192),
    })
    expect(
      sessionStorage.getItem(RECOMMENDATION_PLAYBACK_PROVENANCE_KEY),
    ).toBeNull()
  })
})
