import { describe, it, expect, vi } from "vitest"

// Mock env to avoid validation at import time
vi.mock("@/config/env", () => ({
  env: {
    MUX_TOKEN_ID: "test",
    MUX_TOKEN_SECRET: "test",
  },
}))

// Mock the Mux SDK constructor
vi.mock("@mux/mux-node", () => ({
  default: vi.fn(),
}))

import { getSceneThumbnailUrls, getThumbnailUrl } from "./mux"

describe("getThumbnailUrl", () => {
  it("generates URL with width and time", () => {
    const url = getThumbnailUrl("abc123", { width: 768, time: 30 })
    expect(url).toBe(
      "https://image.mux.com/abc123/thumbnail.webp?width=768&time=30",
    )
  })

  it("handles time=0 correctly (not falsy-dropped)", () => {
    const url = getThumbnailUrl("abc123", { width: 768, time: 0 })
    expect(url).toContain("time=0")
  })

  it("generates URL without options", () => {
    const url = getThumbnailUrl("abc123")
    expect(url).toBe("https://image.mux.com/abc123/thumbnail.webp")
  })
})

describe("getSceneThumbnailUrls", () => {
  it("throws on empty playbackId", () => {
    expect(() => getSceneThumbnailUrls("", 0, 60)).toThrow(
      "playbackId is empty",
    )
  })

  it("returns 3 frames spread across the scene", () => {
    const urls = getSceneThumbnailUrls("abc", 0, 60, 3)
    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain("time=0")
    expect(urls[1]).toContain("time=30")
    expect(urls[2]).toContain("time=60")
  })

  it("handles null endSeconds by defaulting to start + 60", () => {
    const urls = getSceneThumbnailUrls("abc", 100, null, 3)
    expect(urls).toHaveLength(3)
    expect(urls[0]).toContain("time=100")
    expect(urls[2]).toContain("time=160")
  })

  it("returns single frame when count is 1", () => {
    const urls = getSceneThumbnailUrls("abc", 10, 50, 1)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("time=10")
  })

  it("returns single frame when duration is 0", () => {
    const urls = getSceneThumbnailUrls("abc", 30, 30, 3)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain("time=30")
  })

  it("defaults to 3 frames", () => {
    const urls = getSceneThumbnailUrls("abc", 0, 90)
    expect(urls).toHaveLength(3)
  })
})
