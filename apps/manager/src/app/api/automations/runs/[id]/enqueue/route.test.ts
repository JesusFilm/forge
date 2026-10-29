import { beforeEach, describe, expect, it, vi } from "vitest"
const { enqueue, getAutomation, getRun, beginDispatch } = vi.hoisted(() => ({
  enqueue: vi.fn(),
  getAutomation: vi.fn(),
  getRun: vi.fn(),
  beginDispatch: vi.fn(),
}))
vi.mock("@/features/agents/automation-runner", () => ({
  enqueueAutomationRun: enqueue,
}))
vi.mock("@/features/agents/automation-store", () => ({
  getAutomation,
  getAutomationRun: getRun,
  getAdminAutomationAdapter: async () => ({ beginDispatch }),
}))
import { POST } from "./route"
const leaseToken = "c013fb84-8d68-46c0-9b67-7fab8b96c008"
const automation = {
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
  leaseToken,
  runs: [],
}
const body = { automation, leaseToken }
const context = { params: Promise.resolve({ id: "run-1" }) }
function request(input: unknown = body, auth = "Bearer test-manager-api-key") {
  return new Request("http://example.test/api/automations/runs/run-1/enqueue", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: auth },
    body: JSON.stringify(input),
  })
}
describe("service automation dispatch admission", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getAutomation.mockResolvedValue(automation)
    getRun.mockResolvedValue({
      documentId: "run-1",
      automationDocumentId: "automation-1",
      status: "running",
      runMode: "live",
    })
    beginDispatch.mockResolvedValue(true)
    enqueue.mockResolvedValue({ status: "no_op", enqueuedCount: 0 })
  })
  it("rejects cookie-only callers", async () => {
    expect((await POST(request(body, ""), context)).status).toBe(403)
    expect(getRun).not.toHaveBeenCalled()
  })
  it("dispatches the canonical admitted definition", async () => {
    expect((await POST(request(), context)).status).toBe(200)
    expect(beginDispatch).toHaveBeenCalledWith("run-1", leaseToken)
    expect(enqueue).toHaveBeenCalledWith({
      runDocumentId: "run-1",
      runMode: "live",
      automation,
    })
  })
  it("uses persisted dry-run mode despite a live request body", async () => {
    getRun.mockResolvedValue({
      documentId: "run-1",
      automationDocumentId: "automation-1",
      status: "running",
      runMode: "dry_run",
    })
    expect((await POST(request(), context)).status).toBe(200)
    expect(enqueue).toHaveBeenCalledWith({
      runDocumentId: "run-1",
      runMode: "dry_run",
      automation,
    })
  })
  it.each([
    { ...body, runMode: "dry_run" },
    { automation },
    {
      ...body,
      automation: {
        ...automation,
        template: "target_subtitles_missing",
        targetLanguageIds: ["a", "b"],
      },
    },
  ])("rejects malformed or conflicting payloads", async (input) => {
    expect((await POST(request(input), context)).status).toBe(400)
    expect(enqueue).not.toHaveBeenCalled()
  })
  it("rejects foreign runs before consuming dispatch", async () => {
    getRun.mockResolvedValue({
      automationDocumentId: "foreign",
      status: "running",
    })
    expect((await POST(request(), context)).status).toBe(409)
    expect(beginDispatch).not.toHaveBeenCalled()
  })
  it("rejects stale leases and duplicate dispatch", async () => {
    beginDispatch.mockResolvedValue(false)
    expect((await POST(request(), context)).status).toBe(409)
    expect(enqueue).not.toHaveBeenCalled()
  })
  it("returns JSON when canonical storage fails", async () => {
    getRun.mockRejectedValue(new Error("storage offline"))
    const response = await POST(request(), context)
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: "Automation dispatch failed",
    })
    expect(enqueue).not.toHaveBeenCalled()
  })
})
