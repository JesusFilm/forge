import { describe, expect, it } from "vitest"
import { resolveScope } from "./orchestrator"

// Test the scope resolution logic (pure function, no mocks needed)
describe("resolveScope", () => {
  it("returns all phases for undefined input", () => {
    expect(resolveScope()).toEqual([
      "languages",
      "countries",
      "keywords",
      "videos",
      "video-dubs",
    ])
  })

  it("returns all phases for 'all'", () => {
    expect(resolveScope("all")).toEqual([
      "languages",
      "countries",
      "keywords",
      "videos",
      "video-dubs",
    ])
  })

  it("returns single phase", () => {
    expect(resolveScope("languages")).toEqual(["languages"])
  })

  it("preserves canonical order regardless of input order", () => {
    expect(resolveScope(["videos", "languages", "keywords"])).toEqual([
      "languages",
      "keywords",
      "videos",
    ])
  })

  it("filters out invalid phases", () => {
    expect(resolveScope(["languages", "invalid-phase"])).toEqual(["languages"])
  })

  it("returns empty array for entirely invalid input", () => {
    expect(resolveScope(["nope"])).toEqual([])
  })
})
