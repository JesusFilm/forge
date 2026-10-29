import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"

const {
  candidatesMock,
  createEnrichmentJobsMock,
  getCmsGatewayMock,
  queryMock,
} = vi.hoisted(() => ({
  candidatesMock: vi.fn(),
  createEnrichmentJobsMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock("./automation-store", () => ({
  getAdminAutomationAdapter: async () => ({ candidates: candidatesMock }),
}))

vi.mock("@/cms/client", () => ({
  default: () => ({ query: queryMock }),
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

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
    runMode: "live",
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
    candidatesMock.mockReset()
    createEnrichmentJobsMock.mockReset()
    getCmsGatewayMock.mockReset()
    queryMock.mockReset()
    getCmsGatewayMock.mockReturnValue({ mode: "live" })
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
    expect(candidatesMock).not.toHaveBeenCalled()
    expect(queryMock).not.toHaveBeenCalled()
    expect(createEnrichmentJobsMock).not.toHaveBeenCalled()
  })

  it("does not fetch aggregate subtitle coverage for stale multi-language target automations", async () => {
    candidatesMock.mockResolvedValue({ videos: [] })
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
    expect(candidatesMock).not.toHaveBeenCalled()
    expect(queryMock).not.toHaveBeenCalled()
    expect(createEnrichmentJobsMock).not.toHaveBeenCalled()
  })

  it("enqueues refreshable AI target subtitles using one target language", async () => {
    candidatesMock.mockResolvedValue({
      candidates: [
        {
          documentId: "video-1",
          coreId: "core-1",
          outputOwner: "ai",
        },
      ],
      eligibleCount: 1,
      skippedDuplicateCount: 0,
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

    expect(candidatesMock).toHaveBeenCalledWith({
      template: "target_subtitles_missing",
      refreshMode: "refresh_ai_generated",
      targetLanguageIds: ["529"],
      limit: 1,
    })
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

  it("uses bounded Admin selection for automation dispatch", async () => {
    candidatesMock.mockResolvedValue({
      candidates: [
        {
          documentId: "video-1",
          coreId: "core-1",
          outputOwner: "ai",
        },
      ],
      eligibleCount: 1,
      skippedDuplicateCount: 0,
    })
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

    expect(candidatesMock).toHaveBeenCalledWith({
      template: "target_subtitles_missing",
      refreshMode: "refresh_ai_generated",
      targetLanguageIds: ["529"],
      limit: 1,
    })
    expect(queryMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: "success",
      enqueuedCount: 1,
    })
  })

  it("returns a report-only dry run without creating enrichment jobs", async () => {
    const automation = buildAutomation({
      template: "metadata_missing",
      refreshMode: "missing_only",
      maxVideosPerRun: 1,
    })
    candidatesMock.mockResolvedValue({
      candidates: [
        {
          documentId: "video-1",
          coreId: "core-1",
          outputOwner: "missing",
        },
      ],
      eligibleCount: 1,
      skippedDuplicateCount: 0,
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
      automation,
      runMode: "dry_run",
    } as unknown as Parameters<typeof enqueueAutomationRun>[0])

    expect(createEnrichmentJobsMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: "success",
      eligibleCount: 1,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      jobDocumentIds: [],
      dryRunReport: {
        kind: "metadata",
        data: {
          runMode: "dry_run",
          automationDocumentId: "automation-1",
          automationRunDocumentId: "run-1",
          template: "metadata_missing",
          refreshMode: "missing_only",
          wouldEnqueueCount: 1,
          selectedCandidates: [
            {
              videoDocumentId: "video-1",
              coreId: "core-1",
              outputOwner: "missing",
              automationKey: "metadata_missing:video-1:source",
            },
          ],
          suppressedOperations: expect.arrayContaining([
            "createEnrichmentJobs",
            "syncTranslatedSubtitlesToMux",
          ]),
        },
      },
    })
  })

  it("returns a no-op dry-run report when no candidates would be enqueued", async () => {
    const automation = buildAutomation({
      template: "metadata_missing",
      refreshMode: "missing_only",
      maxVideosPerRun: 1,
    })
    candidatesMock.mockResolvedValue({
      candidates: [],
      eligibleCount: 0,
      skippedDuplicateCount: 0,
    })
    queryMock.mockResolvedValue({ data: { enrichmentJobs: [] } })

    const result = await enqueueAutomationRun({
      runDocumentId: "run-1",
      automation,
      runMode: "dry_run",
    } as unknown as Parameters<typeof enqueueAutomationRun>[0])

    expect(createEnrichmentJobsMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: "no_op",
      eligibleCount: 0,
      enqueuedCount: 0,
      dryRunReport: {
        data: {
          runMode: "dry_run",
          wouldEnqueueCount: 0,
          selectedCandidates: [],
        },
      },
    })
  })

  it("selects candidates from mock state without calling Admin endpoints", async () => {
    const mockState = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => mockState),
    })
    createEnrichmentJobsMock.mockResolvedValue({
      created: 1,
      failed: 0,
      jobs: [{ jobId: "mock-job-3" }],
      errors: [],
    })

    const result = await enqueueAutomationRun({
      runDocumentId: "run-1",
      automation: buildAutomation({
        template: "metadata_missing",
        refreshMode: "missing_only",
      }),
    })

    expect(candidatesMock).not.toHaveBeenCalled()
    expect(createEnrichmentJobsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        videoIds: ["ep-2"],
      }),
    )
    expect(result).toMatchObject({
      status: "success",
      eligibleCount: 1,
      enqueuedCount: 1,
    })
  })

  it("does not enqueue human-owned target subtitles even in refresh mode", async () => {
    candidatesMock.mockResolvedValue({
      candidates: [],
      eligibleCount: 0,
      skippedDuplicateCount: 0,
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

    expect(candidatesMock).toHaveBeenCalledWith({
      template: "target_subtitles_missing",
      refreshMode: "refresh_ai_generated",
      targetLanguageIds: ["529"],
      limit: 1,
    })
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

    candidatesMock.mockResolvedValue({
      candidates: [],
      eligibleCount: 0,
      skippedDuplicateCount: 1,
    })

    const result = await enqueueAutomationRun({
      runDocumentId: "run-1",
      automation,
    })

    expect(candidatesMock).toHaveBeenCalledWith({
      template: "metadata_missing",
      refreshMode: "missing_only",
      targetLanguageIds: [],
      limit: 1,
    })
    expect(queryMock).not.toHaveBeenCalled()
    expect(createEnrichmentJobsMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: "no_op",
      eligibleCount: 0,
      skippedDuplicateCount: 1,
      enqueuedCount: 0,
    })
  })
})
