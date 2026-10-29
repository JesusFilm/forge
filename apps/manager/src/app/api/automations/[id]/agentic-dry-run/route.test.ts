import { beforeEach, describe, expect, it, vi } from "vitest"
import type {
  EnrichmentAutomation,
  EnrichmentAutomationRun,
} from "@/features/agents/automation-contract"

const store = vi.hoisted(() => ({
  beginAutomationRunDispatch: vi.fn(),
  claimAutomationDryRun: vi.fn(),
  completeAutomationRun: vi.fn(),
  createAutomationRun: vi.fn(),
  getAutomation: vi.fn(),
  getAutomationRun: vi.fn(),
  getAutomationRunByIdempotencyKey: vi.fn(),
  hasInFlightAutomationRun: vi.fn(),
  markAutomationRunFailedIfInFlight: vi.fn(),
  releaseAutomationDryRunClaim: vi.fn(),
}))
const { enqueue } = vi.hoisted(() => ({ enqueue: vi.fn() }))
vi.mock("@/features/agents/automation-store", () => store)
vi.mock("@/features/agents/automation-runner", () => ({
  enqueueAutomationRun: enqueue,
}))
vi.mock("@/config/env", () => ({
  env: {
    MANAGER_AGENTIC_API_KEY: "dry-run-key",
    MANAGER_API_KEY: "operator-key",
  },
}))
import { POST } from "./route"
import {
  authenticateRequest,
  authenticateServiceBearerRequest,
} from "@/lib/auth"

const automation: EnrichmentAutomation = {
  documentId: "automation-1",
  name: "Source subtitles",
  template: "source_subtitles_missing",
  status: "active",
  runMode: "live",
  schedule: { kind: "every_minute", timezone: "UTC" },
  timezone: "UTC",
  nextRunAt: "2026-10-29T00:00:00.000Z",
  refreshMode: "missing_only",
  targetLanguageIds: [],
  maxVideosPerRun: 6,
  runs: [],
}
const run: EnrichmentAutomationRun = {
  documentId: "run-1",
  automationDocumentId: "automation-1",
  idempotencyKey: "request-1",
  status: "running",
  runMode: "dry_run",
  scheduledFor: "2026-10-28T00:00:00.000Z",
  eligibleCount: 0,
  enqueuedCount: 0,
  skippedDuplicateCount: 0,
  errorCount: 0,
  jobDocumentIds: [],
  errors: [],
}
function request(
  body: unknown = {
    idempotencyKey: "request-1",
    requestedBy: { kind: "service", id: "diagnostic-only" },
  },
  key = "dry-run-key",
  extraHeaders = {},
) {
  return new Request(
    "https://manager.test/api/automations/automation-1/agentic-dry-run",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    },
  )
}
const invoke = (r = request()) =>
  POST(r, { params: Promise.resolve({ id: "automation-1" }) })

