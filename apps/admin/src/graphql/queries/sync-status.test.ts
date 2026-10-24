import { describe, expect, it } from "vitest"
import { parseSyncScopeArg } from "./sync-status"

describe("parseSyncScopeArg", () => {
  it("treats omitted scope as all phases", () => {
    expect(parseSyncScopeArg()).toBeUndefined()
    expect(parseSyncScopeArg(null)).toBeUndefined()
  })

  it("parses comma-separated phase scopes", () => {
    expect(
      parseSyncScopeArg(
        "languages, video-origins,videos,video-images,video-editions,video-subtitles,video-dubs,video-dub-downloads",
      ),
    ).toEqual([
      "languages",
      "video-origins",
      "videos",
      "video-images",
      "video-editions",
      "video-subtitles",
      "video-dubs",
      "video-dub-downloads",
    ])
  })

  it("drops empty comma segments", () => {
    expect(parseSyncScopeArg("languages,, ,videos")).toEqual([
      "languages",
      "videos",
    ])
  })
})
