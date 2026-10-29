import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createMockCmsStore } from "@/cms/mock-store"
import { createCmsGateway } from "@/cms/gateway"
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
  beginAutomationRunDispatch,
  markAutomationRunFailedIfInFlight,
  claimAutomationDryRun,
  completeAutomationRun,
  createAutomation,
  createAutomationRun,
  getAutomation,
  getAutomationRunByIdempotencyKey,
  releaseAutomationDryRunClaim,
  updateAutomationStatus,
} from "./automation-store"

describe("automation-store in mock mode", () => {
  beforeEach(() => {
    cmsPostMock.mockReset()
    getCmsGatewayMock.mockReset()
    queryMock.mockReset()
  })

  it("persists idempotency identity across mock reads without duplicating runs", async () => {
    let state = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => state),
      updateMockState: vi.fn(async (updater) => {
        state = updater(state)
        return state
      }),
    })
    const input = {
      automationDocumentId: "mock-automation-1",
      idempotencyKey: "agentic-request-1",
      runMode: "dry_run" as const,
      scheduledFor: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    }
    const first = await createAutomationRun(input)
    const second = await createAutomationRun(input)
    expect(second.documentId).toBe(first.documentId)
    expect(first).toMatchObject({
      automationDocumentId: input.automationDocumentId,
      idempotencyKey: input.idempotencyKey,
    })
    await expect(getAutomationRunByIdempotencyKey(input)).resolves.toEqual(
      first,
    )
    await expect(
      getAutomationRunByIdempotencyKey({
        ...input,
        automationDocumentId: "mock-automation-2",
      }),
    ).resolves.toBeNull()
  })

  it("admits competing mock requests once and protects the admitted lease", async () => {
    let state = cloneMockCmsSeed(DEFAULT_MOCK_CMS_SEED)
    getCmsGatewayMock.mockReturnValue({
      mode: "mock",
      readMockState: vi.fn(async () => state),
      updateMockState: vi.fn(async (updater) => {
        state = updater(state)
        return state
      }),
    })
    const claims = await Promise.all([
      claimAutomationDryRun("mock-automation-1"),
      claimAutomationDryRun("mock-automation-1"),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const claim = claims.find((claim) => claim !== null)!
    const input = {
      automationDocumentId: "mock-automation-1",
      leaseToken: claim.leaseToken,
      idempotencyKey: "racing-key",
      runMode: "dry_run" as const,
      scheduledFor: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    }
    const runs = await Promise.all([
      createAutomationRun(input),
      createAutomationRun(input),
    ])
    expect(runs[0].documentId).toBe(runs[1].documentId)
    const admitted = await Promise.all([
      beginAutomationRunDispatch(runs[0].documentId, claim.leaseToken),
      beginAutomationRunDispatch(runs[1].documentId, claim.leaseToken),
    ])
    expect(admitted.sort()).toEqual([false, true])
    expect(
      await releaseAutomationDryRunClaim("mock-automation-1", "other-lease"),
    ).toBe(false)
    expect(
      await releaseAutomationDryRunClaim("mock-automation-1", claim.leaseToken),
    ).toBe(false)
    expect(
      await markAutomationRunFailedIfInFlight({
        runDocumentId: runs[0].documentId,
        leaseToken: "other-lease",
        finishedAt: new Date().toISOString(),
        error: "Must not replace winner",
      }),
    ).toBe(false)
    await updateAutomationStatus("mock-automation-1", {
      status: "paused",
      nextRunAt: null,
    })
    expect((await getAutomation("mock-automation-1"))?.leaseToken).toBe(
      claim.leaseToken,
    )
    expect(
      await markAutomationRunFailedIfInFlight({
        runDocumentId: runs[0].documentId,
        leaseToken: claim.leaseToken,
        finishedAt: new Date().toISOString(),
        error: "Fixture terminal failure",
      }),
    ).toBe(true)
    expect(
      await releaseAutomationDryRunClaim("mock-automation-1", claim.leaseToken),
    ).toBe(true)
  })
  it("retains run identity after disk reload and admits real mock-store races once", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "manager-automation-recovery-"),
    )
    const dataPath = join(directory, "store.json")
    try {
      const gateway = createCmsGateway({
        mode: "mock",
        mockStore: createMockCmsStore({ dataPath }),
      })
      getCmsGatewayMock.mockReturnValue(gateway)
      const claims = await Promise.all([
        claimAutomationDryRun("mock-automation-1"),
        claimAutomationDryRun("mock-automation-1"),
      ])
      expect(claims.filter(Boolean)).toHaveLength(1)
      const claim = claims.find((claim) => claim !== null)!
      const input = {
        automationDocumentId: "mock-automation-1",
        leaseToken: claim.leaseToken,
        idempotencyKey: "persisted-key",
        runMode: "dry_run" as const,
        scheduledFor: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      }
      const [first, second] = await Promise.all([
        createAutomationRun(input),
        createAutomationRun(input),
      ])
      expect(first.documentId).toBe(second.documentId)
      getCmsGatewayMock.mockReturnValue(
        createCmsGateway({
          mode: "mock",
          mockStore: createMockCmsStore({ dataPath }),
        }),
      )
      expect(await getAutomationRunByIdempotencyKey(input)).toEqual(first)
      const admitted = await Promise.all([
        beginAutomationRunDispatch(first.documentId, claim.leaseToken),
        beginAutomationRunDispatch(first.documentId, claim.leaseToken),
      ])
      expect(admitted.sort()).toEqual([false, true])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
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
