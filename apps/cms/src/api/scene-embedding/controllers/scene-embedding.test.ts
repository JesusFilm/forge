import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getProcessedVideoIdsMock,
  getRecommendationsMock,
  getSceneEmbeddingStatsMock,
  indexSceneEmbeddingsMock,
} = vi.hoisted(() => ({
  getProcessedVideoIdsMock: vi.fn(),
  getRecommendationsMock: vi.fn(),
  getSceneEmbeddingStatsMock: vi.fn(),
  indexSceneEmbeddingsMock: vi.fn(),
}))

vi.mock("../services/indexer", async () => {
  const actual = await vi.importActual<typeof import("../services/indexer")>(
    "../services/indexer",
  )

  return {
    ...actual,
    indexSceneEmbeddings: indexSceneEmbeddingsMock,
    getSceneEmbeddingStats: getSceneEmbeddingStatsMock,
    getProcessedVideoIds: getProcessedVideoIdsMock,
  }
})

vi.mock("../services/recommender", () => ({
  VideoNotFoundError: class VideoNotFoundError extends Error {},
  getRecommendations: getRecommendationsMock,
}))

import sceneEmbeddingController, {
  EXPECTED_DIMS,
  MAX_SCENES,
} from "./scene-embedding"
import { SceneEmbeddingIndexError } from "../services/indexer"

function buildContext(body: Record<string, unknown>) {
  return {
    status: 0,
    body: undefined as unknown,
    request: {
      body,
      query: undefined,
    },
  }
}

describe("scene-embedding controller", () => {
  const strapi = {
    log: {
      error: vi.fn(),
    },
  } as unknown as Parameters<typeof sceneEmbeddingController>[0]["strapi"]

  beforeEach(() => {
    indexSceneEmbeddingsMock.mockReset()
    getSceneEmbeddingStatsMock.mockReset()
    getProcessedVideoIdsMock.mockReset()
    getRecommendationsMock.mockReset()
  })

  it("accepts request-level videoDocumentId targets for scene indexing", async () => {
    indexSceneEmbeddingsMock.mockResolvedValue({
      scenesIndexed: 1,
      resolvedVideoId: 42,
      videoDocumentId: "video-doc-1",
    })
    const controller = sceneEmbeddingController({ strapi })
    const ctx = buildContext({
      videoDocumentId: "video-doc-1",
      scenes: [
        {
          muxAssetId: "mux-1",
          playbackId: "play-1",
          sceneIndex: 0,
          startSeconds: 0,
          description: "Themes: hope.",
          embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
        },
      ],
    })

    await controller.index(ctx)

    expect(indexSceneEmbeddingsMock).toHaveBeenCalledWith(
      strapi,
      {
        videoId: undefined,
        videoDocumentId: "video-doc-1",
        scenes: [
          expect.objectContaining({
            muxAssetId: "mux-1",
            sceneIndex: 0,
          }),
        ],
      },
      { skipDelete: false },
    )
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({
      scenesIndexed: 1,
      resolvedVideoId: 42,
      videoDocumentId: "video-doc-1",
    })
  })

  it("requires row-level videoId when no request target is provided", async () => {
    const controller = sceneEmbeddingController({ strapi })
    const ctx = buildContext({
      scenes: [
        {
          muxAssetId: "mux-1",
          playbackId: "play-1",
          sceneIndex: 0,
          startSeconds: 0,
          description: "Themes: hope.",
          embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
        },
      ],
    })

    await controller.index(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({
      error: "scenes[0]: videoId must be a number",
    })
  })

  it("rejects requests above the scene limit", async () => {
    const controller = sceneEmbeddingController({ strapi })
    const ctx = buildContext({
      videoDocumentId: "video-doc-1",
      scenes: Array.from({ length: MAX_SCENES + 1 }, (_, index) => ({
        muxAssetId: "mux-1",
        playbackId: "play-1",
        sceneIndex: index,
        startSeconds: index,
        description: `Scene ${index}`,
        embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
      })),
    })

    await controller.index(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({
      error: `Maximum ${MAX_SCENES} scenes per request`,
    })
  })

  it("surfaces structured scene target errors from the service", async () => {
    indexSceneEmbeddingsMock.mockRejectedValue(
      new SceneEmbeddingIndexError(400, "conflicting_video_id"),
    )
    const controller = sceneEmbeddingController({ strapi })
    const ctx = buildContext({
      videoDocumentId: "video-doc-1",
      scenes: [
        {
          videoId: 99,
          muxAssetId: "mux-1",
          playbackId: "play-1",
          sceneIndex: 0,
          startSeconds: 0,
          description: "Themes: hope.",
          embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
        },
      ],
    })

    await controller.index(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({ error: "conflicting_video_id" })
  })
})
