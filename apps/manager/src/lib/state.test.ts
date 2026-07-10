import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildJobUpdateData,
  getJob,
  listJobSummaries,
  mergeArtifactEntries,
  mergeJobArtifacts,
  mergeShortsReportEntry,
  normalizeJobArtifacts,
  toJobRecord,
  updateJob,
  updateStepStatus,
} from "@/lib/state"

const {
  publishJobEventMock,
  adminGetJobMock,
  adminListJobsMock,
  adminUpdateJobMock,
  adminCountJobsMock,
} = vi.hoisted(() => ({
  publishJobEventMock: vi.fn(),
  adminGetJobMock: vi.fn(),
  adminListJobsMock: vi.fn(),
  adminUpdateJobMock: vi.fn(),
  adminCountJobsMock: vi.fn(),
}))

vi.mock("@/backend/admin-client", () => ({
  AdminGraphqlClient: vi.fn().mockImplementation(() => ({
    getJob: adminGetJobMock,
    listJobs: adminListJobsMock,
    updateJob: adminUpdateJobMock,
    countJobs: adminCountJobsMock,
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

  it("normalizes admin-mode update variables before serialization", async () => {
    adminUpdateJobMock.mockImplementation(
      async (_id: string, updates: Record<string, unknown>) => ({
        ...buildGraphqlJob("job-10"),
        ...updates,
      }),
    )

    await updateJob("job-10", {
      status: "completed",
      currentStep: undefined,
      completedAt: undefined,
      artifacts: {
        materialization: {
          kind: "metadata",
          data: {
            sourceLanguageId: "529",
            sourceLanguageCode: "en",
            resolvedTargetLanguageCodes: ["es"],
          },
        },
      },
    })

    expect(adminUpdateJobMock).toHaveBeenCalledWith("job-10", {
      status: "completed",
      currentStep: null,
      completedAt: null,
      artifacts: {
        materialization: {
          kind: "metadata",
          data: {
            sourceLanguageId: "529",
            sourceLanguageCode: "en",
            resolvedTargetLanguageCodes: ["es"],
          },
        },
      },
      sourceLanguageId: "529",
      sourceLanguageCode: "en",
      resolvedTargetLanguageCodes: ["es"],
    })
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

  it("merges a shorts report patch field-level against the CURRENT entry", async () => {
    // Lost-update regression (todo 011): the persisted phase is "rendering"
    // (a render workflow moved it after the caller's stale read); a
    // draftVersion-only patch must NOT revert the phase — the entry is
    // re-read inside the per-job write lock and merged field-level.
    const persistedShorts = {
      kind: "metadata",
      data: {
        domain: "shorts",
        phase: "rendering",
        annotation: null,
        hasAudio: true,
        clipDurationSec: 30,
        captionsCount: 42,
        draftVersion: 3,
        lastRenderedDraftVersion: 2,
        lastRenderedPropsHash: "a".repeat(64),
        output: { muxAssetId: "mux-old", playbackId: "pb-old", ready: true },
        updatedAt: "2026-06-11T10:00:00.000Z",
      },
    }
    adminGetJobMock.mockResolvedValueOnce({
      ...buildGraphqlJob("job-20"),
      artifacts: {
        shorts: persistedShorts,
        transcript: { kind: "downloadable" },
      },
    })
    adminUpdateJobMock.mockImplementation(
      async (_id: string, updates: Record<string, unknown>) => ({
        ...buildGraphqlJob("job-20"),
        artifacts: updates.artifacts,
      }),
    )

    await mergeShortsReportEntry("job-20", { draftVersion: 4 })

    const [, updates] = adminUpdateJobMock.mock.calls[0] as [
      string,
      { artifacts: Record<string, { data: Record<string, unknown> }> },
    ]
    expect(updates.artifacts.shorts.data).toMatchObject({
      domain: "shorts",
      phase: "rendering", // preserved — patch never carried it
      draftVersion: 4, // patched
      hasAudio: true,
      captionsCount: 42,
      output: { muxAssetId: "mux-old", playbackId: "pb-old", ready: true },
    })
    // Sibling manifest entries survive the merge.
    expect(updates.artifacts).toMatchObject({
      transcript: { kind: "downloadable" },
    })
  })

  it("builds the shorts entry from defaults when none is persisted yet", async () => {
    adminGetJobMock.mockResolvedValueOnce(buildGraphqlJob("job-21"))
    adminUpdateJobMock.mockImplementation(
      async (_id: string, updates: Record<string, unknown>) => ({
        ...buildGraphqlJob("job-21"),
        artifacts: updates.artifacts,
      }),
    )

    await mergeShortsReportEntry("job-21", { phase: "preparing" })

    const [, updates] = adminUpdateJobMock.mock.calls[0] as [
      string,
      { artifacts: Record<string, { data: Record<string, unknown> }> },
    ]
    expect(updates.artifacts.shorts.data).toMatchObject({
      domain: "shorts",
      phase: "preparing",
      draftVersion: 0,
    })
  })

  it("returns null without writing when the job is missing", async () => {
    adminGetJobMock.mockResolvedValueOnce(null)

    await expect(
      mergeShortsReportEntry("job-gone", { draftVersion: 1 }),
    ).resolves.toBeNull()
    expect(adminUpdateJobMock).not.toHaveBeenCalled()
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

  // Read-back contract for smart-crop render progress: admin-mode jobs round-
  // trip step details through normalizeStepDetails, which must preserve
  // progress/message (it used to strip everything except languageResults).
  it("preserves step-detail progress and message on read-back", () => {
    const record = toJobRecord({
      documentId: "job-progress",
      muxAssetId: "asset-1",
      muxPlaybackId: "playback-1",
      languages: [],
      status: "running",
      currentStep: "smart_crop_render",
      retries: 0,
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:01:00.000Z",
      startedAt: "2026-06-09T00:00:10.000Z",
      completedAt: null,
      artifacts: {},
      errors: [],
      steps: [
        {
          name: "smart_crop_render",
          status: "running",
          retries: 0,
          startedAt: "2026-06-09T00:00:10.000Z",
          finishedAt: null,
          error: null,
          details: { progress: 0.42, message: "Rendering segment 42 of 100" },
        },
        {
          name: "smart_crop_mux_output",
          status: "pending",
          retries: 0,
          startedAt: null,
          finishedAt: null,
          error: null,
          details: { progress: "not-a-number", message: 7 },
        },
      ],
    } as unknown as Parameters<typeof toJobRecord>[0])

    expect(record.steps[0]?.details).toEqual({
      progress: 0.42,
      message: "Rendering segment 42 of 100",
    })
    // Wrong-typed fields are dropped; an all-invalid payload reads back as
    // undefined details.
    expect(record.steps[1]?.details).toBeUndefined()
  })

  it("preserves allowlisted Mastra step diagnostics on read-back", () => {
    const record = toJobRecord({
      documentId: "job-mastra",
      muxAssetId: "asset-1",
      muxPlaybackId: "playback-1",
      languages: [],
      status: "running",
      currentStep: "embeddings",
      retries: 0,
      createdAt: "2026-06-13T00:00:00.000Z",
      updatedAt: "2026-06-13T00:01:00.000Z",
      startedAt: "2026-06-13T00:00:10.000Z",
      completedAt: null,
      artifacts: {},
      errors: [],
      steps: [
        {
          name: "embeddings",
          status: "completed",
          retries: 0,
          startedAt: "2026-06-13T00:00:10.000Z",
          finishedAt: "2026-06-13T00:00:20.000Z",
          error: null,
          details: {
            mastra: {
              runId: "run-1",
              status: "created",
              provider: "openai",
              model: "text-embedding-3-small",
              chunks: 4,
              totalTokens: 123,
              sourceContentHash: "sha256:abc",
              transcript: "must not round-trip",
              requestBody: { secret: true },
            },
          },
        },
      ],
    } as unknown as Parameters<typeof toJobRecord>[0])

    expect(record.steps[0]?.details).toEqual({
      mastra: {
        runId: "run-1",
        status: "created",
        provider: "openai",
        model: "text-embedding-3-small",
        chunks: 4,
        totalTokens: 123,
        sourceContentHash: "sha256:abc",
      },
    })
  })

  it("preserves subtitle validation summaries on read-back", () => {
    const record = toJobRecord({
      documentId: "job-validation",
      muxAssetId: "asset-1",
      muxPlaybackId: "playback-1",
      languages: ["es"],
      status: "completed",
      currentStep: null,
      retries: 0,
      createdAt: "2026-06-16T00:00:00.000Z",
      updatedAt: "2026-06-16T00:01:00.000Z",
      startedAt: "2026-06-16T00:00:10.000Z",
      completedAt: "2026-06-16T00:00:20.000Z",
      artifacts: {},
      errors: [],
      steps: [
        {
          name: "translation",
          status: "completed",
          retries: 0,
          startedAt: "2026-06-16T00:00:10.000Z",
          finishedAt: "2026-06-16T00:00:20.000Z",
          error: null,
          details: {
            subtitleValidation: {
              highestVerdict: "needs_review",
              languagesChecked: 1,
              modelOnlyLanguages: ["es"],
              unavailableLanguages: [],
              warningCount: 0,
              needsReviewCount: 1,
              results: [
                {
                  lang: "es",
                  verdict: "needs_review",
                  basis: "model_knowledge",
                  confidence: 0.72,
                  checkedReferenceCount: 1,
                  warningCount: 0,
                  needsReviewCount: 1,
                  fallbackReason: "provider_config_missing",
                  unsafePassageText: "must not round-trip",
                },
              ],
            },
          },
        },
      ],
    } as unknown as Parameters<typeof toJobRecord>[0])

    expect(record.steps[0]?.details).toEqual({
      subtitleValidation: {
        highestVerdict: "needs_review",
        languagesChecked: 1,
        modelOnlyLanguages: ["es"],
        unavailableLanguages: [],
        warningCount: 0,
        needsReviewCount: 1,
        results: [
          {
            lang: "es",
            verdict: "needs_review",
            basis: "model_knowledge",
            confidence: 0.72,
            checkedReferenceCount: 1,
            warningCount: 0,
            needsReviewCount: 1,
            fallbackReason: "provider_config_missing",
          },
        ],
      },
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
