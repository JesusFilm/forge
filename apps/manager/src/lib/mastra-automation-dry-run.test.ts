import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    MASTRA_BASE_URL?: string
    MASTRA_SERVICE_API_KEY?: string
    MASTRA_REQUEST_TIMEOUT_MS?: number
  },
}))

const { env } = await import("@/config/env")
const { triggerMastraAutomationDryRun } =
  await import("@/lib/mastra-automation-dry-run")

const envMutable = env as {
  MASTRA_BASE_URL?: string
  MASTRA_SERVICE_API_KEY?: string
  MASTRA_REQUEST_TIMEOUT_MS?: number
}

const fetchSpy = vi.spyOn(globalThis, "fetch")

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("mastra-automation-dry-run", () => {
  beforeEach(() => {
    envMutable.MASTRA_BASE_URL = "https://mastra.example"
    envMutable.MASTRA_SERVICE_API_KEY = "service-key"
    envMutable.MASTRA_REQUEST_TIMEOUT_MS = 2500
    fetchSpy.mockReset()
  })

  afterEach(() => {
    envMutable.MASTRA_BASE_URL = undefined
    envMutable.MASTRA_SERVICE_API_KEY = undefined
    envMutable.MASTRA_REQUEST_TIMEOUT_MS = undefined
  })

  it("posts the automation id to Mastra with service auth and unwraps the typed response", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        mastraRunId: "mastra-run-1",
        managerAutomationRunDocumentId: "manager-run-1",
        status: "success",
        summary: "Dry run completed.",
      }),
    )

    const result = await triggerMastraAutomationDryRun({
      automationDocumentId: "automation-1",
      requestedBy: { kind: "manager_user", id: "user-1" },
      idempotencyKey: "manager:automation-1:dry-run",
    })

    expect(result).toEqual({
      ok: true,
      mastraRunId: "mastra-run-1",
      managerAutomationRunDocumentId: "manager-run-1",
      status: "success",
      summary: "Dry run completed.",
    })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://mastra.example/forge/manager-automation-dry-run")
    expect(init?.method).toBe("POST")
    expect(init?.headers).toMatchObject({
      authorization: "Bearer service-key",
      "content-type": "application/json",
    })
    expect(JSON.parse(init?.body as string)).toEqual({
      automationDocumentId: "automation-1",
      requestedBy: { kind: "manager_user", id: "user-1" },
      idempotencyKey: "manager:automation-1:dry-run",
    })
  })

  it("fails closed when Mastra env is not configured", async () => {
    envMutable.MASTRA_BASE_URL = undefined

    const result = await triggerMastraAutomationDryRun({
      automationDocumentId: "automation-1",
      requestedBy: { kind: "service", id: "manager" },
      idempotencyKey: "test",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("config_missing")
    expect(result.retryable).toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("sanitizes invalid Mastra JSON into a retryable parse error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    )

    const result = await triggerMastraAutomationDryRun({
      automationDocumentId: "automation-1",
      requestedBy: { kind: "service", id: "manager" },
      idempotencyKey: "test",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    if (result.reason !== "parse_error") {
      throw new Error(`expected parse_error, got ${result.reason}`)
    }
    expect(result.httpStatus).toBe(502)
    expect(result.messages).toEqual(["Mastra returned invalid JSON"])
    expect(result.retryable).toBe(true)
  })

  it("returns contract_error when Mastra returns an unexpected shape", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true, data: {} }))

    const result = await triggerMastraAutomationDryRun({
      automationDocumentId: "automation-1",
      requestedBy: { kind: "service", id: "manager" },
      idempotencyKey: "test",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("contract_error")
    expect(result.retryable).toBe(false)
    expect(result.messages[0]).toContain("Mastra dry-run response")
  })

  it("returns upstream_error with sanitized messages for non-ok Mastra responses", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          ok: false,
          code: "manager_rejected",
          message: "Dry run rejected",
          details: { secret: "do-not-leak" },
        },
        422,
      ),
    )

    const result = await triggerMastraAutomationDryRun({
      automationDocumentId: "automation-1",
      requestedBy: { kind: "service", id: "manager" },
      idempotencyKey: "test",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result).toEqual({
      ok: false,
      reason: "upstream_error",
      code: "manager_rejected",
      messages: ["Dry run rejected"],
      httpStatus: 422,
      retryable: false,
    })
  })

  it("marks network failures as retryable without leaking request internals", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1"))

    const result = await triggerMastraAutomationDryRun({
      automationDocumentId: "automation-1",
      requestedBy: { kind: "service", id: "manager" },
      idempotencyKey: "test",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("network_error")
    expect(result.messages).toEqual(["connect ECONNREFUSED 127.0.0.1"])
    expect(result.retryable).toBe(true)
  })
})
