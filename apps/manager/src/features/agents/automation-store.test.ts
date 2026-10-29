import { beforeEach, describe, expect, it, vi } from "vitest"

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))
vi.mock("@/config/env", () => ({
  env: { ADMIN_GRAPHQL_URL: "https://admin.test/api/graphql" },
}))
vi.mock("@/lib/admin-manager-session", () => ({
  getAdminManagerServiceBearer: async () => "service-test",
}))
vi.mock("@/backend/admin-client", async () => {
  const { createAdminAutomationAdapter } =
    await import("@/backend/automation-client")
  return {
    AdminGraphqlClient: class {
      automations = createAdminAutomationAdapter(requestMock)
    },
  }
})
import {
  beginAutomationRunDispatch,
  completeAutomationRun,
  createAutomationRun,
  getAutomationRunByIdempotencyKey,
  claimAutomationDryRun,
  getAutomation,
  getAutomationRun,
  hasInFlightAutomationRun,
  markAutomationRunFailedIfInFlight,
  releaseAutomationDryRunClaim,
} from "./automation-store"

const baseAutomation = {
  documentId: "automation-1",
  name: "Missing metadata",
  template: "metadata_missing",
  status: "active",
  runMode: "dry_run",
  schedule: { kind: "every_minute", timezone: "UTC" },
  timezone: "UTC",
  refreshMode: "missing_only",
  targetLanguageIds: [],
  maxVideosPerRun: 1,
}
const run = {
  documentId: "run-1",
  status: "success",
  runMode: "dry_run",
  scheduledFor: "2026-04-12T09:00:00.000Z",
}
const leaseToken = "c013fb84-8d68-46c0-9b67-7fab8b96c008"

