import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  indexVideoEmbeddingsMock,
  syncVideoEmbeddingsMock,
  getVideoEmbeddingStatsMock,
} = vi.hoisted(() => ({
  indexVideoEmbeddingsMock: vi.fn(),
  syncVideoEmbeddingsMock: vi.fn(),
  getVideoEmbeddingStatsMock: vi.fn(),
}))

vi.mock("../services/indexer", async () => {
  const actual = await vi.importActual<typeof import("../services/indexer")>(
    "../services/indexer",
  )

  return {
    ...actual,
    indexVideoEmbeddings: indexVideoEmbeddingsMock,
    syncVideoEmbeddings: syncVideoEmbeddingsMock,
    getVideoEmbeddingStats: getVideoEmbeddingStatsMock,
  }
})

import embeddingController, { EXPECTED_DIMS, MAX_CHUNKS } from "./embedding"
import { EmbeddingIndexError } from "../services/indexer"

function buildContext(
  body: Record<string, unknown>,
  authorization = "Bearer internal-token",
) {
  return {
    status: 0,
    body: undefined as unknown,
    request: {
      headers: {
        authorization,
      },
      body,
    },
  }
}

describe("embedding controller", () => {
  const strapi = {
    log: {
      error: vi.fn(),
    },
  } as unknown as Parameters<typeof embeddingController>[0]["strapi"]

  beforeEach(() => {
    indexVideoEmbeddingsMock.mockReset()
    syncVideoEmbeddingsMock.mockReset()
    getVideoEmbeddingStatsMock.mockReset()
    vi.stubEnv("STRAPI_INTERNAL_API_TOKEN", "internal-token")
  })

  it("preserves legacy numeric videoId indexing for callers without mode", async () => {
    indexVideoEmbeddingsMock.mockResolvedValue({ chunksIndexed: 2 })
    const controller = embeddingController({ strapi })
    const ctx = buildContext({
      videoId: 42,
      chunks: [
        {
          text: "first chunk",
          embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
        },
        {
          text: "second chunk",
          embedding: Array.from({ length: EXPECTED_DIMS }, () => 2),
        },
      ],
    })

    await controller.index(ctx)

    expect(indexVideoEmbeddingsMock).toHaveBeenCalledWith(
      strapi,
      42,
      expect.any(Array),
      undefined,
    )
    expect(syncVideoEmbeddingsMock).not.toHaveBeenCalled()
    expect(ctx.status).toBe(200)
    expect(ctx.body).toEqual({ chunksIndexed: 2 })
  })

  it("rejects legacy numeric indexing when the internal token is not used", async () => {
    const controller = embeddingController({ strapi })
    const ctx = buildContext(
      {
        videoId: 42,
        chunks: [
          {
            text: "first chunk",
            embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
          },
        ],
      },
      "Bearer other-token",
    )

    await controller.index(ctx)

    expect(ctx.status).toBe(403)
    expect(ctx.body).toEqual({
      error: "Internal API token required",
    })
    expect(indexVideoEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("routes inspect mode through the summary-aware sync service", async () => {
    syncVideoEmbeddingsMock.mockResolvedValue({
      status: "missing",
      videoDocumentId: "video-doc-1",
      resolvedVideoId: 42,
      hasEmbeddings: false,
      chunkCount: 0,
    })
    const controller = embeddingController({ strapi })
    const ctx = buildContext({
      videoDocumentId: "video-doc-1",
      mode: "inspect",
    })

    await controller.index(ctx)

    expect(syncVideoEmbeddingsMock).toHaveBeenCalledWith(strapi, {
      videoId: undefined,
      videoDocumentId: "video-doc-1",
      chunks: undefined,
      model: undefined,
      mode: "inspect",
      expectedGeneratedContentFingerprint: undefined,
      expectedExistingContentFingerprint: undefined,
    })
    expect(ctx.status).toBe(200)
    expect(ctx.body).toMatchObject({
      status: "missing",
      hasEmbeddings: false,
    })
  })

  it("rejects write modes above the chunk limit", async () => {
    const controller = embeddingController({ strapi })
    const ctx = buildContext({
      videoDocumentId: "video-doc-1",
      mode: "if_missing",
      chunks: Array.from({ length: MAX_CHUNKS + 1 }, (_, index) => ({
        text: `chunk ${index}`,
        embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
      })),
    })

    await controller.index(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({
      error: `Maximum ${MAX_CHUNKS} chunks per request`,
    })
    expect(syncVideoEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("rejects override without both compare fingerprints", async () => {
    const controller = embeddingController({ strapi })
    const ctx = buildContext(
      {
        videoDocumentId: "video-doc-1",
        mode: "override",
        chunks: [
          {
            text: "chunk",
            embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
          },
        ],
        expectedGeneratedContentFingerprint: "sha256:generated",
      },
      "Bearer internal-token",
    )

    await controller.index(ctx)

    expect(ctx.status).toBe(400)
    expect(ctx.body).toEqual({
      error:
        "expectedGeneratedContentFingerprint and expectedExistingContentFingerprint are required for override",
    })
  })

  it("requires the internal token for destructive override mode", async () => {
    const controller = embeddingController({ strapi })
    const ctx = buildContext(
      {
        videoDocumentId: "video-doc-1",
        mode: "override",
        chunks: [
          {
            text: "chunk",
            embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
          },
        ],
        expectedGeneratedContentFingerprint: "sha256:generated",
        expectedExistingContentFingerprint: "sha256:existing",
      },
      "Bearer other-token",
    )

    await controller.index(ctx)

    expect(ctx.status).toBe(403)
    expect(ctx.body).toEqual({
      error: "Internal API token required for embedding override",
    })
    expect(syncVideoEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("fails closed when override mode is requested without a configured internal token", async () => {
    vi.stubEnv("STRAPI_INTERNAL_API_TOKEN", "")

    const controller = embeddingController({ strapi })
    const ctx = buildContext(
      {
        videoDocumentId: "video-doc-1",
        mode: "override",
        chunks: [
          {
            text: "chunk",
            embedding: Array.from({ length: EXPECTED_DIMS }, () => 1),
          },
        ],
        expectedGeneratedContentFingerprint: "sha256:generated",
        expectedExistingContentFingerprint: "sha256:existing",
      },
      "Bearer sync-token",
    )

    await controller.index(ctx)

    expect(ctx.status).toBe(503)
    expect(ctx.body).toEqual({
      error: "Internal embedding override token not configured",
    })
    expect(syncVideoEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("fails closed when sync mode is requested without any configured sync token", async () => {
    vi.stubEnv("STRAPI_INTERNAL_API_TOKEN", "")

    const controller = embeddingController({ strapi })
    const ctx = buildContext(
      {
        videoDocumentId: "video-doc-1",
        mode: "inspect",
      },
      "Bearer internal-token",
    )

    await controller.index(ctx)

    expect(ctx.status).toBe(503)
    expect(ctx.body).toEqual({
      error: "Internal embedding sync token not configured",
    })
    expect(syncVideoEmbeddingsMock).not.toHaveBeenCalled()
  })

  it("maps published-only draft conflicts through as 409 errors", async () => {
    syncVideoEmbeddingsMock.mockRejectedValue(
      new EmbeddingIndexError(
        409,
        "unpublished_video",
        "Video is not published",
      ),
    )
    const controller = embeddingController({ strapi })
    const ctx = buildContext({
      videoDocumentId: "video-doc-1",
      mode: "inspect",
    })

    await controller.index(ctx)

    expect(ctx.status).toBe(409)
    expect(ctx.body).toEqual({ error: "unpublished_video" })
  })
})
