import { beforeEach, describe, expect, it, vi } from "vitest"

const { readArtifactMock } = vi.hoisted(() => ({
  readArtifactMock: vi.fn(),
}))

vi.mock("@/services/storage", () => ({
  readArtifact: readArtifactMock,
}))

import { syncSceneAnalysisEmbeddings } from "@/services/sceneEmbeddingSync"

function scene(overrides: Record<string, unknown> = {}) {
  return {
    sceneIndex: 0,
    startSeconds: 0,
    endSeconds: 30,
    chapterTitle: "Intro",
    description: "Themes: hope.\nContent: An opening scene.",
    themes: ["hope"],
    bibleVerses: [],
    demographics: [],
    spiritualContext: [],
    ...overrides,
  }
}

function analysisResult(overrides: Record<string, unknown> = {}) {
  return {
    scenes: [scene()],
    totalInputTokens: 10,
    totalOutputTokens: 4,
    ...overrides,
  }
}

describe("syncSceneAnalysisEmbeddings", () => {
  beforeEach(() => {
    readArtifactMock.mockReset()
  })

  it("reports source_ready for indexable scene-analysis data without generating vectors", async () => {
    const report = await syncSceneAnalysisEmbeddings({
      assetId: "asset-1",
      videoDocumentId: "video-doc-1",
      muxAssetId: "mux-1",
      playbackId: "play-1",
      language: "en",
      analysisResult: analysisResult({
        scenes: [
          scene({ sceneIndex: 0 }),
          scene({ sceneIndex: 1, description: "   " }),
          scene({
            sceneIndex: 2,
            startSeconds: 60,
            endSeconds: null,
            chapterTitle: "End",
            description: "Themes: courage.\nContent: A closing scene.",
            themes: ["courage"],
          }),
        ],
      }),
    })

    expect(report).toEqual({
      domain: "scene_embeddings",
      status: "source_ready",
      generatedSceneCount: 3,
      indexableSceneCount: 2,
      skippedEmptySceneIndexes: [1],
    })
    expect(readArtifactMock).not.toHaveBeenCalled()
  })

  it("loads scene-analysis.json when the caller does not pass analysisResult", async () => {
    readArtifactMock.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify(analysisResult())),
    )

    const report = await syncSceneAnalysisEmbeddings({
      assetId: "asset-1",
      muxAssetId: "mux-1",
    })

    expect(readArtifactMock).toHaveBeenCalledWith(
      "asset-1",
      "scene-analysis",
      "json",
    )
    expect(report).toMatchObject({
      domain: "scene_embeddings",
      status: "source_ready",
      generatedSceneCount: 1,
      indexableSceneCount: 1,
    })
  })

  it("returns skipped_empty when scene-analysis has no non-empty descriptions", async () => {
    const report = await syncSceneAnalysisEmbeddings({
      assetId: "asset-1",
      muxAssetId: "mux-1",
      analysisResult: analysisResult({
        scenes: [
          scene({ sceneIndex: 0, description: " " }),
          scene({ sceneIndex: 2, startSeconds: 60, description: "\n\t" }),
        ],
      }),
    })

    expect(report).toEqual({
      domain: "scene_embeddings",
      status: "skipped_empty",
      generatedSceneCount: 2,
      indexableSceneCount: 0,
      skippedEmptySceneIndexes: [0, 2],
    })
  })

  it("reports failed source artifact reads without CMS or vector assumptions", async () => {
    readArtifactMock.mockRejectedValueOnce(new Error("not found"))

    await expect(
      syncSceneAnalysisEmbeddings({
        assetId: "missing-asset",
        muxAssetId: "mux-1",
      }),
    ).resolves.toEqual({
      domain: "scene_embeddings",
      status: "failed",
      reason: "artifact_missing",
      generatedSceneCount: 0,
      indexableSceneCount: 0,
    })

    readArtifactMock.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify({ scenes: [{ bad: true }] })),
    )

    await expect(
      syncSceneAnalysisEmbeddings({
        assetId: "bad-asset",
        muxAssetId: "mux-1",
      }),
    ).resolves.toMatchObject({
      domain: "scene_embeddings",
      status: "failed",
      reason: "artifact_invalid",
    })
  })
})