describe("service-only automation dry runs", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    store.getAutomation.mockResolvedValue(automation)
    store.getAutomationRunByIdempotencyKey.mockResolvedValue(null)
    store.claimAutomationDryRun.mockResolvedValue({
      documentId: "automation-1",
      leaseToken: "owned-lease",
    })
    store.createAutomationRun.mockResolvedValue(run)
    store.beginAutomationRunDispatch.mockResolvedValue(true)
    enqueue.mockResolvedValue({
      status: "partial",
      eligibleCount: 3,
      enqueuedCount: 0,
      skippedDuplicateCount: 0,
      errorCount: 1,
      errors: [],
      jobDocumentIds: [],
      summary: "Partial report.",
    })
    store.completeAutomationRun.mockResolvedValue({
      ...run,
      status: "partial",
      summary: "Partial report.",
    })
  })

  it.each(["operator-key", "wrong-key", ""])(
    "rejects non-dedicated bearer %s regardless of claimed actor",
    async (key) => {
      const response = await invoke(
        request(undefined, key, { cookie: "manager-session=pretend-operator" }),
      )
      expect(response.status).toBe(401)
      expect(store.getAutomation).not.toHaveBeenCalled()
    },
  )
  it("does not admit the dedicated key to general or scheduled Manager APIs", async () => {
    expect(await authenticateRequest(request())).toHaveProperty("status", 401)
    expect(authenticateServiceBearerRequest(request())).toHaveProperty(
      "status",
      403,
    )
  })
  it.each(["live", "dry_run"])(
    "rejects explicit runMode %s before reads or admission",
    async (runMode) => {
      expect(
        (await invoke(request({ idempotencyKey: "request-1", runMode })))
          .status,
      ).toBe(400)
      expect(store.claimAutomationDryRun).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
    },
  )
  it("forces dry_run on a live definition, preserves partial, and fences settlement", async () => {
    const response = await invoke()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      automationDocumentId: "automation-1",
      managerAutomationRunDocumentId: "run-1",
      runMode: "dry_run",
      enqueuedCount: 0,
      status: "partial",
      summary: "Partial report.",
      reportUrl: "/dashboard/agents?automationId=automation-1&runId=run-1",
    })
    expect(store.createAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "request-1",
        leaseToken: "owned-lease",
        runMode: "dry_run",
      }),
    )
    expect(store.beginAutomationRunDispatch).toHaveBeenCalledWith(
      "run-1",
      "owned-lease",
    )
    expect(enqueue).toHaveBeenCalledWith({
      automation,
      runMode: "dry_run",
      runDocumentId: "run-1",
    })
    expect(store.completeAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({ leaseToken: "owned-lease" }),
    )
    expect(store.releaseAutomationDryRunClaim).toHaveBeenCalledWith(
      "automation-1",
      "owned-lease",
    )
    expect(automation.nextRunAt).toBe("2026-10-29T00:00:00.000Z")
  })
  it.each(["success", "partial", "failed", "no_op"] as const)(
    "replays persisted terminal %s without claiming or executing",
    async (status) => {
      store.getAutomationRunByIdempotencyKey.mockResolvedValue({
        ...run,
        status,
      })
      const response = await invoke()
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ status })
      expect(store.claimAutomationDryRun).not.toHaveBeenCalled()
      expect(enqueue).not.toHaveBeenCalled()
      expect(store.releaseAutomationDryRunClaim).not.toHaveBeenCalled()
    },
  )
  it("lets the atomic claim recover an expired run without the scheduler", async () => {
    store.getAutomation.mockResolvedValue({
      ...automation,
      leaseToken: "expired-lease",
      leaseExpiresAt: "2020-01-01T00:00:00.000Z",
    })
    store.hasInFlightAutomationRun.mockResolvedValue(true)
    expect((await invoke()).status).toBe(200)
    expect(store.hasInFlightAutomationRun).not.toHaveBeenCalled()
    expect(store.claimAutomationDryRun).toHaveBeenCalledWith("automation-1")
    expect(enqueue).toHaveBeenCalledTimes(1)
  })
  it.each(["claimed", "running"] as const)(
    "returns 409 for in-flight %s and leaves its lease alone",
    async (status) => {
      store.getAutomation.mockResolvedValue({
        ...automation,
        leaseToken: "live-lease",
        leaseExpiresAt: "2999-01-01T00:00:00.000Z",
      })
      store.getAutomationRunByIdempotencyKey.mockResolvedValue({
        ...run,
        status,
      })
      expect((await invoke()).status).toBe(409)
      expect(enqueue).not.toHaveBeenCalled()
      expect(store.releaseAutomationDryRunClaim).not.toHaveBeenCalled()
    },
  )
  it("recovers and replays an interrupted request's own idempotency key", async () => {
    store.getAutomation.mockResolvedValue({
      ...automation,
      leaseToken: "expired-lease",
      leaseExpiresAt: "2020-01-01T00:00:00.000Z",
    })
    store.getAutomationRunByIdempotencyKey
      .mockResolvedValueOnce(run)
      .mockResolvedValueOnce({ ...run, status: "failed" })
    const response = await invoke()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: "failed" })
    expect(store.claimAutomationDryRun).toHaveBeenCalledTimes(1)
    expect(store.createAutomationRun).not.toHaveBeenCalled()
    expect(store.beginAutomationRunDispatch).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })
  it("does not replay a live key as a dry report", async () => {
    store.getAutomationRunByIdempotencyKey.mockResolvedValue({
      ...run,
      status: "success",
      runMode: "live",
    })
    expect((await invoke()).status).toBe(409)
    expect(enqueue).not.toHaveBeenCalled()
  })
  it("handles completion between lookup and claim without executing again", async () => {
    store.getAutomationRunByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ ...run, status: "success" })
    expect((await invoke()).status).toBe(200)
    expect(store.createAutomationRun).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
    expect(store.releaseAutomationDryRunClaim).toHaveBeenCalledWith(
      "automation-1",
      "owned-lease",
    )
  })
  it("never executes or settles an existing run returned before Admin's lease check", async () => {
    store.createAutomationRun.mockResolvedValue({
      ...run,
      documentId: "another-admitted-run",
    })
    store.beginAutomationRunDispatch.mockResolvedValue(false)
    expect((await invoke()).status).toBe(409)
    expect(enqueue).not.toHaveBeenCalled()
    expect(store.completeAutomationRun).not.toHaveBeenCalled()
    expect(store.markAutomationRunFailedIfInFlight).not.toHaveBeenCalled()
    expect(store.releaseAutomationDryRunClaim).toHaveBeenCalledWith(
      "automation-1",
      "owned-lease",
    )
  })
  it("replays a terminal createRun race without consuming dispatch", async () => {
    store.createAutomationRun.mockResolvedValue({ ...run, status: "partial" })
    expect((await invoke()).status).toBe(200)
    expect(store.beginAutomationRunDispatch).not.toHaveBeenCalled()
    expect(enqueue).not.toHaveBeenCalled()
  })
  it("persists runner failure with safe diagnostics and the owned lease", async () => {
    enqueue.mockRejectedValue(new Error("secret provider credential"))
    store.completeAutomationRun.mockImplementation(async ({ result }) => ({
      ...run,
      ...result,
    }))
    const response = await invoke()
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain("secret")
    expect(store.completeAutomationRun).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseToken: "owned-lease",
        result: expect.objectContaining({ status: "failed", enqueuedCount: 0 }),
      }),
    )
  })
  it("fences failure reconciliation and returns safe transport failure", async () => {
    store.completeAutomationRun.mockRejectedValue(
      new Error("secret database URL"),
    )
    store.getAutomationRun.mockResolvedValue(run)
    const response = await invoke()
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain("secret")
    expect(store.markAutomationRunFailedIfInFlight).toHaveBeenCalledWith(
      expect.objectContaining({
        leaseToken: "owned-lease",
        error: "Automation dry run persistence failed.",
      }),
    )
  })
  it("denies mismatched body/header identities", async () => {
    expect(
      (
        await invoke(
          request(undefined, "dry-run-key", { "idempotency-key": "other" }),
        )
      ).status,
    ).toBe(400)
    expect(store.getAutomation).not.toHaveBeenCalled()
  })
  it("bounds chunked bodies and cancels oversized streams", async () => {
    const cancel = vi.fn()
    const response = await invoke(
      new Request("https://manager.test", {
        method: "POST",
        headers: {
          authorization: "Bearer dry-run-key",
          "content-type": "application/json",
        },
        body: new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(8_193))
          },
          cancel,
        }),
        duplex: "half",
      } as RequestInit),
    )
    expect(response.status).toBe(400)
    expect(cancel).toHaveBeenCalled()
    expect(store.getAutomation).not.toHaveBeenCalled()
  })
})
