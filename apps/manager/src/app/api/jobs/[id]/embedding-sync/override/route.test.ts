import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateManagerOverrideRequestMock,
  getJobMock,
  mergeJobArtifactsMock,
  syncEmbeddingArtifactMock,
} = vi.hoisted(() => ({
  authenticateManagerOverrideRequestMock: vi.fn(),
  getJobMock: vi.fn(),
  mergeJobArtifactsMock: vi.fn(),
  syncEmbeddingArtifactMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateManagerOverrideRequest: authenticateManagerOverrideRequestMock,
}))

vi.mock("@/lib/state", () => ({
  getJob: getJobMock,
  mergeJobArtifacts: mergeJobArtifactsMock,
}))

vi.mock("@/services/embeddingSync", () => ({
  syncEmbeddingArtifact: syncEmbeddingArtifactMock,
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
}))

import { POST } from "@/app/api/jobs/[id]/embedding-sync/override/route"
import { CmsHttpError } from "@/services/cmsClient"

function buildJob() {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    artifacts: {
      embeddingSync: {
        kind: "metadata",
        data: {
          domain: "embeddings",
          status: "skipped_existing",
          videoDocumentId: "video-doc-1",
          generated: {
            model: "openai/text-embedding-3-small",
            dimensions: 1536,
            chunkCount: 2,
            contentFingerprint: "sha256:generated",
            hasMetadataEmbedding: false,
          },
          cms: {
            resolvedVideoId: 42,
            hasEmbeddings: true,
            chunkCount: 2,
            contentFingerprint: "sha256:cms",
          },
        },
      },
    },
  }
}

