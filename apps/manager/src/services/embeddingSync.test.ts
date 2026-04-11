import { beforeEach, describe, expect, it, vi } from "vitest"

const { artifactExistsMock, readArtifactMock, cmsPostMock } = vi.hoisted(
  () => ({
    artifactExistsMock: vi.fn(),
    readArtifactMock: vi.fn(),
    cmsPostMock: vi.fn(),
  }),
)

vi.mock("@/services/storage", () => ({
  artifactExists: artifactExistsMock,
  readArtifact: readArtifactMock,
}))

vi.mock("@/services/cmsClient", () => {
  return {
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
  }
})

import { CmsHttpError } from "@/services/cmsClient"
import { syncEmbeddingArtifact } from "@/services/embeddingSync"

function buildArtifactBody(chunkCount = 2): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      model: "openai/text-embedding-3-small",
      dimensions: 1536,
      chunks: Array.from({ length: chunkCount }, (_, index) => ({
        chunkId: `chunk-${index}`,
        text: `chunk ${index}`,
        embedding: Array.from({ length: 1536 }, () => index + 1),
        metadata: {
          tokenCount: 12,
        },
      })),
      metadataEmbedding: {
        text: "metadata summary",
        embedding: Array.from({ length: 1536 }, () => 5),
        fieldsUsed: ["title"],
      },
      metadata: {
        generatedAt: "2026-04-10T12:00:00.000Z",
      },
    }),
  )
}

describe("syncEmbeddingArtifact", () => {
  beforeEach(() => {
    artifactExistsMock.mockReset()
    readArtifactMock.mockReset()
    cmsPostMock.mockReset()
  })

  it("syncs transcript chunks in missing-only mode and keeps metadata embedding summary-only", async () => {
    artifactExistsMock.mockResolvedValue(true)
    readArtifactMock.mockResolvedValue(buildArtifactBody())
    cmsPostMock.mockResolvedValue({
      status: "applied_missing",
      videoDocumentId: "video-doc-1",
      resolvedVideoId: 42,
      hasEmbeddings: true,
      chunkCount: 2,
      model: "openai/text-embedding-3-small",
      contentFingerprint: "sha256:cms",
    })

    const report = await syncEmbeddingArtifact({
      assetId: "asset-1",
      videoDocumentId: "video-doc-1",
    })

    expect(cmsPostMock).toHaveBeenCalledWith(
      "/embedding/index",
      expect.objectContaining({
        videoDocumentId: "video-doc-1",
        mode: "if_missing",
        chunks: expect.arrayContaining([
          expect.objectContaining({ text: "chunk 0" }),
        ]),
      }),
      { tokenScope: "embedding_sync" },
    )
    expect(report).toMatchObject({
      domain: "embeddings",
      status: "applied_missing",
      videoDocumentId: "video-doc-1",
      generated: {
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
        chunkCount: 2,
        hasMetadataEmbedding: true,
        generatedAt: "2026-04-10T12:00:00.000Z",
      },
      cms: {
        resolvedVideoId: 42,
        hasEmbeddings: true,
        chunkCount: 2,
      },
    })
  })

  it("records skipped_existing when CMS already has transcript rows", async () => {
    artifactExistsMock.mockResolvedValue(true)
    readArtifactMock.mockResolvedValue(buildArtifactBody())
    cmsPostMock.mockResolvedValue({
      status: "skipped_existing",
      videoDocumentId: "video-doc-1",
      resolvedVideoId: 42,
      hasEmbeddings: true,
      chunkCount: 2,
      model: "openai/text-embedding-3-small",
      contentFingerprint: "sha256:cms",
    })

    const report = await syncEmbeddingArtifact({
      assetId: "asset-1",
      videoDocumentId: "video-doc-1",
    })

    expect(report.status).toBe("skipped_existing")
    expect(report.cms?.hasEmbeddings).toBe(true)
  })

  it("returns unsupported when the shared workflow has no videoDocumentId", async () => {
    artifactExistsMock.mockResolvedValue(true)
    readArtifactMock.mockResolvedValue(buildArtifactBody())

    const report = await syncEmbeddingArtifact({
      assetId: "asset-1",
    })

    expect(report.status).toBe("unsupported")
    expect(report.reason).toBe("no_video_document_id")
    expect(cmsPostMock).not.toHaveBeenCalled()
  })

  it("returns failed when the embeddings artifact is missing", async () => {
    artifactExistsMock.mockResolvedValue(false)

    const report = await syncEmbeddingArtifact({
      assetId: "asset-1",
      videoDocumentId: "video-doc-1",
    })

    expect(report.status).toBe("failed")
    expect(report.reason).toBe("artifact_missing")
  })

  it("returns unsupported when the transcript exceeds the CMS chunk limit", async () => {
    artifactExistsMock.mockResolvedValue(true)
    readArtifactMock.mockResolvedValue(buildArtifactBody(501))

    const report = await syncEmbeddingArtifact({
      assetId: "asset-1",
      videoDocumentId: "video-doc-1",
    })

    expect(report.status).toBe("unsupported")
    expect(report.reason).toBe("chunk_limit_exceeded")
    expect(cmsPostMock).not.toHaveBeenCalled()
  })

  it("propagates stale compare conflicts during override so the route can refresh", async () => {
    artifactExistsMock.mockResolvedValue(true)
    readArtifactMock.mockResolvedValue(buildArtifactBody())
    cmsPostMock.mockRejectedValue(
      new CmsHttpError(
        "POST",
        "/embedding/index",
        409,
        '{"error":"stale_compare"}',
        {
          error: "stale_compare",
        },
      ),
    )

    await expect(
      syncEmbeddingArtifact({
        assetId: "asset-1",
        videoDocumentId: "video-doc-1",
        mode: "override",
        expectedGeneratedContentFingerprint: "sha256:generated",
        expectedExistingContentFingerprint: "sha256:existing",
        approvedByUserId: "7",
        approvedAt: "2026-04-10T12:10:00.000Z",
      }),
    ).rejects.toBeInstanceOf(CmsHttpError)
  })
})
