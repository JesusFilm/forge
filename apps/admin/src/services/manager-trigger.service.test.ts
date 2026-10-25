import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/config/env", () => ({
  env: {} as {
    MANAGER_API_BASE_URL?: string
    MANAGER_TRIGGER_API_KEY?: string
  },
}))

const { env } = await import("@/config/env")
const { triggerManagerEnrichment } =
  await import("@/services/manager-trigger.service")

const envMutable = env as {
  MANAGER_API_BASE_URL?: string
  MANAGER_TRIGGER_API_KEY?: string
}

const fetchSpy = vi.spyOn(globalThis, "fetch")

beforeEach(() => {
  envMutable.MANAGER_API_BASE_URL = "http://manager.test"
  envMutable.MANAGER_TRIGGER_API_KEY = "test-key"
  fetchSpy.mockReset()
})

afterEach(() => {
  envMutable.MANAGER_API_BASE_URL = undefined
  envMutable.MANAGER_TRIGGER_API_KEY = undefined
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const ITEMS = [
  { assetId: 1, coreId: "c-1" },
  { assetId: 2, coreId: "c-2" },
] as const

describe("triggerManagerEnrichment", () => {
  it("happy path: maps manager statuses to UPPERCASE enum + forwards bearer", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            assetId: 1,
            coreId: "c-1",
            managerJobId: "job-1",
            status: "started",
          },
          {
            assetId: 2,
            coreId: "c-2",
            managerJobId: "job-2",
            status: "already_in_flight",
          },
        ],
      }),
    )

    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")

    expect(results).toEqual([
      {
        assetId: 1,
        coreId: "c-1",
        managerJobId: "job-1",
        status: "STARTED",
      },
      {
        assetId: 2,
        coreId: "c-2",
        managerJobId: "job-2",
        status: "ALREADY_IN_FLIGHT",
      },
    ])

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe("http://manager.test/api/admin-trigger/scene-analysis")
    expect(init?.method).toBe("POST")
    const headers = (init?.headers ?? {}) as Record<string, string>
    expect(headers.authorization).toBe("Bearer test-key")
    expect(headers["content-type"]).toBe("application/json")
    expect(JSON.parse(init?.body as string)).toEqual({ items: [...ITEMS] })
  })

  it("dispatches transcript path when kind=transcript", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ results: [] }))
    await triggerManagerEnrichment(ITEMS, "transcript")
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe("http://manager.test/api/admin-trigger/transcript")
  })

  it("returns synthetic DISPATCH_FAILED config_missing when env unset", async () => {
    envMutable.MANAGER_API_BASE_URL = undefined

    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(results).toEqual([
      expect.objectContaining({
        assetId: 1,
        status: "DISPATCH_FAILED",
        reason: "config_missing",
        retryable: false,
      }),
      expect.objectContaining({
        assetId: 2,
        status: "DISPATCH_FAILED",
        reason: "config_missing",
      }),
    ])
  })

  it("returns synthetic DISPATCH_FAILED auth_failed on 401", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("unauthorized", { status: 401 }),
    )
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results.every((r) => r.status === "DISPATCH_FAILED")).toBe(true)
    expect(results[0].reason).toBe("auth_failed")
    expect(results[0].retryable).toBe(false)
  })

  it("returns synthetic DISPATCH_FAILED config_missing on 503 from manager", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("config", { status: 503 }))
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results[0].status).toBe("DISPATCH_FAILED")
    expect(results[0].reason).toBe("config_missing")
  })

  it("returns DISPATCH_FAILED remote_5xx with retryable=true on 502", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("upstream", { status: 502 }))
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results[0].reason).toBe("remote_5xx")
    expect(results[0].retryable).toBe(true)
  })

  it("returns DISPATCH_FAILED remote_4xx with retryable=false on 400", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("bad", { status: 400 }))
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results[0].reason).toBe("remote_4xx")
    expect(results[0].retryable).toBe(false)
  })

  it("returns DISPATCH_FAILED network_error retryable=true when fetch throws", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"))
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results[0].reason).toBe("network_error")
    expect(results[0].retryable).toBe(true)
    expect(results[0].error).toContain("ECONNREFUSED")
  })

  it("returns DISPATCH_FAILED network_error with timeout message on AbortError", async () => {
    // Mocked-vs-real discipline: throw the REAL typed shape, not a
    // generic Error. AbortError carries `name = "AbortError"`; the
    // helper's branch checks `name === "TimeoutError" | "AbortError"`.
    const aborted = Object.assign(new Error("aborted"), { name: "AbortError" })
    fetchSpy.mockRejectedValueOnce(aborted)
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results[0].reason).toBe("network_error")
    expect(results[0].error).toMatch(/timed out/i)
  })

  it("returns DISPATCH_FAILED network_error with timeout message on TimeoutError (the actual AbortSignal.timeout shape)", async () => {
    // Modern Node's AbortSignal.timeout() throws a DOMException with
    // name='TimeoutError', not AbortError. The branch must match BOTH.
    // This is the second discriminator-branch test the META rule
    // (mocked-shape-vs-real-contract-discipline-20260506) requires —
    // deleting either literal in the OR must fail at least one test.
    const timeout = Object.assign(new Error("The operation timed out"), {
      name: "TimeoutError",
    })
    fetchSpy.mockRejectedValueOnce(timeout)
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results[0].reason).toBe("network_error")
    expect(results[0].error).toMatch(/timed out/i)
  })

  it("maps unknown manager status to DISPATCH_FAILED parse_error rather than letting undefined leak through", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            assetId: 1,
            coreId: "c-1",
            managerJobId: "j-1",
            status: "deferred", // not in STATUS_MAP
          },
          {
            assetId: 2,
            coreId: "c-2",
            managerJobId: "j-2",
            status: "started", // known, control case
          },
        ],
      }),
    )
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    const drift = results.find((r) => r.assetId === 1)
    expect(drift?.status).toBe("DISPATCH_FAILED")
    expect(drift?.reason).toBe("parse_error")
    expect(drift?.error).toMatch(/unknown status: deferred/)
    // Sibling unaffected.
    expect(results.find((r) => r.assetId === 2)?.status).toBe("STARTED")
  })

  it("does NOT propagate manager `message` on STARTED outcomes (would surface as `error` field)", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            assetId: 1,
            coreId: "c-1",
            managerJobId: "j-1",
            status: "started",
            message: "diagnostic info that should NOT become an error",
          },
        ],
      }),
    )
    const results = await triggerManagerEnrichment(
      [{ assetId: 1, coreId: "c-1" }],
      "scene-analysis",
    )
    expect(results[0]).toMatchObject({ status: "STARTED" })
    expect(results[0].error).toBeUndefined()
  })

  it("does NOT propagate manager `message` on ALREADY_IN_FLIGHT outcomes", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            assetId: 1,
            coreId: "c-1",
            managerJobId: "j-1",
            status: "already_in_flight",
            message: "deduped — should NOT surface as error",
          },
        ],
      }),
    )
    const results = await triggerManagerEnrichment(
      [{ assetId: 1, coreId: "c-1" }],
      "scene-analysis",
    )
    expect(results[0]).toMatchObject({ status: "ALREADY_IN_FLIGHT" })
    expect(results[0].error).toBeUndefined()
  })

  it("returns DISPATCH_FAILED parse_error on malformed JSON", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    )
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results[0].reason).toBe("parse_error")
    expect(results[0].retryable).toBe(true)
  })

  it("returns DISPATCH_FAILED parse_error when results field is missing", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ stuff: "no results" }))
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results[0].reason).toBe("parse_error")
  })

  it("admin pre-dedupes assetIds before the request so manager never sees duplicates", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            assetId: 1,
            coreId: "c-1",
            managerJobId: "j-1",
            status: "started",
          },
        ],
      }),
    )
    const dupedItems = [
      { assetId: 1, coreId: "c-1" },
      { assetId: 1, coreId: "c-1" }, // duplicate — should be dropped
    ] as const
    const results = await triggerManagerEnrichment(dupedItems, "scene-analysis")
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ assetId: 1, status: "STARTED" })
    // Verify the duplicate was filtered BEFORE the fetch call.
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
      items: Array<{ assetId: number }>
    }
    expect(sentBody.items).toHaveLength(1)
    expect(sentBody.items[0].assetId).toBe(1)
  })

  it("does not dedupe the same assetId across different target locales", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            assetId: 1,
            coreId: "c-1",
            targetLocale: "es",
            managerJobId: "j-es",
            status: "started",
          },
          {
            assetId: 1,
            coreId: "c-1",
            targetLocale: "ar",
            managerJobId: "j-ar",
            status: "started",
          },
        ],
      }),
    )

    const items = [
      { assetId: 1, coreId: "c-1", targetLocale: "es" },
      { assetId: 1, coreId: "c-1", targetLocale: "ar" },
    ] as const
    const results = await triggerManagerEnrichment(items, "scene-analysis")

    expect(results).toEqual([
      expect.objectContaining({
        assetId: 1,
        targetLocale: "es",
        status: "STARTED",
      }),
      expect.objectContaining({
        assetId: 1,
        targetLocale: "ar",
        status: "STARTED",
      }),
    ])
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
      items: Array<{ assetId: number; targetLocale?: string }>
    }
    expect(sentBody.items).toEqual(items)
  })

  it("normalizes target locale casing before dedupe and dispatch", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            assetId: 1,
            coreId: "c-1",
            targetLocale: "es",
            managerJobId: "j-es",
            status: "started",
          },
        ],
      }),
    )

    const results = await triggerManagerEnrichment(
      [
        { assetId: 1, coreId: "c-1", targetLocale: "ES" },
        { assetId: 1, coreId: "c-1", targetLocale: "es" },
      ],
      "scene-analysis",
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      assetId: 1,
      targetLocale: "es",
      status: "STARTED",
    })
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
      items: Array<{ assetId: number; targetLocale?: string }>
    }
    expect(sentBody.items).toEqual([
      { assetId: 1, coreId: "c-1", targetLocale: "es" },
    ])
  })

  it("returns DISPATCH_FAILED parse_error when manager drops an outcome we sent (contract drift)", async () => {
    // Pre-dedupe means the request and response array lengths
    // should always match. If they don't, that's a manager-side
    // contract bug worth surfacing — not a silent NOT_FOUND.
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            assetId: 1,
            coreId: "c-1",
            managerJobId: "j-1",
            status: "started",
          },
          // assetId=2 dropped despite being requested
        ],
      }),
    )
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results).toHaveLength(2)
    const dropped = results.find((r) => r.assetId === 2)
    expect(dropped?.status).toBe("DISPATCH_FAILED")
    expect(dropped?.reason).toBe("parse_error")
    expect(dropped?.error).toMatch(/contract drift/i)
  })

  it("returns [] without calling fetch when items is empty", async () => {
    const results = await triggerManagerEnrichment([], "scene-analysis")
    expect(results).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("normalises trailing slash on MANAGER_API_BASE_URL", async () => {
    envMutable.MANAGER_API_BASE_URL = "http://manager.test/"
    fetchSpy.mockResolvedValueOnce(jsonResponse({ results: [] }))
    await triggerManagerEnrichment(ITEMS, "transcript")
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://manager.test/api/admin-trigger/transcript",
    )
  })

  it("forwards manager's not_found / validation_failed verbatim with error message", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            assetId: 1,
            coreId: "c-1",
            managerJobId: null,
            status: "not_found",
            message: "cms video not found for coreId",
          },
          {
            assetId: 2,
            coreId: "c-2",
            managerJobId: null,
            status: "validation_failed",
            message: "missing dispatch fields",
          },
        ],
      }),
    )
    const results = await triggerManagerEnrichment(ITEMS, "scene-analysis")
    expect(results[0]).toMatchObject({
      status: "NOT_FOUND",
      managerJobId: null,
      error: "cms video not found for coreId",
    })
    expect(results[1]).toMatchObject({
      status: "VALIDATION_FAILED",
      error: "missing dispatch fields",
    })
  })
})
