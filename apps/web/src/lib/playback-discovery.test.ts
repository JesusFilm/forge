/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it } from "vitest"
import {
  consumePlaybackDiscoveryContext,
  markWatchUrlAsShared,
  markWatchUrlForPlaybackSource,
} from "./playback-discovery"

describe("playback discovery context", () => {
  it("recognizes a bounded search marker without browser storage", () => {
    expect(
      consumePlaybackDiscoveryContext("media-1", {
        search: "?playback_source=search",
      }),
    ).toEqual({
      source: "search",
      provenance: { handoff: "search_result" },
    })
  })

  it("recognizes share, editorial, and acquisition links without retaining values", () => {
    expect(
      consumePlaybackDiscoveryContext("media", {
        search: "?playback_source=share",
      }),
    ).toEqual({ source: "share", provenance: { handoff: "shared_link" } })
    expect(
      consumePlaybackDiscoveryContext("media", {
        search: "?playback_source=editorial",
      }),
    ).toEqual({
      source: "editorial",
      provenance: { handoff: "curated_link" },
    })
    expect(
      consumePlaybackDiscoveryContext("media", {
        search: "?utm_campaign=private-value",
      }),
    ).toEqual({
      source: "acquisition",
      provenance: { handoff: "campaign_link" },
    })
  })

  it("marks public links as share arrivals", () => {
    expect(markWatchUrlAsShared("https://example.test/watch/video/en")).toBe(
      "https://example.test/watch/video/en?playback_source=share",
    )
    expect(
      markWatchUrlForPlaybackSource("/watch/video/en?foo=bar", "search"),
    ).toBe("/watch/video/en?foo=bar&playback_source=search")
  })
})
