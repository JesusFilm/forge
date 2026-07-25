import { describe, expect, it } from "vitest"
import {
  buildMuxAssetCreateParams,
  ensureGeneratedSubtitlesForAsset,
  getSceneThumbnailUrls,
  getMuxStaticRenditionSourceUrl,
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

describe("ensureGeneratedSubtitlesForAsset", () => {
  it("does nothing when a ready uploaded subtitle track already matches the requested language", async () => {
    const retrieveAsset = async () => ({
      tracks: [
        {
          id: "audio-1",
          type: "audio" as const,
          primary: true,
        },
        {
          id: "text-1",
          type: "text" as const,
          text_type: "subtitles" as const,
          text_source: "uploaded" as const,
          language_code: "ru",
          status: "ready" as const,
        },
      ],
    })
    const generateSubtitles = async () => {
      throw new Error("should not be called")
    }

    await expect(
      ensureGeneratedSubtitlesForAsset("asset-1", "ru", {
        retrieveAsset,
        generateSubtitles,
      }),
    ).resolves.toBeUndefined()
  })

  it("does nothing when a ready generated subtitle track already exists", async () => {
    const retrieveAsset = async () => ({
      tracks: [
        {
          id: "audio-1",
          type: "audio" as const,
          primary: true,
        },
        {
          id: "text-1",
          type: "text" as const,
          text_type: "subtitles" as const,
          text_source: "generated_vod" as const,
          language_code: "ru",
          status: "ready" as const,
        },
      ],
    })
    const generateSubtitles = async () => {
      throw new Error("should not be called")
    }

    await expect(
      ensureGeneratedSubtitlesForAsset("asset-1", "ru", {
        retrieveAsset,
        generateSubtitles,
      }),
    ).resolves.toBeUndefined()
  })

  it("does nothing when a generated subtitle track is already preparing", async () => {
    const retrieveAsset = async () => ({
      tracks: [
        {
          id: "audio-1",
          type: "audio" as const,
          primary: true,
        },
        {
          id: "text-1",
          type: "text" as const,
          text_type: "subtitles" as const,
          text_source: "generated_vod" as const,
          language_code: "ru",
          status: "preparing" as const,
        },
      ],
    })
    const generateSubtitles = async () => {
      throw new Error("should not be called")
    }

    await expect(
      ensureGeneratedSubtitlesForAsset("asset-1", "ru", {
        retrieveAsset,
        generateSubtitles,
      }),
    ).resolves.toBeUndefined()
  })

  it("requests generated subtitles on the primary audio track when missing", async () => {
    const requests: Array<{
      assetId: string
      trackId: string
      languageCode: string | undefined
    }> = []

    await ensureGeneratedSubtitlesForAsset("asset-1", "ru", {
      retrieveAsset: async () => ({
        tracks: [
          {
            id: "audio-1",
            type: "audio",
            primary: true,
          },
        ],
      }),
      generateSubtitles: async (assetId, trackId, params) => {
        requests.push({
          assetId,
          trackId,
          languageCode: params.generated_subtitles[0]?.language_code,
        })
        return []
      },
    })

    expect(requests).toEqual([
      {
        assetId: "asset-1",
        trackId: "audio-1",
        languageCode: "ru",
      },
    ])
  })

  it("fails clearly when there is no audio track to attach subtitles to", async () => {
    await expect(
      ensureGeneratedSubtitlesForAsset("asset-1", "ru", {
        retrieveAsset: async () => ({
          tracks: [
            {
              id: "text-1",
              type: "text",
              text_type: "subtitles",
              text_source: "generated_vod",
              language_code: "en",
              status: "ready",
            },
          ],
        }),
        generateSubtitles: async () => [],
      }),
    ).rejects.toThrow("Mux asset asset-1 has no audio track")
  })
})

describe("getMuxStaticRenditionSourceUrl", () => {
  it("chooses the highest ready public MP4 rendition", () => {
    expect(
      getMuxStaticRenditionSourceUrl({
        publicPlaybackId: "public-playback",
        staticRenditions: [
          {
            name: "360p.mp4",
            status: "ready",
            width: 640,
            height: 360,
            type: "advanced",
          },
          {
            name: "480p.mp4",
            status: "ready",
            width: 854,
            height: 480,
            type: "advanced",
          },
          {
            name: "720p.mp4",
            status: "preparing",
            width: 1280,
            height: 720,
            type: "advanced",
          },
        ],
      }),
    ).toBe("https://stream.mux.com/public-playback/480p.mp4")
  })

  it("does not build an unauthenticated URL for signed-only playback", () => {
    expect(
      getMuxStaticRenditionSourceUrl({
        publicPlaybackId: null,
        staticRenditions: [
          {
            name: "480p.mp4",
            status: "ready",
            width: 854,
            height: 480,
            type: "advanced",
          },
        ],
      }),
    ).toBeNull()
  })
})
