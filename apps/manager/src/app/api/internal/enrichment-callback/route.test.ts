import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  applyEnrichmentCallbackMock,
  assertBearerCsvsDisjointMock,
  validateEnrichmentCallbackBearerMock,
  envMock,
} = vi.hoisted(() => ({
  applyEnrichmentCallbackMock: vi.fn(),
  assertBearerCsvsDisjointMock: vi.fn(),
  validateEnrichmentCallbackBearerMock: vi.fn(),
  envMock: {
    ADMIN_TRIGGER_API_KEYS: "admin-key",
    ENRICHMENT_CALLBACK_API_KEYS: "callback-key",
  },
}))

vi.mock("@/config/env", () => ({
  env: envMock,
}))

vi.mock("@/lib/admin-trigger-auth", () => ({
  assertBearerCsvsDisjoint: assertBearerCsvsDisjointMock,
  validateEnrichmentCallbackBearer: validateEnrichmentCallbackBearerMock,
}))

vi.mock("@/lib/enrichment-callback", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/enrichment-callback")
  >("@/lib/enrichment-callback")
  return {
    EnrichmentCallbackSchema: actual.EnrichmentCallbackSchema,
    applyEnrichmentCallback: applyEnrichmentCallbackMock,
  }
})

import { POST } from "@/app/api/internal/enrichment-callback/route"

function callbackRequest(body: unknown = validCallback()) {
  return new Request("https://manager.test/api/internal/enrichment-callback", {
    method: "POST",
    headers: {
      authorization: "Bearer callback-key",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
}

function validCallback() {
  return {
    jobId: "job-1",
    engine: "mastra",
    runId: "run-1",
    sequence: 1,
    status: "running",
    step: "translation",
  }
}

describe("POST /api/internal/enrichment-callback", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    envMock.ADMIN_TRIGGER_API_KEYS = "admin-key"
    envMock.ENRICHMENT_CALLBACK_API_KEYS = "callback-key"
    validateEnrichmentCallbackBearerMock.mockReturnValue({ ok: true })
    assertBearerCsvsDisjointMock.mockReturnValue(true)
    applyEnrichmentCallbackMock.mockResolvedValue({
      ok: true,
      action: "applied",
    })
  })

  it("rejects missing or invalid callback bearer credentials", async () => {
    validateEnrichmentCallbackBearerMock.mockReturnValueOnce({
      ok: false,
      status: 401,
      message: "Invalid bearer token",
    })

    const response = await POST(callbackRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid bearer token",
    })
    expect(applyEnrichmentCallbackMock).not.toHaveBeenCalled()
  })

  it("fails closed when callback and admin-trigger key sets overlap", async () => {
    assertBearerCsvsDisjointMock.mockReturnValueOnce(false)

    const response = await POST(callbackRequest())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error:
        "config_invalid: ADMIN_TRIGGER_API_KEYS and ENRICHMENT_CALLBACK_API_KEYS must be disjoint",
    })
    expect(assertBearerCsvsDisjointMock).toHaveBeenCalledWith(
      "admin-key",
      "callback-key",
    )
    expect(applyEnrichmentCallbackMock).not.toHaveBeenCalled()
  })

  it("rejects invalid JSON bodies", async () => {
    const response = await POST(
      new Request("https://manager.test/api/internal/enrichment-callback", {
        method: "POST",
        headers: {
          authorization: "Bearer callback-key",
          "content-type": "application/json",
        },
        body: "{not-json",
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    })
    expect(applyEnrichmentCallbackMock).not.toHaveBeenCalled()
  })

  it("rejects oversized callback bodies before schema validation", async () => {
    const response = await POST(
      new Request("https://manager.test/api/internal/enrichment-callback", {
        method: "POST",
        headers: {
          authorization: "Bearer callback-key",
          "content-type": "application/json",
          "content-length": String(65 * 1024),
        },
        body: JSON.stringify(validCallback()),
      }),
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: "Callback body is too large",
    })
    expect(applyEnrichmentCallbackMock).not.toHaveBeenCalled()
  })

  it("rejects payloads that do not match the callback schema", async () => {
    const response = await POST(
      callbackRequest({
        ...validCallback(),
        step: "scene_analysis",
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "Validation failed",
    })
    expect(applyEnrichmentCallbackMock).not.toHaveBeenCalled()
  })

  it("returns retryable status when callback state update fails", async () => {
    applyEnrichmentCallbackMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: "Callback job update failed; retry later",
    })

    const response = await POST(callbackRequest())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Callback job update failed; retry later",
    })
  })

  it("applies a valid callback body", async () => {
    const body = validCallback()

    const response = await POST(callbackRequest(body))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      action: "applied",
    })
    expect(applyEnrichmentCallbackMock).toHaveBeenCalledWith(body)
  })
})
