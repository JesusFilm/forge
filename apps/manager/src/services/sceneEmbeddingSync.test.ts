import { beforeEach, describe, expect, it, vi } from "vitest"

const { cmsPostMock, readArtifactMock, requestEmbeddingVectorsMock } =
  vi.hoisted(() => ({
    cmsPostMock: vi.fn(),
    readArtifactMock: vi.fn(),
    requestEmbeddingVectorsMock: vi.fn(),
  }))

vi.mock("@/services/cmsClient", () => ({
  CmsHttpError: class CmsHttpError extends Error {
    constructor(
      readonly method: "GET" | "POST",
      readonly path: string,
      readonly status: number,
      readonly bodyText: string,
      readonly responseData?: unknown,
    ) {
      super(`CMS ${method} ${path} returned ${status}: ${bodyText}`)
      this.name = "CmsHttpError"
    }
  },
  cmsPost: cmsPostMock,
}))

vi.mock("@/services/storage", () => ({
  readArtifact: readArtifactMock,
}))

vi.mock("@/services/embeddings", () => ({
  EMBEDDING_MODEL: "openai/text-embedding-3-small",
  requestEmbeddingVectors: requestEmbeddingVectorsMock,
}))

import { CmsHttpError } from "@/services/cmsClient"
import { syncSceneAnalysisEmbeddings } from "@/services/sceneEmbeddingSync"

function buildVector(seed: number): number[] {
  return Array.from({ length: 1536 }, () => seed)
}

describe("syncSceneAnalysisEmbeddings", () => {
  beforeEach(() => {
    cmsPostMock.mockReset()
    readArtifactMock.mockReset()
    requestEmbeddingVectorsMock.mockReset()
  })

  it("indexes scene descriptions through the CMS videoDocumentId boundary", async () => {
    requestEmbeddingVectorsMock.mockResolvedValue({
      embeddings: [buildVector(1), buildVector(2)],
      dimensions: 1536,
      tokenCount: 88,
    })
    cmsPostMock.mockResolvedValue({
      scenesIndexed: 2,
      resolvedVideoId: 42,
      videoDocumentId: "video-doc-1",
    })

    const report = await syncSceneAnalysisEmbeddings({
      assetId: "asset-1",
      videoDocumentId: "video-doc-1",
      muxAssetId: "mux-1",
      playbackId: "play-1",
      language: "en",
      analysisResult: {
        scenes: [
          {
            sceneIndex: 0,
            startSeconds: 0,
            endSeconds: 30,
            chapterTitle: "Intro",
            description: "Themes: hope.\nContent: An opening scene.",
            themes: ["hope"],
            bibleVerses: [],
            demographics: [],
            spiritualContext: [],
          },
          {
            sceneIndex: 1,
            startSeconds: 30,
            endSeconds: 60,
            chapterTitle: "Middle",
            description: "",
            themes: [],
            bibleVerses: [],
            demographics: [],
            spiritualContext: [],
          },
          {
            sceneIndex: 2,
            startSeconds: 60,
            endSeconds: null,
            chapterTitle: "End",
            description: "Themes: courage.\nContent: A closing scene.",
            themes: ["courage"],
            bibleVerses: [],
            demographics: [],
            spiritualContext: [],
          },
        ],
        totalInputTokens: 10,
        totalOutputTokens: 4,
      },
    })

    expect(requestEmbeddingVectorsMock).toHaveBeenCalledWith(
      [
        "Themes: hope.\nContent: An opening scene.",
        "Themes: courage.\nContent: A closing scene.",
      ],
      expect.objectContaining({
        expectedDimensions: null,
      }),
    )
    expect(cmsPostMock).toHaveBeenCalledWith(
      "/scene-embedding/index",
      expect.objectContaining({
        videoDocumentId: "video-doc-1",
        scenes: [
          expect.objectContaining({
            sceneIndex: 0,
            muxAssetId: "mux-1",
            playbackId: "play-1",
            language: "en",
          }),
          expect.objectContaining({
            sceneIndex: 2,
            muxAssetId: "mux-1",
            playbackId: "play-1",
            language: "en",
          }),
        ],
      }),
    )
    expect(report).toMatchObject({
      domain: "scene_embeddings",
      status: "indexed",
      videoDocumentId: "video-doc-1",
      resolvedVideoId: 42,
      generatedSceneCount: 3,
      indexableSceneCount: 2,
      indexedSceneCount: 2,
      dimensions: 1536,
      embeddingTokens: 88,
      skippedEmptySceneIndexes: [1],
    })
  })

  it("returns unsupported when enrichment has no CMS video target", async () => {
    const report = await syncSceneAnalysisEmbeddings({
      assetId: "asset-1",
      muxAssetId: "mux-1",
      playbackId: "play-1",
      analysisResult: {
        scenes: [
          {
            sceneIndex: 0,
            startSeconds: 0,
            endSeconds: null,
            chapterTitle: null,
            description: "Themes: hope.",
            themes: ["hope"],
            bibleVerses: [],
            demographics: [],
            spiritualContext: [],
          },
        ],
        totalInputTokens: 1,
        totalOutputTokens: 1,
      },
    })

    expect(report.status).toBe("unsupported")
    expect(report.reason).toBe("no_video_target")
    expect(requestEmbeddingVectorsMock).not.toHaveBeenCalled()
    expect(cmsPostMock).not.toHaveBeenCalled()
  })

  it("returns failed when the CMS request comes back with a scene target error", async () => {
    vi.useFakeTimers()
    try {
      requestEmbeddingVectorsMock.mockResolvedValue({
        embeddings: [buildVector(1)],
        dimensions: 1536,
        tokenCount: 21,
      })
      cmsPostMock.mockRejectedValue(
        new CmsHttpError(
          "POST",
          "/scene-embedding/index",
          404,
          '{"error":"video_not_found"}',
          { error: "video_not_found" },
        ),
      )

      const reportPromise = syncSceneAnalysisEmbeddings({
        assetId: "asset-1",
        videoDocumentId: "video-doc-1",
        muxAssetId: "mux-1",
        playbackId: "play-1",
        analysisResult: {
          scenes: [
            {
              sceneIndex: 0,
              startSeconds: 0,
              endSeconds: null,
              chapterTitle: null,
              description: "Themes: hope.",
              themes: ["hope"],
              bibleVerses: [],
              demographics: [],
              spiritualContext: [],
            },
          ],
          totalInputTokens: 1,
          totalOutputTokens: 1,
        },
      })
      await vi.runAllTimersAsync()
      const report = await reportPromise

      expect(report.status).toBe("failed")
      expect(report.reason).toBe("video_not_found")
    } finally {
      vi.useRealTimers()
    }
  })
})
