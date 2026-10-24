import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitAuthRoute = vi.fn()
const isValidSearchTraceSamplingBearer = vi.fn()
const sampleSearchTraces = vi.fn()

vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute }))
vi.mock("@/auth/search-trace-bearer", () => ({
  isValidSearchTraceSamplingBearer,
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/search-trace.service", async (original) => {
  const actual =
    await original<typeof import("@/services/search-trace.service")>()
  return {
    ...actual,
    sampleSearchTraces,
  }
})

const { POST, GET } = await import("./route")

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://admin.test/api/internal/search-traces/sample", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function rawRequest(body: string, headers: HeadersInit = {}) {
  return new Request("http://admin.test/api/internal/search-traces/sample", {
    method: "POST",
    headers,
    body,
  })
}

function streamingRequest(chunks: string[], headers: HeadersInit = {}) {
  const encodedChunks = chunks.map((chunk) => new TextEncoder().encode(chunk))
  const cancel = vi.fn(async () => undefined)
  let index = 0
  const reader = {
    cancel,
    read: vi.fn(async () => {
      const value = encodedChunks[index]
      index += 1
      return value == null
        ? { done: true as const, value: undefined }
        : { done: false as const, value }
    }),
  }

  return {
    cancel,
    request: {
      headers: new Headers(headers),
      body: { getReader: () => reader },
    } as unknown as Request,
  }
}

