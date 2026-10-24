import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  claimAutomationDryRunMock,
  completeAutomationRunMock,
  createAutomationRunMock,
  enqueueAutomationRunMock,
  getAutomationMock,
  getAutomationRunMock,
  hasInFlightAutomationRunMock,
  markAutomationRunFailedIfInFlightMock,
  releaseAutomationDryRunClaimMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  claimAutomationDryRunMock: vi.fn(),
  completeAutomationRunMock: vi.fn(),
  createAutomationRunMock: vi.fn(),
  enqueueAutomationRunMock: vi.fn(),
  getAutomationMock: vi.fn(),
  getAutomationRunMock: vi.fn(),
  hasInFlightAutomationRunMock: vi.fn(),
  markAutomationRunFailedIfInFlightMock: vi.fn(),
  releaseAutomationDryRunClaimMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/features/agents/automation-runner", () => ({
  enqueueAutomationRun: enqueueAutomationRunMock,
}))

vi.mock("@/features/agents/automation-store", () => ({
  claimAutomationDryRun: claimAutomationDryRunMock,
  completeAutomationRun: completeAutomationRunMock,
  createAutomationRun: createAutomationRunMock,
  getAutomation: getAutomationMock,
  getAutomationRun: getAutomationRunMock,
  hasInFlightAutomationRun: hasInFlightAutomationRunMock,
  markAutomationRunFailedIfInFlight: markAutomationRunFailedIfInFlightMock,
  releaseAutomationDryRunClaim: releaseAutomationDryRunClaimMock,
}))

import { POST } from "@/app/api/automations/[id]/dry-run/route"

const automation = {
  documentId: "automation-1",
  name: "Missing metadata",
  template: "metadata_missing",
  status: "active",
  runMode: "live",
  schedule: { kind: "every_minute", timezone: "UTC" },
  scheduleSummary: "Every minute",
  timezone: "UTC",
  nextRunAt: "2026-04-12T09:00:00.000Z",
  refreshMode: "missing_only",
  targetLanguageIds: [],
  maxVideosPerRun: 1,
  runs: [],
}

function buildRequest() {
  return new Request(
    "http://example.test/api/automations/automation-1/dry-run",
    {
      method: "POST",
    },
  )
}

