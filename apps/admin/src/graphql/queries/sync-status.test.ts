import { describe, expect, it } from "vitest"
import { parseSyncScopeArg } from "./sync-status"

describe("parseSyncScopeArg", () => {
  it("treats omitted scope as all phases", () => {
    expect(parseSyncScopeArg()).toBeUndefined()
    expect(parseSyncScopeArg(null)).toBeUndefined()
  })

  it("parses comma-separated phase scopes", () => {
    expect(parseSyncScopeArg("languages, videos,video-dubs")).toEqual([
      "languages",
      "videos",
      "video-dubs",
    ])
  })

  it("drops empty comma segments", () => {
    expect(parseSyncScopeArg("languages,, ,videos")).toEqual([
      "languages",
      "videos",
    ])
  })
})
