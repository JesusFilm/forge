import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateServiceBearerRequestMock,
  claimAutomationDryRunMock,
  completeAutomationRunMock,
  createAutomationRunMock,
  enqueueAutomationRunMock,
  getAutomationMock,
  hasInFlightAutomationRunMock,
  releaseAutomationDryRunClaimMock,
} = vi.hoisted(() => ({
  authenticateServiceBearerRequestMock: vi.fn(),
  claimAutomationDryRunMock: vi.fn(),
  completeAutomationRunMock: vi.fn(),
  createAutomationRunMock: vi.fn(),
  enqueueAutomationRunMock: vi.fn(),
  getAutomationMock: vi.fn(),
  hasInFlightAutomationRunMock: vi.fn(),
  releaseAutomationDryRunClaimMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateServiceBearerRequest: authenticateServiceBearerRequestMock,
}))

vi.mock("@/features/agents/automation-runner", () => ({
  enqueueAutomationRun: enqueueAutomationRunMock,
}))

vi.mock("@/features/agents/automation-store", () => ({
  claimAutomationDryRun: claimAutomationDryRunMock,
  completeAutomationRun: completeAutomationRunMock,
  createAutomationRun: createAutomationRunMock,
  getAutomation: getAutomationMock,
  hasInFlightAutomationRun: hasInFlightAutomationRunMock,
  releaseAutomationDryRunClaim: releaseAutomationDryRunClaimMock,
}))

import { POST } from "./route"

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

function buildRequest(input: unknown = {}) {
  return new Request(
    "http://example.test/api/automations/automation-1/mastra-dry-run",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-manager-mastra-api-key",
      },
      body: JSON.stringify(input),
    },
  )
}

describe("POST /api/automations/[id]/mastra-dry-run", () => {
  beforeEach(() => {
    authenticateServiceBearerRequestMock.mockReset()
    claimAutomationDryRunMock.mockReset()
    completeAutomationRunMock.mockReset()
    createAutomationRunMock.mockReset()
    enqueueAutomationRunMock.mockReset()
    getAutomationMock.mockReset()
    hasInFlightAutomationRunMock.mockReset()
    releaseAutomationDryRunClaimMock.mockReset()
    authenticateServiceBearerRequestMock.mockReturnValue(null)
    getAutomationMock.mockResolvedValue(automation)
    hasInFlightAutomationRunMock.mockResolvedValue(false)
    claimAutomationDryRunMock.mockResolvedValue({
      documentId: "automation-1",
      leaseToken: "lease-1",
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
        data: {
          runMode: "dry_run",
          enqueuedCount: 0,
          wouldEnqueueCount: 1,
        },
      },
    })
    completeAutomationRunMock.mockResolvedValue({
      documentId: "run-1",
      status: "success",
      report: {
        kind: "metadata",
        data: {
          runMode: "dry_run",
          enqueuedCount: 0,
          wouldEnqueueCount: 1,
        },
      },
    })
    releaseAutomationDryRunClaimMock.mockResolvedValue(true)
  })

  it("rejects attempts to request live mode", async () => {
    const response = await POST(buildRequest({ runMode: "live" }), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(400)
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "invalid_automation",
    })
  })

  it("forces dry-run mode and returns a typed result", async () => {
    const response = await POST(
      buildRequest({
        requestedBy: { kind: "service", id: "mastra" },
        idempotencyKey: "mastra-run-1",
      }),
      {
        params: Promise.resolve({ id: "automation-1" }),
      },
    )

    expect(response.status).toBe(200)
    expect(createAutomationRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        automationDocumentId: "automation-1",
        runMode: "dry_run",
      }),
    )
    expect(enqueueAutomationRunMock).toHaveBeenCalledWith({
      runDocumentId: "run-1",
      runMode: "dry_run",
      automation,
    })
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      automationDocumentId: "automation-1",
      managerAutomationRunDocumentId: "run-1",
      status: "success",
      report: {
        data: {
          runMode: "dry_run",
          enqueuedCount: 0,
          wouldEnqueueCount: 1,
        },
      },
    })
  })

  it("rejects non-creatable templates before enqueue", async () => {
    getAutomationMock.mockResolvedValue({
      ...automation,
      template: "scene_embeddings_missing",
    })

    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(400)
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: "invalid_automation",
    })
  })
})
