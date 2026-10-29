import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const { config } = vi.hoisted(() => ({
  config: {
    MASTRA_BASE_URL: "https://mastra.test",
    MASTRA_SERVICE_API_KEY: "mastra-service-key",
    MASTRA_AUTOMATION_DRY_RUN_TIMEOUT_MS: 70_000,
  },
}))
vi.mock("@/config/env", () => ({ env: config }))
import { triggerAgenticAutomationDryRun } from "./agentic-automation-dry-run"
const input = {
  automationDocumentId: "automation-1",
  requestedBy: { kind: "service" as const, id: "test" },
  idempotencyKey: "request-1",
}
const success = {
  ok: true,
  agenticRunId: "real-mastra-run",
  automationDocumentId: "automation-1",
  managerAutomationRunDocumentId: "manager-run",
  runMode: "dry_run",
  enqueuedCount: 0,
  status: "partial",
  summary: "Partial report",
  reportUrl: "/dashboard/agents?automationId=automation-1&runId=manager-run",
}
beforeEach(() => {
  config.MASTRA_BASE_URL = "https://mastra.test"
  config.MASTRA_SERVICE_API_KEY = "mastra-service-key"
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe("Manager to current Mastra dry-run launcher", () => {
  it("uses the current service path, retains partial and exposes its real workflow ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(success))
    vi.stubGlobal("fetch", fetcher)
    expect(await triggerAgenticAutomationDryRun(input)).toEqual(success)
    expect(String(fetcher.mock.calls[0][0])).toBe(
      "https://mastra.test/forge-manager-automation-dry-run",
    )
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: "error",
      signal: expect.any(AbortSignal),
      headers: { authorization: "Bearer mastra-service-key" },
    })
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual(input)
  })
  it.each([
    "",
    "http://mastra.test",
    "https://user:pass@mastra.test",
    "https://mastra.test?query",
    "https://mastra.test/path",
  ])("fails closed for missing/unsafe origin %s", async (url) => {
    config.MASTRA_BASE_URL = url
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    expect(await triggerAgenticAutomationDryRun(input)).toMatchObject({
      reason: "config_missing",
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("rejects live input before fetching", async () => {
    const fetcher = vi.fn()
    vi.stubGlobal("fetch", fetcher)
    expect(
      await triggerAgenticAutomationDryRun({
        ...input,
        ...{ runMode: "live" },
      }),
    ).toMatchObject({ reason: "invalid_input" })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    new Response("redirect", { status: 302 }),
    new Response("secret HTML", {
      status: 502,
      headers: { "content-type": "text/html" },
    }),
    Response.json(success, { status: 500 }),
    Response.json({ ...success, runMode: "live" }),
    Response.json({ ...success, enqueuedCount: 1 }),
    Response.json({ ...success, reportUrl: "https://evil.test" }),
    Response.json({ ...success, automationDocumentId: "another" }),
    Response.json({
      ok: false,
      code: "manager_unavailable",
      message: "secret details",
    }),
  ])("denies malformed or mismatched HTTP/JSON responses", async (response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response))
    const result = await triggerAgenticAutomationDryRun(input)
    expect(result).toMatchObject({ ok: false, reason: "contract_error" })
    expect(JSON.stringify(result)).not.toContain("secret")
  })
  it("returns safe upstream errors without raw diagnostics", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            ok: false,
            code: "run_in_progress",
            message: "secret database URL",
          },
          { status: 409 },
        ),
      ),
    )
    expect(await triggerAgenticAutomationDryRun(input)).toMatchObject({
      ok: false,
      reason: "upstream_error",
      code: "run_in_progress",
      httpStatus: 409,
      messages: ["Mastra automation dry run is unavailable."],
    })
  })
  it("cancels over-limit chunked responses", async () => {
    const cancel = vi.fn()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(16_385))
            },
            cancel,
          }),
          { headers: { "content-type": "application/json" } },
        ),
      ),
    )
    expect(await triggerAgenticAutomationDryRun(input)).toMatchObject({
      reason: "contract_error",
    })
    expect(cancel).toHaveBeenCalled()
  })
  it("redacts network failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("secret credentials")),
    )
    expect(await triggerAgenticAutomationDryRun(input)).toMatchObject({
      reason: "network_error",
      messages: ["Mastra automation dry run is unavailable."],
      retryable: true,
    })
  })
})