describe("POST /api/internal/search-traces/sample", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
    isValidSearchTraceSamplingBearer.mockReturnValue(true)
    sampleSearchTraces.mockResolvedValue([
      {
        id: "trace-1",
        queryText: "Jesus film",
        locale: "en",
        routeSource: "rest",
        requestedMode: "hybrid",
        searchMode: "watch-search",
        resultCount: 3,
        latencyBucket: "lt_250ms",
        outcome: "success",
        traceClass: "none",
        queryQualityLabel: "valid_viewer_intent",
        sensitiveQueryLabel: "none",
        abuseLabel: "none",
        queryLabelSource: "rules",
        queryLabelVersion: "search-query-labels/v1",
        queryLabeledAt: "2026-05-25T00:00:00.000Z",
        llmQueryQualityLabel: null,
        llmAbuseLabel: null,
        llmLabelSource: null,
        llmLabelVersion: null,
        llmLabelReason: null,
        llmLabeledAt: null,
        rawExpiresAt: "2026-06-23T00:00:00.000Z",
        createdAt: "2026-05-25T00:00:00.000Z",
      },
    ])
  })

  it("returns bounded samples for a valid dedicated bearer", async () => {
    const response = await POST(
      request(
        {
          locale: "en",
          routeSource: "rest",
          searchMode: "watch-search",
          since: "2026-05-25T00:00:00.000Z",
          until: "2026-05-26T00:00:00.000Z",
          limit: 500,
        },
        { authorization: "Bearer trace-key" },
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      traces: [
        expect.objectContaining({
          id: "trace-1",
          queryText: "Jesus film",
          locale: "en",
          routeSource: "rest",
          searchMode: "watch-search",
          queryQualityLabel: "valid_viewer_intent",
          rawExpiresAt: "2026-06-23T00:00:00.000Z",
        }),
      ],
      generatedAt: expect.any(String),
    })
    expect(rateLimitAuthRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "search-trace-sample",
        limit: 20,
        windowMs: 60_000,
      }),
    )
    expect(isValidSearchTraceSamplingBearer).toHaveBeenCalledWith(
      "Bearer trace-key",
    )
    expect(sampleSearchTraces).toHaveBeenCalledWith(
      {},
      {
        locale: "en",
        routeSource: "rest",
        searchMode: "watch-search",
        since: new Date("2026-05-25T00:00:00.000Z"),
        until: new Date("2026-05-26T00:00:00.000Z"),
        limit: 500,
      },
    )
  })

  it("accepts explicit label and LLM candidate filters", async () => {
    const response = await POST(
      request(
        {
          queryQualityLabels: ["catalog_lookup", "unknown_ambiguous"],
          sensitiveQueryLabels: ["none"],
          abuseLabels: ["none"],
          llmClassification: "candidates",
        },
        { authorization: "Bearer trace-key" },
      ),
    )

    expect(response.status).toBe(200)
    expect(sampleSearchTraces).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        queryQualityLabels: ["catalog_lookup", "unknown_ambiguous"],
        sensitiveQueryLabels: ["none"],
        abuseLabels: ["none"],
        llmClassification: "candidates",
      }),
    )
  })

  it.each(["classified", "unclassified", "any"] as const)(
    "forwards llmClassification=%s",
    async (llmClassification) => {
      const response = await POST(
        request({ llmClassification }, { authorization: "Bearer trace-key" }),
      )

      expect(response.status).toBe(200)
      expect(sampleSearchTraces).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ llmClassification }),
      )
    },
  )

  it("rejects missing or wrong bearer before parsing the body", async () => {
    isValidSearchTraceSamplingBearer.mockReturnValue(false)
    const text = vi.fn(async () => {
      throw new Error("body should not be read")
    })
    const response = await POST({
      headers: new Headers(),
      text,
    } as unknown as Request)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: "Authorization required",
    })
    expect(text).not.toHaveBeenCalled()
    expect(sampleSearchTraces).not.toHaveBeenCalled()
  })

  it("returns 429 before auth or body parsing when rate-limited", async () => {
    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })
    const text = vi.fn(async () => JSON.stringify({ locale: "en" }))
    const response = await POST({
      headers: new Headers({ authorization: "Bearer trace-key" }),
      text,
    } as unknown as Request)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")
    expect(isValidSearchTraceSamplingBearer).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
    expect(sampleSearchTraces).not.toHaveBeenCalled()
  })

  it("requires JSON content type before parsing the body", async () => {
    const response = await POST(
      rawRequest("{}", { authorization: "Bearer trace-key" }),
    )

    expect(response.status).toBe(415)
    await expect(response.json()).resolves.toEqual({
      error: "Content-Type must be application/json",
    })
    expect(sampleSearchTraces).not.toHaveBeenCalled()
  })

  it("rejects oversized bodies before reading them", async () => {
    const text = vi.fn(async () => JSON.stringify({ locale: "en" }))
    const response = await POST({
      headers: new Headers({
        authorization: "Bearer trace-key",
        "content-type": "application/json",
        "content-length": "4097",
      }),
      text,
    } as unknown as Request)

    expect(response.status).toBe(413)
    expect(text).not.toHaveBeenCalled()
    expect(sampleSearchTraces).not.toHaveBeenCalled()
  })

  it("rejects oversized chunked bodies while streaming", async () => {
    const { cancel, request: streamedRequest } = streamingRequest(
      ["x".repeat(4097)],
      {
        authorization: "Bearer trace-key",
        "content-type": "application/json",
      },
    )

    const response = await POST(streamedRequest)

    expect(response.status).toBe(413)
    expect(cancel).toHaveBeenCalled()
    expect(sampleSearchTraces).not.toHaveBeenCalled()
  })

  it("rejects invalid JSON", async () => {
    const response = await POST(
      rawRequest("{", {
        authorization: "Bearer trace-key",
        "content-type": "application/json",
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "Invalid JSON body",
    })
    expect(sampleSearchTraces).not.toHaveBeenCalled()
  })

  it("rejects invalid routeSource filters", async () => {
    const response = await POST(
      request({ routeSource: "public" }, { authorization: "Bearer trace-key" }),
    )

    expect(response.status).toBe(400)
    expect(sampleSearchTraces).not.toHaveBeenCalled()
  })

  it("rejects malformed filter values instead of silently ignoring them", async () => {
    for (const body of [
      { locale: ["en"] },
      { searchMode: 12 },
      { queryQualityLabels: "valid_viewer_intent" },
      { queryQualityLabels: ["normal"] },
      { sensitiveQueryLabels: ["secret"] },
      { abuseLabels: ["bad"] },
      { llmClassification: "live" },
      { since: "not-a-date" },
      { until: 12 },
      { limit: "50" },
    ]) {
      const response = await POST(
        request(body, { authorization: "Bearer trace-key" }),
      )

      expect(response.status).toBe(400)
    }
    expect(sampleSearchTraces).not.toHaveBeenCalled()
  })

  it("keeps bearer, cookie, IP, user id, vector, and scoring data out of the response", async () => {
    const response = await POST(
      request({ locale: "en" }, { authorization: "Bearer trace-key" }),
    )
    const serialized = JSON.stringify(await response.json())

    expect(serialized).not.toContain("Bearer")
    expect(serialized).not.toMatch(/cookie|ipAddress|userId|vector|score/i)
  })

  it("maps trace read outages to a sanitized 503", async () => {
    sampleSearchTraces.mockRejectedValueOnce(new Error("postgres://secret"))

    const response = await POST(
      request({ locale: "en" }, { authorization: "Bearer trace-key" }),
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Trace sampling is temporarily unavailable",
    })
  })

  it("sanitizes caller-controlled filter values in audit logs", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {})

    const response = await POST(
      request(
        { locale: "en\ninjected=true", searchMode: "watch-search\tmode" },
        { authorization: "Bearer trace-key" },
      ),
    )

    expect(response.status).toBe(200)
    const line = String(logSpy.mock.calls[0]?.[0] ?? "")
    expect(line).toContain("locale=en_injected_true")
    expect(line).toContain("search_mode=watch-search_mode")
    expect(line).not.toContain("\n")
    expect(line).not.toContain("\t")
    logSpy.mockRestore()
  })
})

describe("GET /api/internal/search-traces/sample", () => {
  it("does not expose anything without bearer auth", async () => {
    const response = await GET()

    expect(response.status).toBe(401)
  })
})
