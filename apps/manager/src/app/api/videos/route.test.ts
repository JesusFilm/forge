import { describe, expect, it } from "vitest"
import {
  getFilteredVideoCoverageCache,
  getFilteredVideoCoverageCacheKey,
  normalizeCoverageLanguageIds,
} from "@/app/api/videos/route"

describe("/api/videos coverage cache helpers", () => {
  it("normalizes language ids into a stable sorted unique set", () => {
    expect(
      normalizeCoverageLanguageIds([" 6414 ", "529", "6414", "", " 529 "]),
    ).toEqual(["529", "6414"])
  })

  it("builds the same cache key for equivalent language selections", () => {
    expect(getFilteredVideoCoverageCacheKey(["6414", "529", "6414"])).toBe(
      "529,6414",
    )
    expect(getFilteredVideoCoverageCacheKey(["529", "6414"])).toBe("529,6414")
  })

  it("reuses the same cache entry for equivalent language selections", () => {
    const first = getFilteredVideoCoverageCache(["6414", "529", "6414"])
    const second = getFilteredVideoCoverageCache(["529", "6414"])
    const third = getFilteredVideoCoverageCache(["529"])

    expect(first).toBe(second)
    expect(first).not.toBe(third)
  })
})
