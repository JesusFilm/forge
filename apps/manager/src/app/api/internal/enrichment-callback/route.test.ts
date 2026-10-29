import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
    ENRICHMENT_CALLBACK_TRUST_CF_CONNECTING_IP: "false",
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

let POST: typeof import("./route").POST
let callbackRateLimiter: typeof import("@/lib/enrichment-callback-rate-limit").callbackRateLimiter

function callbackRequest(
  body: unknown = validCallback(),
  headers: Record<string, string> = {},
) {
  return new Request("https://manager.test/api/internal/enrichment-callback", {
    method: "POST",
    headers: {
      authorization: "Bearer callback-key",
      "content-type": "application/json",
      ...headers,
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
  beforeEach(async () => {
    vi.resetModules()
    vi.spyOn(Date, "now").mockReturnValue(1_000_000)
    vi.clearAllMocks()
    envMock.ADMIN_TRIGGER_API_KEYS = "admin-key"
    envMock.ENRICHMENT_CALLBACK_API_KEYS = "callback-key"
    envMock.ENRICHMENT_CALLBACK_TRUST_CF_CONNECTING_IP = "false"
    validateEnrichmentCallbackBearerMock.mockReturnValue({ ok: true })
    assertBearerCsvsDisjointMock.mockReturnValue(true)
    applyEnrichmentCallbackMock.mockResolvedValue({
      ok: true,
      action: "applied",
    })
    ;({ POST } = await import("./route"))
    ;({ callbackRateLimiter } =
      await import("@/lib/enrichment-callback-rate-limit"))
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it("rate limits before bearer validation", async () => {
    const headers = { "x-forwarded-for": "203.0.113.10" }

    for (let index = 0; index < 120; index += 1) {
      const response = await POST(callbackRequest(validCallback(), headers))
      expect(response.status).toBe(200)
    }

    validateEnrichmentCallbackBearerMock.mockClear()
    const response = await POST(callbackRequest(validCallback(), headers))

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBeTruthy()
    await expect(response.json()).resolves.toEqual({
      error: "Callback rate limit exceeded",
    })
    expect(validateEnrichmentCallbackBearerMock).not.toHaveBeenCalled()
  })

  function denyBearer() {
    validateEnrichmentCallbackBearerMock.mockReturnValue({
      ok: false,
      status: 401,
      message: "Invalid bearer token",
    })
  }

  function invalidCaller(index: number) {
    return callbackRequest(validCallback(), {
      authorization: "Bearer dummy-invalid-key",
      "cf-connecting-ip": `2001:db8::${index.toString(16)}`,
    })
  }

  it("caps retained keys for distinct invalid-auth callers without evicting active limits", async () => {
    envMock.ENRICHMENT_CALLBACK_TRUST_CF_CONNECTING_IP = "true"
    denyBearer()
    for (let i = 0; i < 120; i += 1) {
      expect((await POST(invalidCaller(0))).status).toBe(401)
    }
    for (let i = 1; i < 1024; i += 1) {
      expect((await POST(invalidCaller(i))).status).toBe(401)
    }
    const authenticatedRequests =
      validateEnrichmentCallbackBearerMock.mock.calls.length
    for (let i = 1024; i < 2048; i += 1) {
      const response = await POST(invalidCaller(i))
      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("60")
      expect(callbackRateLimiter.retainedKeyCount).toBe(1024)
    }
    expect((await POST(invalidCaller(0))).status).toBe(429)
    expect(validateEnrichmentCallbackBearerMock).toHaveBeenCalledTimes(
      authenticatedRequests,
    )
    expect(applyEnrichmentCallbackMock).not.toHaveBeenCalled()
  })

  it("expires unused keys at the boundary across distinct invalid-auth windows", async () => {
    envMock.ENRICHMENT_CALLBACK_TRUST_CF_CONNECTING_IP = "true"
    denyBearer()
    for (let window = 0; window < 4; window += 1) {
      vi.mocked(Date.now).mockReturnValue(1_000_000 + window * 60_000)
      for (let i = 0; i < 1024; i += 1) {
        expect((await POST(invalidCaller(window * 1024 + i))).status).toBe(401)
        expect(callbackRateLimiter.retainedKeyCount).toBe(i + 1)
      }
      vi.mocked(Date.now).mockReturnValue(1_000_000 + (window + 1) * 60_000 - 1)
      const response = await POST(invalidCaller(10_000))
      expect(response.status).toBe(429)
      expect(response.headers.get("retry-after")).toBe("1")
    }
    vi.mocked(Date.now).mockReturnValue(1_000_000 + 4 * 60_000)
    expect((await POST(invalidCaller(10_000))).status).toBe(401)
    expect(callbackRateLimiter.retainedKeyCount).toBe(1)
    expect(applyEnrichmentCallbackMock).not.toHaveBeenCalled()
  })

  it("ignores all forwarded identities without an explicitly trusted Cloudflare ingress", async () => {
    denyBearer()
    for (let i = 0; i < 120; i += 1) {
      const request = callbackRequest(validCallback(), {
        "cf-connecting-ip": `2001:db8::${i.toString(16)}`,
        "x-forwarded-for": `192.0.2.${i}`,
        "x-real-ip": `192.0.2.${i}`,
      })
      expect((await POST(request)).status).toBe(401)
    }
    expect((await POST(invalidCaller(999))).status).toBe(429)
    expect(callbackRateLimiter.retainedKeyCount).toBe(1)
    expect(validateEnrichmentCallbackBearerMock).toHaveBeenCalledTimes(120)
  })

  it.each([
    ["missing", ""],
    ["non-address", "not-an-address"],
    ["port", "192.0.2.1:443"],
    ["chain", "192.0.2.1, 192.0.2.2"],
    ["zone", "fe80::1%eth0"],
    ["oversized", "x".repeat(10_000)],
  ])(
    "groups %s Cloudflare addresses in the fallback bucket",
    async (_label, address) => {
      envMock.ENRICHMENT_CALLBACK_TRUST_CF_CONNECTING_IP = "true"
      denyBearer()
      expect(
        (
          await POST(
            callbackRequest(validCallback(), {
              "cf-connecting-ip": address,
              "x-forwarded-for": "192.0.2.1",
              "x-real-ip": "192.0.2.2",
            }),
          )
        ).status,
      ).toBe(401)
      expect((await POST(callbackRequest())).status).toBe(401)
      expect(callbackRateLimiter.retainedKeyCount).toBe(1)
    },
  )

  it("canonicalizes equivalent IPv6 literals and accepts IPv4 partitions only when opted in", async () => {
    envMock.ENRICHMENT_CALLBACK_TRUST_CF_CONNECTING_IP = "true"
    denyBearer()
    for (const address of [
      "2001:db8::1",
      "2001:0db8:0:0:0:0:0:1",
      "2001:DB8::1",
      "192.0.2.1",
    ]) {
      expect(
        (
          await POST(
            callbackRequest(validCallback(), { "cf-connecting-ip": address }),
          )
        ).status,
      ).toBe(401)
    }
    expect(callbackRateLimiter.retainedKeyCount).toBe(2)
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
