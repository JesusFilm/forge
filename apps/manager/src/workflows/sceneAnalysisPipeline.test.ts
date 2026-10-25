import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  fetchSubtitleTextMock,
  generateChaptersMock,
  extractAndStoreSceneBoundariesMock,
  analyzeAllScenesMock,
  getMuxAssetMock,
  transcribeMock,
} = vi.hoisted(() => ({
  fetchSubtitleTextMock: vi.fn(),
  generateChaptersMock: vi.fn(),
  extractAndStoreSceneBoundariesMock: vi.fn(),
  analyzeAllScenesMock: vi.fn(),
  getMuxAssetMock: vi.fn(),
  transcribeMock: vi.fn(),
}))

vi.mock("@/services/subtitles", () => ({
  fetchSubtitleText: fetchSubtitleTextMock,
}))

vi.mock("@/services/chapters", () => ({
  generateChapters: generateChaptersMock,
}))

vi.mock("@/services/sceneBoundaries", () => ({
  extractAndStoreSceneBoundaries: extractAndStoreSceneBoundariesMock,
}))

vi.mock("@/services/sceneAnalysis", () => ({
  analyzeAllScenes: analyzeAllScenesMock,
}))

vi.mock("@/services/mux", () => ({
  getMuxAsset: getMuxAssetMock,
}))

vi.mock("@/services/transcription", () => ({
  transcribe: transcribeMock,
}))

const { runSceneAnalysisPipeline } =
  await import("@/workflows/sceneAnalysisPipeline")

beforeEach(() => {
  fetchSubtitleTextMock.mockReset()
  generateChaptersMock.mockReset()
  extractAndStoreSceneBoundariesMock.mockReset()
  analyzeAllScenesMock.mockReset()
  getMuxAssetMock.mockReset()
  transcribeMock.mockReset()

  fetchSubtitleTextMock.mockResolvedValue("Existing subtitle transcript text.")
  transcribeMock.mockResolvedValue({
    text: "Generated mux subtitle transcript text.",
  })
  generateChaptersMock.mockResolvedValue({
    chapters: [{ title: "Intro", startSeconds: 0, endSeconds: 30 }],
  })
  extractAndStoreSceneBoundariesMock.mockResolvedValue({
    scenes: [{ sceneIndex: 0, startSeconds: 0, endSeconds: 30 }],
  })
  getMuxAssetMock.mockResolvedValue({ playbackId: "playback-1" })
  analyzeAllScenesMock.mockResolvedValue({
    scenes: [{ sceneIndex: 0 }],
    totalInputTokens: 11,
    totalOutputTokens: 7,
  })
})

describe("runSceneAnalysisPipeline", () => {
  it("uses an existing subtitle URL when available", async () => {
    await runSceneAnalysisPipeline({
      videoId: 42,
      assetId: "42",
      muxAssetId: "mux-A",
      subtitleUrl: "https://stream.mux.com/A.vtt",
      videoLabel: "shortFilm",
      languageCode: "en",
    })

    expect(fetchSubtitleTextMock).toHaveBeenCalledWith(
      "https://stream.mux.com/A.vtt",
    )
    expect(transcribeMock).not.toHaveBeenCalled()
    expect(generateChaptersMock).toHaveBeenCalledWith("42", {
      transcriptText: "Existing subtitle transcript text.",
    })
  })

  it("falls back to Mux transcription when admin has no subtitle URL", async () => {
    await runSceneAnalysisPipeline({
      videoId: 42,
      assetId: "42",
      muxAssetId: "mux-A",
      videoLabel: "shortFilm",
      languageCode: "en",
    })

    expect(fetchSubtitleTextMock).not.toHaveBeenCalled()
    expect(transcribeMock).toHaveBeenCalledWith("42", "mux-A", "en")
    expect(generateChaptersMock).toHaveBeenCalledWith("42", {
      transcriptText: "Generated mux subtitle transcript text.",
    })
  })

  it("uses requested localized subtitle and provenance inputs for scene analysis", async () => {
    await runSceneAnalysisPipeline({
      videoId: 42,
      assetId: "42",
      muxAssetId: "mux-ES",
      subtitleUrl: "https://stream.mux.com/es.vtt",
      videoLabel: "shortFilm",
      languageCode: "es",
      targetLocale: "es",
    })

    expect(fetchSubtitleTextMock).toHaveBeenCalledWith(
      "https://stream.mux.com/es.vtt",
    )
    expect(transcribeMock).not.toHaveBeenCalled()
    expect(analyzeAllScenesMock).toHaveBeenCalledWith(
      "42",
      "playback-1",
      [{ sceneIndex: 0, startSeconds: 0, endSeconds: 30 }],
      expect.objectContaining({
        targetLocale: "es",
        inputLanguageBcp47: "es",
        muxAssetId: "mux-ES",
        transcriptSource: {
          kind: "subtitle-url",
          languageBcp47: "es",
          subtitleUrl: "https://stream.mux.com/es.vtt",
        },
      }),
    )
  })

  it("transcribes the requested localized mux asset when target subtitles are missing", async () => {
    await runSceneAnalysisPipeline({
      videoId: 42,
      assetId: "42",
      muxAssetId: "mux-AR",
      videoLabel: "shortFilm",
      languageCode: "ar",
      targetLocale: "ar",
    })

    expect(transcribeMock).toHaveBeenCalledWith("42", "mux-AR", "ar")
    expect(analyzeAllScenesMock).toHaveBeenCalledWith(
      "42",
      "playback-1",
      [{ sceneIndex: 0, startSeconds: 0, endSeconds: 30 }],
      expect.objectContaining({
        targetLocale: "ar",
        inputLanguageBcp47: "ar",
        muxAssetId: "mux-AR",
        transcriptSource: {
          kind: "mux-transcription",
          languageBcp47: "ar",
          muxAssetId: "mux-AR",
        },
      }),
    )
  })
})
