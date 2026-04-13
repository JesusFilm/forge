import { beforeEach, describe, expect, it, vi } from "vitest"

const { cmsGetMock, createEnrichmentJobsMock, queryMock } = vi.hoisted(() => ({
  cmsGetMock: vi.fn(),
  createEnrichmentJobsMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock("@/services/cmsClient", () => ({
  cmsGet: cmsGetMock,
}))

vi.mock("@/cms/client", () => ({
  default: () => ({ query: queryMock }),
}))

vi.mock("@/app/api/enrich/route", () => ({
  createEnrichmentJobs: createEnrichmentJobsMock,
}))

import { enqueueAutomationRun } from "./automation-runner"
import type { EnrichmentAutomation } from "./automation-contract"

function buildAutomation(
  input: Partial<EnrichmentAutomation> = {},
): EnrichmentAutomation {
  return {
    documentId: "automation-1",
    name: "Missing metadata",
    template: "metadata_missing",
    status: "active",
    schedule: { kind: "every_minute", timezone: "UTC" },
    timezone: "UTC",
    refreshMode: "missing_only",
    targetLanguageIds: [],
    maxVideosPerRun: 1,
    runs: [],
    ...input,
  }
}

describe("enqueueAutomationRun", () => {
  beforeEach(() => {
    cmsGetMock.mockReset()
    createEnrichmentJobsMock.mockReset()
    queryMock.mockReset()
  })

  it("does not enqueue embedding automations while coverage-backed eligibility is unavailable", async () => {
    const result = await enqueueAutomationRun({
      runDocumentId: "run-1",
      automation: buildAutomation({
        template: "transcript_embeddings_missing",
      }),
    })

    expect(result).toMatchObject({
      status: "no_op",
      eligibleCount: 0,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
    })
    expect(result.summary).toContain("not available")
    expect(cmsGetMock).not.toHaveBeenCalled()
    expect(queryMock).not.toHaveBeenCalled()
    expect(createEnrichmentJobsMock).not.toHaveBeenCalled()
  })

  it("does not fetch aggregate subtitle coverage for stale multi-language target automations", async () => {
    cmsGetMock.mockResolvedValue({ videos: [] })
    queryMock.mockResolvedValue({ data: { enrichmentJobs: [] } })

    const result = await enqueueAutomationRun({
      runDocumentId: "run-1",
      automation: buildAutomation({
        template: "target_subtitles_missing",
        targetLanguageIds: ["529", "6414"],
      }),
    })

    expect(result).toMatchObject({
      status: "no_op",
      eligibleCount: 0,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
    })
    expect(result.summary).toContain("one target language")
    expect(cmsGetMock).not.toHaveBeenCalled()
    expect(queryMock).not.toHaveBeenCalled()
    expect(createEnrichmentJobsMock).not.toHaveBeenCalled()
  })

  it("enqueues refreshable AI target subtitles using one target language", async () => {
    cmsGetMock.mockResolvedValue({
      videos: [
        {
          documentId: "video-1",
          coreId: "core-1",
          label: "featureFilm",
          aiMetadata: null,
          coverage: {
            subtitles: { human: 0, ai: 1 },
            audio: { human: 0, ai: 0 },
          },
        },
      ],
    })
    queryMock.mockResolvedValue({ data: { enrichmentJobs: [] } })
    createEnrichmentJobsMock.mockResolvedValue({
      created: 1,
      failed: 0,
      jobs: [{ jobId: "job-1" }],
      errors: [],
    })

    const result = await enqueueAutomationRun({
      runDocumentId: "run-1",
      automation: buildAutomation({
        template: "target_subtitles_missing",
        refreshMode: "refresh_ai_generated",
        targetLanguageIds: ["529"],
      }),
    })

    expect(cmsGetMock).toHaveBeenCalledWith("/video-coverage?languageIds=529")
    expect(createEnrichmentJobsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        videoIds: ["core-1"],
        targetLanguageIds: ["529"],
      }),
    )
    expect(result).toMatchObject({
      status: "success",
      eligibleCount: 1,
      enqueuedCount: 1,
      skippedDuplicateCount: 0,
    })
  })

  it("does not enqueue human-owned target subtitles even in refresh mode", async () => {
    cmsGetMock.mockResolvedValue({
      videos: [
        {
          documentId: "video-1",
          coreId: "core-1",
          label: "featureFilm",
          aiMetadata: null,
          coverage: {
            subtitles: { human: 1, ai: 0 },
            audio: { human: 0, ai: 0 },
          },
        },
      ],
    })
    queryMock.mockResolvedValue({ data: { enrichmentJobs: [] } })

    const result = await enqueueAutomationRun({
      runDocumentId: "run-1",
      automation: buildAutomation({
        template: "target_subtitles_missing",
        refreshMode: "refresh_ai_generated",
        targetLanguageIds: ["529"],
      }),
    })

    expect(cmsGetMock).toHaveBeenCalledWith("/video-coverage?languageIds=529")
    expect(createEnrichmentJobsMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: "no_op",
      eligibleCount: 0,
      enqueuedCount: 0,
    })
  })

  it("suppresses duplicates found beyond the first running job page", async () => {
    const automation = buildAutomation({
      template: "metadata_missing",
      refreshMode: "missing_only",
      maxVideosPerRun: 1,
    })

    cmsGetMock.mockResolvedValue({
      videos: [
        {
          documentId: "video-1",
          coreId: "core-1",
          label: "featureFilm",
          aiMetadata: null,
          coverage: {
            subtitles: { human: 0, ai: 0 },
            audio: { human: 0, ai: 0 },
          },
        },
      ],
    })
    queryMock
      .mockResolvedValueOnce({
        data: {
          enrichmentJobs: Array.from({ length: 200 }, (_value, index) => ({
            artifacts: {
              automation: {
                kind: "metadata",
                data: {
                  automationKey: `metadata_missing:other-${index}:source`,
                },
              },
            },
          })),
        },
      })
      .mockResolvedValueOnce({
        data: {
          enrichmentJobs: [
            {
              artifacts: {
                automation: {
                  kind: "metadata",
                  data: { automationKey: "metadata_missing:video-1:source" },
                },
              },
            },
          ],
        },
      })

    const result = await enqueueAutomationRun({
      runDocumentId: "run-1",
      automation,
    })

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        variables: expect.objectContaining({
          pagination: { page: 1, pageSize: 200 },
        }),
      }),
    )
    expect(queryMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        variables: expect.objectContaining({
          pagination: { page: 2, pageSize: 200 },
        }),
      }),
    )
    expect(createEnrichmentJobsMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: "no_op",
      eligibleCount: 0,
      skippedDuplicateCount: 1,
      enqueuedCount: 0,
    })
  })
})
