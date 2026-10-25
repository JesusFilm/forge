import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JobRecord } from "@/types/job"

const { adminCreateJobMock, publishJobEventMock } = vi.hoisted(() => ({
  adminCreateJobMock: vi.fn(),
  publishJobEventMock: vi.fn(),
}))

vi.mock("@/backend/admin-client", () => ({
  AdminGraphqlClient: vi.fn().mockImplementation(() => ({
    createJob: adminCreateJobMock,
  })),
}))

vi.mock("@/lib/job-events", () => ({
  publishJobEvent: publishJobEventMock,
}))

function buildJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    muxAssetId: "asset-1",
    muxPlaybackId: "playback-1",
    languages: ["529"],
    options: {},
    status: "pending",
    retries: 0,
    createdAt: "2026-04-11T00:00:00.000Z",
    updatedAt: "2026-04-11T00:00:00.000Z",
    artifacts: {},
    errors: [],
    steps: [],
    ...overrides,
  }
}

describe("createJob", () => {
  beforeEach(() => {
    adminCreateJobMock.mockReset()
    publishJobEventMock.mockReset()
  })

  it("creates jobs through Admin GraphQL", async () => {
    const createdJob = buildJob()
    adminCreateJobMock.mockResolvedValue(createdJob)

    const { createJob } = await import("./state")

    const job = await createJob("asset-1", "playback-1", ["529"], {
      videoDocumentId: "video-doc-1",
      sourceCollectionTitle: "Collection A",
      sourceMediaTitle: "Main feature",
      initialArtifacts: {
        transcriptionRouting: {
          kind: "metadata",
          data: { sourceInputUrl: "https://example.com/video.mp4" },
        },
      },
    })

    expect(adminCreateJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        languages: ["529"],
        videoDocumentId: "video-doc-1",
        sourceCollectionTitle: "Collection A",
        sourceMediaTitle: "Main feature",
      }),
    )
    expect(job).toBe(createdJob)
    expect(publishJobEventMock).toHaveBeenCalledWith(createdJob)
  })
})
