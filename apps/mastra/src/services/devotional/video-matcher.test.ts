import { describe, expect, it } from "vitest"

import type { DevotionalVideoSearchConfig } from "../../config/env"
import { matchVideo, type VideoSearchHit } from "./video-matcher"
import type { Hook, ScriptureRef } from "./types"

const SCRIPTURE: ScriptureRef = {
  reference: "John 14:27",
  text: "Peace I leave with you.",
  translation: "NIV",
  needsCanonicalSource: true,
}

const HOOK: Hook = {
  type: "question",
  title: "Where do you find peace?",
  summary: "An invitation to rest in Christ.",
  sourceUrl: null,
}

const CONFIGURED: DevotionalVideoSearchConfig = {
  url: "https://admin.internal/search",
  bearer: "search-key",
  defaultVideoId: "video-default-1",
}

function hit(score: number): VideoSearchHit {
  return {
    id: "video-42",
    title: "Jesus calms the storm",
    url: "jesus-calms-the-storm",
    thumbnailUrl: "https://img.example.org/42.jpg",
    score,
  }
}

describe("matchVideo", () => {
  it("returns the top clip when search yields a result above threshold", async () => {
    const result = await matchVideo({
      scripture: SCRIPTURE,
      hook: HOOK,
      config: CONFIGURED,
      search: async () => [hit(0.4), hit(0.9)],
    })

    expect(result.videoMatch).toBe("search")
    expect(result.video?.videoId).toBe("video-42")
    expect(result.video?.url).toBe("jesus-calms-the-storm")
  })

  it("falls back to the default clip when the best result is below threshold", async () => {
    const result = await matchVideo({
      scripture: SCRIPTURE,
      hook: HOOK,
      config: CONFIGURED,
      search: async () => [hit(0.1)],
    })

    expect(result.videoMatch).toBe("fallback")
    expect(result.video?.videoId).toBe("video-default-1")
  })

  it("falls back to the default clip when search throws — never rejects", async () => {
    const result = await matchVideo({
      scripture: SCRIPTURE,
      hook: HOOK,
      config: CONFIGURED,
      search: async () => {
        throw new Error("admin search timeout")
      },
    })

    expect(result.videoMatch).toBe("fallback")
    expect(result.video?.videoId).toBe("video-default-1")
  })

  it("returns videoMatch none when there is no match and no fallback configured", async () => {
    const result = await matchVideo({
      scripture: SCRIPTURE,
      hook: HOOK,
      config: { url: CONFIGURED.url, bearer: CONFIGURED.bearer },
      search: async () => [],
    })

    expect(result.videoMatch).toBe("none")
    expect(result.video).toBeNull()
  })

  it("skips search and falls back when search is not configured", async () => {
    const result = await matchVideo({
      scripture: SCRIPTURE,
      hook: HOOK,
      config: { defaultVideoId: "video-default-1" },
    })

    expect(result.videoMatch).toBe("fallback")
    expect(result.video?.videoId).toBe("video-default-1")
  })
})
