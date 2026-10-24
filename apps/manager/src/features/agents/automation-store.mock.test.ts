import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_MOCK_CMS_SEED, cloneMockCmsSeed } from "@/cms/mock-seed"

const { cmsPostMock, getCmsGatewayMock, queryMock } = vi.hoisted(() => ({
  cmsPostMock: vi.fn(),
  getCmsGatewayMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock("@/cms/client", () => ({
  default: () => ({ query: queryMock, mutate: vi.fn() }),
}))

vi.mock("@/services/cmsClient", () => ({
  cmsPost: cmsPostMock,
}))

vi.mock("@/cms/gateway", async () => {
  const actual =
    await vi.importActual<typeof import("@/cms/gateway")>("@/cms/gateway")
  return {
    ...actual,
    getCmsGateway: getCmsGatewayMock,
  }
})

import {
  claimAutomationDryRun,
  completeAutomationRun,
  createAutomation,
  createAutomationRun,
  getAutomation,
  releaseAutomationDryRunClaim,
  updateAutomationStatus,
} from "./automation-store"

describe("automation-store in mock mode", () => {
  beforeEach(() => {
    cmsPostMock.mockReset()
    getCmsGatewayMock.mockReset()
    queryMock.mockReset()
  })

  it("creates and updates automations locally", async () => {
    let state = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => state),
      updateMockState: vi.fn(async (updater) => {
        state = updater(state)
        return state
      }),
    })

    const automation = await createAutomation({
      name: "Mock Metadata Sweep",
      template: "metadata_missing",
      runMode: "dry_run",
      refreshMode: "missing_only",
      schedule: { kind: "daily", hour: 9, minute: 0, timezone: "UTC" },
      targetLanguageIds: [],
      maxVideosPerRun: 3,
      status: "active",
      scheduleSummary: "Daily at 09:00 UTC",
      timezone: "UTC",
      nextRunAt: "2026-04-23T09:00:00.000Z",
    })

    expect(automation.documentId).toBe("mock-automation-3")
    expect(cmsPostMock).not.toHaveBeenCalled()

    const paused = await updateAutomationStatus(automation.documentId, {
      status: "paused",
      nextRunAt: null,
    })

    expect(paused.status).toBe("paused")
    await expect(getAutomation(automation.documentId)).resolves.toMatchObject({
      documentId: "mock-automation-3",
      status: "paused",
    })
  })

  it("tracks dry-run claim and completion lifecycle locally", async () => {
    let state = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => state),
      updateMockState: vi.fn(async (updater) => {
        state = updater(state)
        return state
      }),
    })

    const claim = await claimAutomationDryRun("mock-automation-1")
    expect(claim).toMatchObject({ documentId: "mock-automation-1" })

    const run = await createAutomationRun({
      automationDocumentId: "mock-automation-1",
      runMode: "dry_run",
      scheduledFor: "2026-04-22T16:00:00.000Z",
      startedAt: "2026-04-22T16:00:00.000Z",
    })

    const completed = await completeAutomationRun({
      runDocumentId: run.documentId,
      finishedAt: "2026-04-22T16:01:00.000Z",
      result: {
        status: "success",
        eligibleCount: 1,
        enqueuedCount: 0,
        skippedDuplicateCount: 0,
        errorCount: 0,
        jobDocumentIds: [],
        errors: [],
        summary: "Dry run complete.",
      },
    })

    expect(completed.status).toBe("success")
    await expect(
      releaseAutomationDryRunClaim("mock-automation-1", claim!.leaseToken),
    ).resolves.toBe(true)
  })
})