function buildOverrideRequest(
  body: {
    expectedGeneratedContentFingerprint?: string
    expectedExistingContentFingerprint?: string
  } = {
    expectedGeneratedContentFingerprint: "sha256:generated",
    expectedExistingContentFingerprint: "sha256:cms",
  },
) {
  return new Request("http://example.test", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function buildManagerAuthResult() {
  return {
    kind: "session" as const,
    approvedByUserId: "7",
    user: {
      id: 7,
      username: "manager",
      email: "manager@example.test",
      role: { name: "Manager", type: "manager" },
    },
  }
}

describe("POST /api/jobs/[id]/embedding-sync/override", () => {
  beforeEach(() => {
    authenticateManagerOverrideRequestMock.mockReset()
    getJobMock.mockReset()
    mergeJobArtifactsMock.mockReset()
    syncEmbeddingArtifactMock.mockReset()
  })

  it("rejects unauthorized callers with 403", async () => {
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      Response.json(
        { error: "Interactive Manager session or API key required" },
        { status: 403 },
      ),
    )

    const response = await POST(buildOverrideRequest(), {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(403)
  })

  it("rejects override requests that do not include the reviewed fingerprints", async () => {
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      buildManagerAuthResult(),
    )
    getJobMock.mockResolvedValue(buildJob())

    const response = await POST(
      buildOverrideRequest({
        expectedGeneratedContentFingerprint: "sha256:generated",
      }),
      {
        params: Promise.resolve({ id: "job-1" }),
      },
    )

    expect(response.status).toBe(400)
    expect(syncEmbeddingArtifactMock).not.toHaveBeenCalled()
  })

  it("rejects override requests when the reviewed compare state no longer matches", async () => {
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      buildManagerAuthResult(),
    )
    getJobMock.mockResolvedValue(buildJob())

    const response = await POST(
      buildOverrideRequest({
        expectedGeneratedContentFingerprint: "sha256:generated",
        expectedExistingContentFingerprint: "sha256:cms-stale",
      }),
      {
        params: Promise.resolve({ id: "job-1" }),
      },
    )

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: "stale_compare",
      report: expect.objectContaining({
        status: "skipped_existing",
      }),
    })
    expect(syncEmbeddingArtifactMock).not.toHaveBeenCalled()
  })

  it("rejects override requests once the stored report is no longer overrideable", async () => {
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      buildManagerAuthResult(),
    )
    getJobMock.mockResolvedValue({
      ...buildJob(),
      artifacts: {
        embeddingSync: {
          kind: "metadata",
          data: {
            ...buildJob().artifacts.embeddingSync.data,
            status: "override_applied",
          },
        },
      },
    })

    const response = await POST(buildOverrideRequest(), {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(400)
    expect(syncEmbeddingArtifactMock).not.toHaveBeenCalled()
  })

  it("refreshes the stored compare report when CMS returns stale_compare", async () => {
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      buildManagerAuthResult(),
    )
    getJobMock.mockResolvedValue(buildJob())
    syncEmbeddingArtifactMock
      .mockRejectedValueOnce(
        new CmsHttpError(
          "POST",
          "/embedding/index",
          409,
          '{"error":"stale_compare"}',
          { error: "stale_compare" },
        ),
      )
      .mockResolvedValueOnce({
        domain: "embeddings",
        status: "skipped_existing",
        videoDocumentId: "video-doc-1",
        generated: {
          model: "openai/text-embedding-3-small",
          dimensions: 1536,
          chunkCount: 2,
          contentFingerprint: "sha256:generated",
          hasMetadataEmbedding: false,
        },
        cms: {
          resolvedVideoId: 42,
          hasEmbeddings: true,
          chunkCount: 3,
          contentFingerprint: "sha256:cms-new",
        },
      })
    mergeJobArtifactsMock.mockResolvedValue({
      ...buildJob(),
      artifacts: {
        embeddingSync: {
          kind: "metadata",
          data: {
            domain: "embeddings",
            status: "skipped_existing",
          },
        },
      },
    })

    const response = await POST(buildOverrideRequest(), {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(409)
    expect(syncEmbeddingArtifactMock.mock.calls).toEqual([
      [
        {
          assetId: "asset-1",
          videoDocumentId: "video-doc-1",
          mode: "override",
          expectedGeneratedContentFingerprint: "sha256:generated",
          expectedExistingContentFingerprint: "sha256:cms",
          approvedByUserId: "7",
          approvedAt: expect.any(String),
        },
      ],
      [
        {
          assetId: "asset-1",
          videoDocumentId: "video-doc-1",
          mode: "inspect",
        },
      ],
    ])
    expect(mergeJobArtifactsMock).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        embeddingSync: {
          kind: "metadata",
          data: expect.objectContaining({
            status: "skipped_existing",
          }),
        },
      }),
    )
  })

  it("returns 500 when the override report persists as failed", async () => {
    authenticateManagerOverrideRequestMock.mockResolvedValue(
      buildManagerAuthResult(),
    )
    getJobMock.mockResolvedValue(buildJob())
    syncEmbeddingArtifactMock.mockResolvedValue({
      domain: "embeddings",
      status: "failed",
      reason: "artifact_missing",
      videoDocumentId: "video-doc-1",
      generated: {
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
        chunkCount: 2,
        contentFingerprint: "sha256:generated",
        hasMetadataEmbedding: false,
      },
    })
    mergeJobArtifactsMock.mockResolvedValue(buildJob())

    const response = await POST(buildOverrideRequest(), {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({
      error: "artifact_missing",
      job: expect.any(Object),
      report: expect.objectContaining({
        status: "failed",
        reason: "artifact_missing",
      }),
    })
  })

  it("allows manager API key callers to approve overrides with a service actor id", async () => {
    authenticateManagerOverrideRequestMock.mockResolvedValue({
      kind: "api_key",
      approvedByUserId: "service:manager-api-key",
    })
    getJobMock.mockResolvedValue(buildJob())
    syncEmbeddingArtifactMock.mockResolvedValue({
      domain: "embeddings",
      status: "override_applied",
      videoDocumentId: "video-doc-1",
      generated: {
        model: "openai/text-embedding-3-small",
        dimensions: 1536,
        chunkCount: 2,
        contentFingerprint: "sha256:generated",
        hasMetadataEmbedding: false,
      },
      cms: {
        resolvedVideoId: 42,
        hasEmbeddings: true,
        chunkCount: 2,
        contentFingerprint: "sha256:cms",
      },
      override: {
        approvedByUserId: "service:manager-api-key",
        approvedAt: "2026-04-10T12:10:00.000Z",
      },
    })
    mergeJobArtifactsMock.mockResolvedValue(buildJob())

    const response = await POST(buildOverrideRequest(), {
      params: Promise.resolve({ id: "job-1" }),
    })

    expect(response.status).toBe(200)
    expect(syncEmbeddingArtifactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        approvedByUserId: "service:manager-api-key",
        expectedGeneratedContentFingerprint: "sha256:generated",
        expectedExistingContentFingerprint: "sha256:cms",
      }),
    )
  })
})
