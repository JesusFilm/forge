import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  authenticateRequestMock,
  completeAutomationRunMock,
  createAutomationRunMock,
  enqueueAutomationRunMock,
  getAutomationMock,
} = vi.hoisted(() => ({
  authenticateRequestMock: vi.fn(),
  completeAutomationRunMock: vi.fn(),
  createAutomationRunMock: vi.fn(),
  enqueueAutomationRunMock: vi.fn(),
  getAutomationMock: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  authenticateRequest: authenticateRequestMock,
}))

vi.mock("@/features/agents/automation-runner", () => ({
  enqueueAutomationRun: enqueueAutomationRunMock,
}))

vi.mock("@/features/agents/automation-store", () => ({
  completeAutomationRun: completeAutomationRunMock,
  createAutomationRun: createAutomationRunMock,
  getAutomation: getAutomationMock,
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
    completeAutomationRunMock.mockReset()
    createAutomationRunMock.mockReset()
    enqueueAutomationRunMock.mockReset()
    getAutomationMock.mockReset()
    authenticateRequestMock.mockResolvedValue(null)
    getAutomationMock.mockResolvedValue(automation)
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
  })

  it("launches a manual dry-run without advancing the automation schedule", async () => {
    const response = await POST(buildRequest(), {
      params: Promise.resolve({ id: "automation-1" }),
    })

    expect(response.status).toBe(200)
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
    expect(createAutomationRunMock).not.toHaveBeenCalled()
    expect(enqueueAutomationRunMock).not.toHaveBeenCalled()
  })
})
