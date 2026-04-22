import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  readArtifactMock,
  runSceneAnalysisPipelineMock,
  syncSceneAnalysisEmbeddingsMock,
} = vi.hoisted(() => ({
  readArtifactMock: vi.fn(),
  runSceneAnalysisPipelineMock: vi.fn(),
  syncSceneAnalysisEmbeddingsMock: vi.fn(),
}))

vi.mock("@/services/storage", () => ({
  readArtifact: readArtifactMock,
}))

vi.mock("@/workflows/sceneAnalysisPipeline", () => ({
  runSceneAnalysisPipeline: runSceneAnalysisPipelineMock,
}))

vi.mock("@/services/sceneEmbeddingSync", () => ({
  syncSceneAnalysisEmbeddings: syncSceneAnalysisEmbeddingsMock,
}))

import { processVideoForBackfill } from "@/services/sceneEmbedder"

function buildSceneAnalysisBody(): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      scenes: [
        {
          sceneIndex: 0,
          startSeconds: 0,
          endSeconds: 25,
          chapterTitle: "Intro",
          description: "Themes: hope.",
          themes: ["hope"],
          bibleVerses: [],
          demographics: [],
          spiritualContext: [],
        },
      ],
      totalInputTokens: 11,
      totalOutputTokens: 7,
    }),
  )
}

describe("processVideoForBackfill", () => {
  beforeEach(() => {
    readArtifactMock.mockReset()
    runSceneAnalysisPipelineMock.mockReset()
    syncSceneAnalysisEmbeddingsMock.mockReset()
  })

  it("reuses the shared sync service and preserves backfill metrics", async () => {
    runSceneAnalysisPipelineMock.mockResolvedValue({
      totalInputTokens: 101,
      totalOutputTokens: 42,
    })
    readArtifactMock.mockResolvedValue(buildSceneAnalysisBody())
    syncSceneAnalysisEmbeddingsMock.mockResolvedValue({
      domain: "scene_embeddings",
      status: "indexed",
      resolvedVideoId: 42,
      generatedSceneCount: 1,
      indexableSceneCount: 1,
      indexedSceneCount: 1,
      embeddingTokens: 77,
    })

    const result = await processVideoForBackfill({
      videoId: 42,
      title: "Backfill Video",
      subtitleUrl: "https://example.com/subtitles.vtt",
      subtitleLanguage: "en",
      muxAssetId: "mux-1",
      playbackId: "play-1",
      coreId: "core-1",
      label: "segment",
    })

    expect(syncSceneAnalysisEmbeddingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "42",
        videoId: 42,
        coreId: "core-1",
        muxAssetId: "mux-1",
        playbackId: "play-1",
        language: "en",
        analysisResult: expect.objectContaining({
          scenes: [expect.objectContaining({ sceneIndex: 0 })],
        }),
      }),
    )
    expect(result).toMatchObject({
      videoId: 42,
      sceneCount: 1,
      totalInputTokens: 101,
      totalOutputTokens: 42,
      embeddingTokens: 77,
    })
  })

  it("throws when the shared sync path reports a failed scene embedding sync", async () => {
    runSceneAnalysisPipelineMock.mockResolvedValue({
      totalInputTokens: 101,
      totalOutputTokens: 42,
    })
    readArtifactMock.mockResolvedValue(buildSceneAnalysisBody())
    syncSceneAnalysisEmbeddingsMock.mockResolvedValue({
      domain: "scene_embeddings",
      status: "failed",
      reason: "video_not_found",
      generatedSceneCount: 1,
      indexableSceneCount: 1,
    })

    await expect(
      processVideoForBackfill({
        videoId: 42,
        title: "Backfill Video",
        subtitleUrl: "https://example.com/subtitles.vtt",
        subtitleLanguage: "en",
        muxAssetId: "mux-1",
        playbackId: "play-1",
        coreId: "core-1",
        label: "segment",
      }),
    ).rejects.toThrow("video_not_found")
  })
})