describe("POST /api/automations/[id]/dry-run", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset()
    claimAutomationDryRunMock.mockReset()
    completeAutomationRunMock.mockReset()
    createAutomationRunMock.mockReset()
    enqueueAutomationRunMock.mockReset()
    getAutomationMock.mockReset()
    getAutomationRunMock.mockReset()
    hasInFlightAutomationRunMock.mockReset()
    markAutomationRunFailedIfInFlightMock.mockReset()
    releaseAutomationDryRunClaimMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
    getAutomationMock.mockResolvedValue(automation)
    hasInFlightAutomationRunMock.mockResolvedValue(false)
    claimAutomationDryRunMock.mockResolvedValue({
      documentId: "automation-1",
      leaseToken: "lease-1",
      leaseExpiresAt: "2026-04-12T09:10:00.000Z",
    })
    createAutomationRunMock.mockResolvedValue({
      documentId: "run-1",
      status: "running",
    })
    enqueueAutomationRunMock.mockResolvedValue({
      status: "success",
      eligibleCount: 1,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      jobDocumentIds: [],
      errors: [],
      summary: "Dry run would enqueue 1 video.",
      dryRunReport: {
        kind: "metadata",
        data: { runMode: "dry_run", wouldEnqueueCount: 1 },
      },
    })
    completeAutomationRunMock.mockResolvedValue({
      documentId: "run-1",
      status: "success",
    })
    getAutomationRunMock.mockResolvedValue(null)
    markAutomationRunFailedIfInFlightMock.mockResolvedValue(true)
    releaseAutomationDryRunClaimMock.mockResolvedValue(true)
  })

  it("launches a manual dry-run without advancing the automation schedule", async () => {
    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(200)
    expect(claimAutomationDryRunMock).toHaveBeenCalledWith("automation-1")
    expect(createAutomationRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        automationDocumentId: "automation-1",
        runMode: "dry_run",
        scheduledFor: expect.any(String),
        startedAt: expect.any(String),
      }),
    )
    expect(enqueueAutomationRunMock).toHaveBeenCalledWith({
      runDocumentId: "run-1",
      runMode: "dry_run",
      automation,
    })
    expect(completeAutomationRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runDocumentId: "run-1",
        result: expect.objectContaining({
          enqueuedCount: 0,
          dryRunReport: expect.any(Object),
        }),
      }),
    )
    expect(claimAutomationDryRunMock.mock.invocationCallOrder[0]).toBeLessThan(
      createAutomationRunMock.mock.invocationCallOrder[0],
    )
    expect(releaseAutomationDryRunClaimMock).toHaveBeenCalledWith(
      "automation-1",
      "lease-1",
    )
    await expect(response.json()).resolves.toMatchObject({
      run: { documentId: "run-1" },
    })
  })

  it("blocks manual dry-run while an automation has an active lease", async () => {
    getAutomationMock.mockResolvedValue({
      ...automation,
      leaseToken: "lease-1",
      leaseExpiresAt: "2999-01-01T00:00:00.000Z",
    })

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(409)
    expect(claimAutomationDryRunMock).not.toHaveBeenCalled()
    expect(createAutomationRunMock).not.toHaveBeenCalled()
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
    expect(releaseAutomationDryRunClaimMock).not.toHaveBeenCalled()
  })

  it("blocks manual dry-run when a broader in-flight run query finds running work", async () => {
    hasInFlightAutomationRunMock.mockResolvedValue(true)
    getAutomationMock.mockResolvedValue({
      ...automation,
      runs: Array.from({ length: 5 }, (_value, index) => ({
        documentId: `recent-run-${index}`,
        status: "success",
        runMode: "dry_run",
        scheduledFor: "2026-04-12T09:00:00.000Z",
        eligibleCount: 0,
        enqueuedCount: 0,
        skippedDuplicateCount: 0,
        errorCount: 0,
        jobDocumentIds: [],
        errors: [],
      })),
    })

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(409)
    expect(hasInFlightAutomationRunMock).toHaveBeenCalledWith("automation-1")
    expect(claimAutomationDryRunMock).not.toHaveBeenCalled()
    expect(createAutomationRunMock).not.toHaveBeenCalled()
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
    expect(releaseAutomationDryRunClaimMock).not.toHaveBeenCalled()
  })

  it("blocks manual dry-run when the CMS atomic claim reports a conflict", async () => {
    claimAutomationDryRunMock.mockResolvedValue(null)

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(409)
    expect(createAutomationRunMock).not.toHaveBeenCalled()
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
    expect(releaseAutomationDryRunClaimMock).not.toHaveBeenCalled()
  })

  it("best-effort marks the run failed when completion persistence throws", async () => {
    completeAutomationRunMock
      .mockRejectedValueOnce(new Error("database timeout"))
      .mockResolvedValueOnce({
        documentId: "run-1",
        status: "failed",
      })
    getAutomationRunMock.mockResolvedValue({
      documentId: "run-1",
      status: "running",
    })

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(502)
    expect(completeAutomationRunMock).toHaveBeenCalledTimes(1)
    expect(markAutomationRunFailedIfInFlightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runDocumentId: "run-1",
        error: "database timeout",
        finishedAt: expect.any(String),
      }),
    )
    expect(releaseAutomationDryRunClaimMock).toHaveBeenCalledWith(
      "automation-1",
      "lease-1",
    )
  })

  it("does not overwrite a successfully persisted dry-run when the completion response throws", async () => {
    completeAutomationRunMock.mockRejectedValueOnce(
      new Error("response stream closed"),
    )
    getAutomationRunMock.mockResolvedValue({
      documentId: "run-1",
      status: "success",
      runMode: "dry_run",
      scheduledFor: "2026-04-12T09:00:00.000Z",
      startedAt: "2026-04-12T09:00:00.000Z",
      finishedAt: "2026-04-12T09:00:05.000Z",
      eligibleCount: 1,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 0,
      jobDocumentIds: [],
      errors: [],
      summary: "Dry run would enqueue 1 video.",
    })

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(200)
    expect(completeAutomationRunMock).toHaveBeenCalledTimes(1)
    expect(markAutomationRunFailedIfInFlightMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      run: { documentId: "run-1", status: "success" },
    })
    expect(releaseAutomationDryRunClaimMock).toHaveBeenCalledWith(
      "automation-1",
      "lease-1",
    )
  })

  it("re-reads the run when the conditional failed fallback finds a terminal run", async () => {
    completeAutomationRunMock.mockRejectedValueOnce(
      new Error("response stream closed"),
    )
    getAutomationRunMock
      .mockResolvedValueOnce({
        documentId: "run-1",
        status: "running",
      })
      .mockResolvedValueOnce({
        documentId: "run-1",
        status: "success",
        runMode: "dry_run",
        scheduledFor: "2026-04-12T09:00:00.000Z",
        startedAt: "2026-04-12T09:00:00.000Z",
        finishedAt: "2026-04-12T09:00:05.000Z",
        eligibleCount: 1,
        enqueuedCount: 0,
        skippedDuplicateCount: 0,
        errorCount: 0,
        jobDocumentIds: [],
        errors: [],
        summary: "Dry run would enqueue 1 video.",
      })
    markAutomationRunFailedIfInFlightMock.mockResolvedValue(false)

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(200)
    expect(markAutomationRunFailedIfInFlightMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runDocumentId: "run-1",
        error: "response stream closed",
      }),
    )
    await expect(response.json()).resolves.toMatchObject({
      run: { documentId: "run-1", status: "success" },
    })
  })
})
