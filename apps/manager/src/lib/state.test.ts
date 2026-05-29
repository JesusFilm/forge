import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildJobUpdateData,
  createJob,
  getJob,
  listJobSummaries,
  mergeArtifactEntries,
  mergeJobArtifacts,
  normalizeJobArtifacts,
  restampEngine,
  toJobRecord,
  updateJob,
  updateStepStatus,
} from "@/lib/state"
import { readEngineStamp } from "@/lib/engine-stamp"

const {
  publishJobEventMock,
  adminGetJobMock,
  adminListJobsMock,
  adminUpdateJobMock,
  adminCountJobsMock,
  adminCreateJobMock,
} = vi.hoisted(() => ({
  publishJobEventMock: vi.fn(),
  adminGetJobMock: vi.fn(),
  adminListJobsMock: vi.fn(),
  adminUpdateJobMock: vi.fn(),
  adminCountJobsMock: vi.fn(),
  adminCreateJobMock: vi.fn(),
}))

vi.mock("@/backend/admin-client", () => ({
  AdminGraphqlClient: vi.fn().mockImplementation(() => ({
    getJob: adminGetJobMock,
    listJobs: adminListJobsMock,
    updateJob: adminUpdateJobMock,
    countJobs: adminCountJobsMock,
    createJob: adminCreateJobMock,
  })),
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

beforeEach(() => {
  publishJobEventMock.mockReset()
  adminGetJobMock.mockReset()
  adminListJobsMock.mockReset()
  adminUpdateJobMock.mockReset()
  adminCountJobsMock.mockReset()
  adminCreateJobMock.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("buildJobUpdateData", () => {
  it("serializes explicit currentStep clearing as null", () => {
    expect(
      buildJobUpdateData({
        status: "failed",
        currentStep: undefined,
      }),
    ).toEqual({
      status: "failed",
      currentStep: null,
    })
  })

  it("serializes explicit errors clearing as an empty array", () => {
    expect(
      buildJobUpdateData({
        errors: [],
      }),
    ).toEqual({
      errors: [],
    })
  })

  it("merges new artifact manifest entries without dropping metadata", () => {
    expect(
      mergeArtifactEntries(
        {
          materialization: {
            kind: "metadata",
            data: { sourceVideoCoreId: "video-1" },
          },
          transcript: { kind: "downloadable" },
        },
        {
          chapters: { kind: "downloadable" },
          metadata: { kind: "downloadable" },
        },
      ),
    ).toEqual({
      materialization: {
        kind: "metadata",
        data: { sourceVideoCoreId: "video-1" },
      },
      transcript: { kind: "downloadable" },
      chapters: { kind: "downloadable" },
      metadata: { kind: "downloadable" },
    })
  })

  it("normalizes legacy artifact values into the new manifest shape", () => {
    expect(
      normalizeJobArtifacts({
        transcript: "/api/jobs/job-1/artifacts/transcript",
        materialization:
          '{"mode":"snapshot_to_stage_clone","sourceVideoCoreId":"video-1"}',
      }),
    ).toEqual({
      transcript: { kind: "downloadable" },
      materialization: {
        kind: "metadata",
        data: {
          mode: "snapshot_to_stage_clone",
          sourceVideoCoreId: "video-1",
        },
      },
    })
  })
})

describe("job read models", () => {
  it("keeps artifacts in summary records so unresolved routing failures stay visible", async () => {
    adminListJobsMock.mockResolvedValue([
      {
        ...buildGraphqlJob("job-1"),
        artifacts: { transcriptionRouting: { kind: "metadata", data: {} } },
        errors: [{ step: "transcription", message: "No source", at: "now" }],
      },
    ])

    const summaries = await listJobSummaries()

    expect(summaries[0].artifacts).toMatchObject({
      transcriptionRouting: { kind: "metadata" },
    })
    expect(summaries[0].errors).toHaveLength(1)
  })

  it("includes source fields when polling a job so source titles do not disappear", async () => {
    adminGetJobMock.mockResolvedValue({
      ...buildGraphqlJob("job-1"),
      sourceMediaTitle: "Main feature",
      sourceCollectionTitle: "Collection A",
    })

    await expect(getJob("job-1")).resolves.toMatchObject({
      sourceMediaTitle: "Main feature",
      sourceCollectionTitle: "Collection A",
    })
  })
})

describe("admin job event publishing", () => {
  it("publishes the normalized job after updateJob succeeds", async () => {
    const updated = {
      id: "job-10",
      ...buildGraphqlJob("job-10"),
      status: "running",
      currentStep: "transcription",
    }
    adminUpdateJobMock.mockResolvedValue(updated)

    const updatedJob = await updateJob("job-10", {
      status: "running",
      currentStep: "transcription",
    })

    expect(updatedJob).toMatchObject({
      id: "job-10",
      status: "running",
      currentStep: "transcription",
    })
    expect(publishJobEventMock).toHaveBeenCalledWith(updatedJob)
  })

  it("publishes the merged job after mergeJobArtifacts succeeds", async () => {
    adminGetJobMock.mockResolvedValueOnce({
      ...buildGraphqlJob("job-11"),
      artifacts: {
        materialization: {
          kind: "metadata",
          data: { sourceLanguageCode: "en" },
        },
      },
    })
    adminUpdateJobMock.mockResolvedValueOnce({
      ...buildGraphqlJob("job-11"),
      artifacts: {
        materialization: {
          kind: "metadata",
          data: { sourceLanguageCode: "en" },
        },
        transcript: { kind: "downloadable" },
      },
    })

    const updatedJob = await mergeJobArtifacts("job-11", {
      transcript: { kind: "downloadable" },
    })

    expect(updatedJob?.artifacts).toMatchObject({
      transcript: { kind: "downloadable" },
    })
    expect(publishJobEventMock).toHaveBeenCalledWith(updatedJob)
  })

  it("publishes the normalized job after updateStepStatus succeeds", async () => {
    adminGetJobMock.mockResolvedValueOnce({
      ...buildGraphqlJob("job-12"),
      steps: [
        {
          name: "transcription",
          status: "pending",
          retries: 0,
          startedAt: null,
          finishedAt: null,
          error: null,
          details: null,
        },
      ],
    })
    adminUpdateJobMock.mockResolvedValueOnce({
      ...buildGraphqlJob("job-12"),
      steps: [
        {
          name: "transcription",
          status: "completed",
          retries: 0,
          startedAt: "2026-04-11T00:00:10.000Z",
          finishedAt: "2026-04-11T00:00:20.000Z",
          error: null,
          details: null,
        },
      ],
    })

    const updatedJob = await updateStepStatus(
      "job-12",
      "transcription",
      "completed",
    )

    expect(updatedJob?.steps[0]).toMatchObject({
      name: "transcription",
      status: "completed",
    })
    expect(publishJobEventMock).toHaveBeenCalledWith(updatedJob)
  })
})

describe("toJobRecord", () => {
  it("keeps source titles when a job read includes the rich video shape", () => {
    expect(
      toJobRecord({
        documentId: "job-3",
        muxAssetId: "asset-3",
        muxPlaybackId: "playback-3",
        languages: ["en"],
        status: "completed",
        currentStep: "metadata",
        retries: 0,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:01:00.000Z",
        startedAt: "2026-04-09T00:00:10.000Z",
        completedAt: "2026-04-09T00:01:00.000Z",
        artifacts: {},
        errors: [],
        steps: [],
        video: {
          documentId: "video-doc-1",
          title: "Live title",
          parents: [{ title: "Collection A" }, { title: "Collection B" }],
        },
      } as unknown as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      sourceMediaTitle: "Live title",
      sourceCollectionTitle: "Collection A, Collection B",
    })
  })

  it("promotes the related CMS video document id when present", () => {
    expect(
      toJobRecord({
        documentId: "job-3",
        muxAssetId: "asset-3",
        muxPlaybackId: "playback-3",
        languages: ["en"],
        status: "completed",
        currentStep: "metadata",
        retries: 0,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:01:00.000Z",
        startedAt: "2026-04-09T00:00:10.000Z",
        completedAt: "2026-04-09T00:01:00.000Z",
        artifacts: {},
        errors: [],
        steps: [],
        video: {
          documentId: "video-doc-1",
          title: "Live title",
          parents: [],
        },
      } as unknown as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      videoDocumentId: "video-doc-1",
      sourceMediaTitle: "Live title",
    })
  })

  it("derives source-language fields from materialization metadata", () => {
    expect(
      toJobRecord({
        documentId: "job-1",
        muxAssetId: "asset-1",
        muxPlaybackId: "playback-1",
        languages: ["ru"],
        status: "completed",
        currentStep: "translation",
        retries: 0,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:01:00.000Z",
        startedAt: "2026-04-09T00:00:10.000Z",
        completedAt: "2026-04-09T00:01:00.000Z",
        artifacts: {
          materialization: {
            sourceLanguageId: "529",
            sourceLanguageCode: "en",
            sourceSelectionReason: "fallback-en",
            primaryRequestedTargetLanguageCode: "ru",
            resolvedTargetLanguageCodes: ["ru"],
          },
        },
        errors: [],
        steps: [],
      } as unknown as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      sourceLanguageId: "529",
      sourceLanguageCode: "en",
      sourceSelectionReason: "fallback-en",
      primaryRequestedTargetLanguageCode: "ru",
      resolvedTargetLanguageCodes: ["ru"],
      artifacts: {
        materialization: {
          kind: "metadata",
          data: {
            sourceLanguageId: "529",
            sourceLanguageCode: "en",
            sourceSelectionReason: "fallback-en",
            primaryRequestedTargetLanguageCode: "ru",
            resolvedTargetLanguageCodes: ["ru"],
          },
        },
      },
    })
  })

  it("derives source-language fields from legacy stringified materialization metadata", () => {
    expect(
      toJobRecord({
        documentId: "job-2",
        muxAssetId: "asset-2",
        muxPlaybackId: "playback-2",
        languages: ["en"],
        status: "completed",
        currentStep: "transcription",
        retries: 0,
        createdAt: "2026-04-09T00:00:00.000Z",
        updatedAt: "2026-04-09T00:01:00.000Z",
        startedAt: "2026-04-09T00:00:10.000Z",
        completedAt: "2026-04-09T00:01:00.000Z",
        artifacts: {
          materialization:
            '{"sourceLanguageId":"529","sourceLanguageCode":"en","sourceSelectionReason":"requested"}',
        },
        errors: [],
        steps: [],
      } as unknown as Parameters<typeof toJobRecord>[0]),
    ).toMatchObject({
      sourceLanguageId: "529",
      sourceLanguageCode: "en",
      sourceSelectionReason: "requested",
    })
  })
})

describe("engine stamp (P0-A)", () => {
  it("toJobRecord surfaces a persisted engine stamp", () => {
    const job = toJobRecord({
      documentId: "job-eng-1",
      muxAssetId: "asset-1",
      muxPlaybackId: "playback-1",
      languages: ["en"],
      status: "running",
      currentStep: "translation",
      retries: 0,
      createdAt: "2026-05-29T00:00:00.000Z",
      updatedAt: "2026-05-29T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
      options: { engine: "mastra", uploadMux: true },
      artifacts: {},
      errors: [],
      steps: [],
    } as unknown as Parameters<typeof toJobRecord>[0])

    expect(job.options).toEqual({ engine: "mastra", uploadMux: true })
    expect(readEngineStamp(job.options)).toBe("mastra")
  })

  it("toJobRecord defaults an unstamped (pre-migration) job to the workflow engine", () => {
    const job = toJobRecord(
      buildGraphqlJob("job-eng-legacy") as unknown as Parameters<
        typeof toJobRecord
      >[0],
    )

    expect(job.options).toEqual({})
    expect(readEngineStamp(job.options)).toBe("workflow")
  })

  it("createJob persists the engine stamp through the admin write path", async () => {
    adminCreateJobMock.mockImplementation(
      async (input: { options?: unknown }) => ({
        ...buildGraphqlJob("job-eng-create"),
        options: input.options,
      }),
    )

    const job = await createJob("asset-1", "playback-1", ["en"], {
      engine: "mastra",
    })

    expect(adminCreateJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ options: { engine: "mastra" } }),
    )
    expect(readEngineStamp(job.options)).toBe("mastra")
  })

  it("createJob omits the stamp when no engine is supplied (legacy default)", async () => {
    adminCreateJobMock.mockImplementation(
      async (input: { options?: unknown }) => ({
        ...buildGraphqlJob("job-eng-nostamp"),
        options: input.options,
      }),
    )

    await createJob("asset-1", "playback-1", ["en"])

    expect(adminCreateJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ options: {} }),
    )
  })

  it("restampEngine merges the engine without clobbering sibling options", async () => {
    adminGetJobMock.mockResolvedValueOnce({
      ...buildGraphqlJob("job-eng-restamp"),
      options: { generateVoiceover: true, uploadMux: true },
    })
    adminUpdateJobMock.mockImplementation(
      async (_id: string, updates: { options?: unknown }) => ({
        ...buildGraphqlJob("job-eng-restamp"),
        options: updates.options,
      }),
    )

    const job = await restampEngine("job-eng-restamp", "mastra")

    expect(adminUpdateJobMock).toHaveBeenCalledWith("job-eng-restamp", {
      options: { generateVoiceover: true, uploadMux: true, engine: "mastra" },
    })
    expect(readEngineStamp(job?.options)).toBe("mastra")
    expect(job?.options).toMatchObject({
      generateVoiceover: true,
      uploadMux: true,
    })
  })
})
