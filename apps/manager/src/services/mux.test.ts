import { describe, expect, it } from "vitest"
import {
  buildMuxAssetCreateParams,
  getSceneThumbnailUrls,
  getThumbnailUrl,
  normalizeGeneratedSubtitleLanguage,
} from "@/services/mux"

describe("buildMuxAssetCreateParams", () => {
  it("uses public playback and the requested subtitle language", () => {
    const params = buildMuxAssetCreateParams({
      inputUrl: "https://example.com/video.mp4",
      generateSubtitles: true,
      subtitleLanguageCode: "ru",
      passthrough: "job-123",
    })

    expect(params).toEqual({
      input: [
        {
          url: "https://example.com/video.mp4",
          generated_subtitles: [
            {
              language_code: "ru",
              name: "Generated subtitles",
            },
          ],
        },
      ],
      playback_policy: ["public"],
      passthrough: "job-123",
    })
  })

  it("defaults generated subtitle language to english", () => {
    const params = buildMuxAssetCreateParams({
      inputUrl: "https://example.com/video.mp4",
      generateSubtitles: true,
    })

    expect(params.input[0]?.generated_subtitles?.[0]?.language_code).toBe(
      "auto",
    )
  })

  it("normalizes locale codes to mux-supported languages", () => {
    expect(normalizeGeneratedSubtitleLanguage("ru-RU")).toBe("ru")
  })

  it("falls back to auto for unsupported language values", () => {
    expect(normalizeGeneratedSubtitleLanguage("3934")).toBe("auto")
  })
})

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
