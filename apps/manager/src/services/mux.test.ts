import { describe, expect, it } from "vitest"
import {
  buildMuxAssetCreateParams,
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
