import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"

const { createJobMock, getCmsGatewayMock } = vi.hoisted(() => ({
  createJobMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

vi.mock("@/lib/state", () => ({
  createJob: createJobMock,
  updateJob: vi.fn(),
}))

vi.mock("@/cms/client", () => ({
  default: vi.fn(() => ({
    query: vi.fn(),
  })),
}))

import { createEnrichmentJobs } from "./route"

describe("createEnrichmentJobs in mock mode", () => {
  beforeEach(() => {
    createJobMock.mockReset()
    getCmsGatewayMock.mockReset()
  })

  it("creates demo jobs from mock coverage videos without live CMS lookups", async () => {
    const mockState = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => mockState),
    })
    createJobMock.mockResolvedValueOnce({ id: "mock-job-3" })

    const result = await createEnrichmentJobs({
      videoIds: ["ep-2"],
      targetLanguageIds: ["6414"],
      automation: {
        automationDocumentId: "mock-automation-1",
        automationRunDocumentId: "mock-automation-run-2",
        template: "metadata_missing",
        refreshMode: "missing_only",
        targetLanguageIds: [],
      },
    })

    expect(createJobMock).toHaveBeenCalledWith(
      "mock-ep-2-asset",
      "mock-ep-2-playback",
      ["6414"],
      expect.objectContaining({
        videoDocumentId: "video-doc-episode-2",
      }),
    )
    expect(result).toEqual({
      created: 1,
      failed: 0,
      jobs: [{ videoId: "ep-2", jobId: "mock-job-3" }],
    })
  })
})