describe("Admin automation store", () => {
  beforeEach(() => requestMock.mockReset())
  it("looks up idempotency keys through the Admin typed adapter", async () => {
    requestMock.mockResolvedValue({
      managerAutomationRunByKey: {
        ...run,
        automationDocumentId: "automation-1",
        idempotencyKey: "request-1",
      },
    })
    expect(
      await getAutomationRunByIdempotencyKey({
        automationDocumentId: "automation-1",
        idempotencyKey: "request-1",
      }),
    ).toMatchObject({ documentId: "run-1", idempotencyKey: "request-1" })
    expect(requestMock).toHaveBeenCalledWith(
      expect.stringContaining("managerAutomationRunByKey"),
      { automationId: "automation-1", key: "request-1" },
    )
  })
  it("passes the lease through create, one-time dispatch, and completion", async () => {
    requestMock
      .mockResolvedValueOnce({ createManagerAutomationRun: run })
      .mockResolvedValueOnce({ beginManagerAutomationDispatch: true })
      .mockResolvedValueOnce({ completeManagerAutomationRun: run })
    const input = {
      automationDocumentId: "automation-1",
      leaseToken,
      idempotencyKey: "request-1",
      runMode: "dry_run" as const,
      scheduledFor: "2026-10-28T00:00:00.000Z",
      startedAt: "2026-10-28T00:00:00.000Z",
    }
    await createAutomationRun(input)
    expect(await beginAutomationRunDispatch("run-1", leaseToken)).toBe(true)
    const result = {
      status: "no_op" as const,
      eligibleCount: 0,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      jobDocumentIds: [],
      errors: [],
      summary: "No eligible videos.",
    }
    await completeAutomationRun({
      runDocumentId: "run-1",
      leaseToken,
      result,
      finishedAt: "2026-10-28T00:01:00.000Z",
    })
    expect(requestMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("createManagerAutomationRun"),
      {
        input: expect.objectContaining({
          automationDocumentId: input.automationDocumentId,
          idempotencyKey: input.idempotencyKey,
          leaseToken,
          runMode: "dry_run",
        }),
      },
    )
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("beginManagerAutomationDispatch"),
      { id: "run-1", leaseToken },
    )
    expect(requestMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("completeManagerAutomationRun"),
      { id: "run-1", leaseToken, result },
    )
    await expect(
      createAutomationRun({ ...input, leaseToken: undefined }),
    ).rejects.toThrow("lease token required")
    await expect(
      completeAutomationRun({
        runDocumentId: "run-1",
        result,
        finishedAt: "now",
      }),
    ).rejects.toThrow("lease token required")
  })
  it("drops malformed reports at the real Admin adapter boundary", async () => {
    requestMock.mockResolvedValue({
      managerAutomation: {
        ...baseAutomation,
        runs: [
          {
            ...run,
            report: {
              kind: "metadata",
              data: { runMode: "dry_run", wouldEnqueueCount: 1 },
            },
          },
        ],
      },
    })
    expect((await getAutomation("automation-1"))?.runs[0]?.report).toBeNull()
  })
  it("queries all in-flight runs independently of the five display rows", async () => {
    requestMock.mockResolvedValue({ managerAutomationHasInFlight: true })
    await expect(hasInFlightAutomationRun("automation-1")).resolves.toBe(true)
    expect(requestMock).toHaveBeenCalledWith(
      expect.stringContaining("managerAutomationHasInFlight"),
      { id: "automation-1" },
    )
  })
  it("reads a canonical run for completion reconciliation", async () => {
    requestMock.mockResolvedValue({ managerAutomationRun: run })
    expect(await getAutomationRun("run-1")).toMatchObject(run)
    expect(requestMock).toHaveBeenCalledWith(
      expect.stringContaining("managerAutomationRun"),
      { id: "run-1" },
    )
  })
  it("claims and releases leases through authenticated Admin mutations", async () => {
    const claim = {
      documentId: "automation-1",
      leaseToken,
      leaseExpiresAt: "2026-04-12T09:10:00.000Z",
    }
    requestMock
      .mockResolvedValueOnce({ claimManagerAutomationRun: claim })
      .mockResolvedValueOnce({ releaseManagerAutomationRun: true })
    await expect(claimAutomationDryRun("automation-1")).resolves.toEqual(claim)
    await expect(
      releaseAutomationDryRunClaim("automation-1", leaseToken),
    ).resolves.toBe(true)
    expect(requestMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("releaseManagerAutomationRun"),
      { id: "automation-1", leaseToken },
    )
  })
  it("returns null on an atomic claim conflict", async () => {
    requestMock.mockResolvedValue({ claimManagerAutomationRun: null })
    await expect(claimAutomationDryRun("automation-1")).resolves.toBeNull()
  })
  it("fences failure reconciliation with the admitted lease", async () => {
    requestMock.mockResolvedValue({ failManagerAutomationRun: true })
    await expect(
      markAutomationRunFailedIfInFlight({
        runDocumentId: "run-1",
        error: "database timeout",
        finishedAt: "2026-04-12T09:04:00.000Z",
        leaseToken,
      }),
    ).resolves.toBe(true)
    expect(requestMock).toHaveBeenCalledWith(
      expect.stringContaining("failManagerAutomationRun"),
      { id: "run-1", leaseToken, error: "database timeout" },
    )
    await expect(
      markAutomationRunFailedIfInFlight({
        runDocumentId: "run-1",
        error: "timeout",
        finishedAt: "now",
      }),
    ).rejects.toThrow("lease token required")
  })
  it("sends only the strict Admin run-creation contract, leaving timestamps server-owned", async () => {
    requestMock.mockResolvedValue({ createManagerAutomationRun: run })
    await createAutomationRun({
      automationDocumentId: "automation-1",
      leaseToken,
      runMode: "dry_run",
      scheduledFor: "2026-04-12T09:00:00.000Z",
      startedAt: "2026-04-12T09:00:01.000Z",
    })
    expect(requestMock).toHaveBeenCalledWith(
      expect.stringContaining("createManagerAutomationRun"),
      {
        input: {
          automationDocumentId: "automation-1",
          leaseToken,
          runMode: "dry_run",
          scheduledFor: "2026-04-12T09:00:00.000Z",
        },
      },
    )
  })
})
