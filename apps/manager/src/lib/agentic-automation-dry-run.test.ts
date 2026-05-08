import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    AGENTIC_BASE_URL?: string
    AGENTIC_SERVICE_API_KEY?: string
    AGENTIC_STUDIO_ORIGIN?: string
    AGENTIC_OPERATOR_API_KEY?: string
    AGENTIC_REQUEST_TIMEOUT_MS?: number
  },
}))

const { env } = await import("@/config/env")
const { triggerAgenticAutomationDryRun } =
  await import("@/lib/agentic-automation-dry-run")

const envMutable = env as {
  AGENTIC_BASE_URL?: string
  AGENTIC_SERVICE_API_KEY?: string
  AGENTIC_STUDIO_ORIGIN?: string
  AGENTIC_OPERATOR_API_KEY?: string
  AGENTIC_REQUEST_TIMEOUT_MS?: number
}

const fetchSpy = vi.spyOn(globalThis, "fetch")

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("agentic-automation-dry-run", () => {
  beforeEach(() => {
    envMutable.AGENTIC_BASE_URL = "https://agentic.example"
    envMutable.AGENTIC_SERVICE_API_KEY = "service-key"
    envMutable.AGENTIC_STUDIO_ORIGIN =
      "http://agentic-studio.railway.internal:4111"
    envMutable.AGENTIC_OPERATOR_API_KEY = "operator-key"
    envMutable.AGENTIC_REQUEST_TIMEOUT_MS = 2500
    fetchSpy.mockReset()
  })

  afterEach(() => {
    envMutable.AGENTIC_BASE_URL = undefined
    envMutable.AGENTIC_SERVICE_API_KEY = undefined
    envMutable.AGENTIC_STUDIO_ORIGIN = undefined
    envMutable.AGENTIC_OPERATOR_API_KEY = undefined
    envMutable.AGENTIC_REQUEST_TIMEOUT_MS = undefined
  })

  it("posts the automation id to Agentic with service auth and unwraps the typed response", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        agenticRunId: "agentic-run-1",
        managerAutomationRunDocumentId: "manager-run-1",
        status: "success",
        summary: "Dry run completed.",
      }),
    )

    const result = await triggerAgenticAutomationDryRun({
      automationDocumentId: "automation-1",
      requestedBy: { kind: "manager_user", id: "user-1" },
      idempotencyKey: "manager:automation-1:dry-run",
    })

    expect(result).toEqual({
      ok: true,
      agenticRunId: "agentic-run-1",
      managerAutomationRunDocumentId: "manager-run-1",
      status: "success",
      summary: "Dry run completed.",
    })
    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("https://agentic.example/forge/manager-automation-dry-run")
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

  it("fails closed when Agentic env is not configured", async () => {
    envMutable.AGENTIC_BASE_URL = undefined

    const result = await triggerAgenticAutomationDryRun({
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

  it("sanitizes invalid Agentic JSON into a retryable parse error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "content-type": "text/html" },
      }),
    )

    const result = await triggerAgenticAutomationDryRun({
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
    expect(result.messages).toEqual(["Agentic returned invalid JSON"])
    expect(result.retryable).toBe(true)
  })

  it("returns contract_error when Agentic returns an unexpected shape", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true, data: {} }))

    const result = await triggerAgenticAutomationDryRun({
      automationDocumentId: "automation-1",
      requestedBy: { kind: "service", id: "manager" },
      idempotencyKey: "test",
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe("contract_error")
    expect(result.retryable).toBe(false)
    expect(result.messages[0]).toContain("Agentic dry-run response")
  })

  it("returns upstream_error with sanitized messages for non-ok Agentic responses", async () => {
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

    const result = await triggerAgenticAutomationDryRun({
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

    const result = await triggerAgenticAutomationDryRun({
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
