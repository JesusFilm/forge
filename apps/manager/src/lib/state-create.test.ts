import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mutateMock = vi.fn()
const queryMock = vi.fn()
const cmsPostMock = vi.fn()
const publishJobEventMock = vi.fn()

vi.mock("@/cms/client", () => ({
  default: () => ({
    mutate: mutateMock,
    query: queryMock,
  }),
}))

vi.mock("@/services/cmsClient", () => ({
  cmsPost: cmsPostMock,
}))

vi.mock("@/lib/job-events", () => ({
  publishJobEvent: publishJobEventMock,
}))

function buildGraphqlJob(documentId: string) {
  return {
    documentId,
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: [],
    status: "pending",
    currentStep: null,
    retries: 0,
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    artifacts: {},
    errors: [],
    steps: [],
  }
}

describe("createJob", () => {
  beforeEach(() => {
    mutateMock.mockReset()
    queryMock.mockReset()
    cmsPostMock.mockReset()
    publishJobEventMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("uses the CMS internal create endpoint when a videoDocumentId is provided", async () => {
    cmsPostMock.mockResolvedValue({ documentId: "job-1" })
    queryMock.mockResolvedValue({
      data: {
        enrichmentJob: buildGraphqlJob("job-1"),
      },
    })

    const { createJob } = await import("./state")

    const job = await createJob("asset-1", "playback-1", ["529"], {
      videoDocumentId: "video-doc-1",
      initialArtifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: { sourceInputUrl: "https://example.com/video.mp4" },
        },
      },
    })

    expect(cmsPostMock).toHaveBeenCalledWith(
      "/enrichment-job/internal-create",
      expect.objectContaining({
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        languages: ["529"],
        videoDocumentId: "video-doc-1",
      }),
    )
    expect(mutateMock).not.toHaveBeenCalled()
    expect(queryMock).toHaveBeenCalled()
    expect(job.id).toBe("job-1")
    expect(publishJobEventMock).toHaveBeenCalledWith(job)
  })

  it("falls back to the GraphQL mutation when no videoDocumentId is provided", async () => {
    mutateMock.mockResolvedValue({
      data: {
        createEnrichmentJob: buildGraphqlJob("job-2"),
      },
    })

    const { createJob } = await import("./state")

    const job = await createJob("asset-2", "playback-2")

    expect(cmsPostMock).not.toHaveBeenCalled()
    expect(mutateMock).toHaveBeenCalled()
    expect(job.id).toBe("job-2")
    expect(publishJobEventMock).toHaveBeenCalledWith(job)
  })
})
