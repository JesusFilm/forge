import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitAuthRoute = vi.fn()
const isValidSearchTraceSamplingBearer = vi.fn()
const listSearchEvalCandidates = vi.fn()
const storeSearchEvalCandidates = vi.fn()

vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute }))
vi.mock("@/auth/search-trace-bearer", () => ({
  isValidSearchTraceSamplingBearer,
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/search-eval/candidates", async (original) => {
  const actual =
    await original<typeof import("@/services/search-eval/candidates")>()
  return {
    ...actual,
    listSearchEvalCandidates,
    storeSearchEvalCandidates,
  }
})

const { POST, GET } = await import("./route")

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("http://admin.test/api/internal/search-eval/candidates", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer trace-key",
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function getRequest(path = "/api/internal/search-eval/candidates") {
  return new Request(`http://admin.test${path}`, {
    method: "GET",
    headers: {
      authorization: "Bearer trace-key",
    },
  })
}

function rawRequest(body: string, headers: HeadersInit = {}) {
  return new Request("http://admin.test/api/internal/search-eval/candidates", {
    method: "POST",
    headers,
    body,
  })
}

describe("POST /api/internal/search-eval/candidates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
    isValidSearchTraceSamplingBearer.mockReturnValue(true)
    listSearchEvalCandidates.mockResolvedValue([
      {
        id: "candidate-1",
        source: "catalog",
        locale: "en",
        queryText: "Jesus",
        expectedResultHints: [],
        sourceAnchors: [],
        labelProvenance: {},
        generationModel: "seed:v1",
        generationProvider: "mastra",
        judgeSummary: null,
        mastraRunId: "run-1",
        retentionExpiresAt: null,
        generatedAt: "2026-05-26T00:00:00.000Z",
        createdAt: "2026-05-26T00:00:00.000Z",
      },
    ])
    storeSearchEvalCandidates.mockResolvedValue({
      storedCount: 1,
      skippedCount: 0,
      candidates: [{ id: "candidate-1", dedupeKey: "abc", status: "created" }],
      skipped: [],
    })
  })

  it("stores a bounded generated candidate batch for a valid bearer", async () => {
    const body = {
      candidates: [
        {
          source: "trace",
          locale: "en",
          queryText: "jesus movie",
          sourceAnchors: [{ type: "trace", id: "trace-1" }],
          labelProvenance: {
            queryQualityLabel: "valid_viewer_intent",
            abuseLabel: "none",
          },
          generationModel: "trace-sample:v1",
          judgeSummary: { score: 0.8 },
          mastraRunId: "run-1",
          retentionExpiresAt: "2026-06-20T00:00:00.000Z",
        },
      ],
    }

    const response = await POST(request(body))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      storedCount: 1,
      skippedCount: 0,
      candidates: [{ id: "candidate-1", dedupeKey: "abc", status: "created" }],
      skipped: [],
    })
    expect(rateLimitAuthRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "search-eval-candidates",
        limit: 20,
        windowMs: 60_000,
      }),
    )
    expect(storeSearchEvalCandidates).toHaveBeenCalledWith({}, body.candidates)
  })

  it("rejects missing bearer before parsing body", async () => {
    isValidSearchTraceSamplingBearer.mockReturnValue(false)
    const text = vi.fn(async () => {
      throw new Error("body should not be read")
    })

    const response = await POST({
      headers: new Headers(),
      text,
    } as unknown as Request)

    expect(response.status).toBe(401)
    expect(text).not.toHaveBeenCalled()
    expect(storeSearchEvalCandidates).not.toHaveBeenCalled()
  })

  it("returns 429 before auth or body parsing when rate-limited", async () => {
    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })
    const text = vi.fn(async () => JSON.stringify({ candidates: [] }))

    const response = await POST({
      headers: new Headers({ authorization: "Bearer trace-key" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{}"))
          controller.close()
        },
      }),
      text,
    } as unknown as Request)

    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")
    expect(isValidSearchTraceSamplingBearer).not.toHaveBeenCalled()
    expect(text).not.toHaveBeenCalled()
  })

  it("requires JSON content type, valid JSON, and bounded body size", async () => {
    await expect(
      POST(rawRequest("{}", { authorization: "Bearer trace-key" })),
    ).resolves.toHaveProperty("status", 415)

    await expect(
      POST(
        rawRequest("{", {
          authorization: "Bearer trace-key",
          "content-type": "application/json",
        }),
      ),
    ).resolves.toHaveProperty("status", 400)

    const response = await POST({
      headers: new Headers({
        authorization: "Bearer trace-key",
        "content-type": "application/json",
        "content-length": String(64 * 1024 + 1),
      }),
      text: vi.fn(async () => "{}"),
    } as unknown as Request)
    expect(response.status).toBe(413)
    expect(storeSearchEvalCandidates).not.toHaveBeenCalled()
  })

  it("rejects chunked bodies after the byte cap without fully parsing", async () => {
    const response = await POST({
      headers: new Headers({
        authorization: "Bearer trace-key",
        "content-type": "application/json",
      }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(64 * 1024 + 1))
          controller.close()
        },
      }),
    } as unknown as Request)

    expect(response.status).toBe(413)
    expect(storeSearchEvalCandidates).not.toHaveBeenCalled()
  })

  it("rejects malformed batches and client-owned promotion status", async () => {
    for (const body of [
      null,
      [],
      {},
      { candidates: [] },
      { candidates: ["bad"] },
      { candidates: Array.from({ length: 101 }, () => ({})) },
      {
        candidates: [
          {
            source: "catalog",
            locale: "en",
            queryText: "hope",
            generationModel: "model",
            promotionStatus: "promoted",
          },
        ],
      },
    ]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
    }
    expect(storeSearchEvalCandidates).not.toHaveBeenCalled()
  })

  it("maps candidate validation errors to a 400 response", async () => {
    const { SearchEvalCandidateStoreError } =
      await import("@/services/search-eval/candidates")
    storeSearchEvalCandidates.mockRejectedValueOnce(
      new SearchEvalCandidateStoreError(
        "validation",
        "trace candidates require retentionExpiresAt",
      ),
    )

    const response = await POST(
      request({
        candidates: [
          {
            source: "trace",
            locale: "en",
            queryText: "jesus",
            generationModel: "trace-sample:v1",
          },
        ],
      }),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: "trace candidates require retentionExpiresAt",
    })
  })

  it("does not leak auth, vector, user, or scoring payloads in the response", async () => {
    const response = await POST(
      request({
        candidates: [
          {
            source: "catalog",
            locale: "en",
            queryText: "hope",
            generationModel: "model",
          },
        ],
      }),
    )
    const serialized = JSON.stringify(await response.json())

    expect(serialized).not.toMatch(
      /Bearer|cookie|ipAddress|userId|vector|rawScore|scoringPayload/i,
    )
  })

  it("sanitizes caller-controlled run id in audit logs", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {})

    const response = await POST(
      request({
        candidates: [
          {
            source: "catalog",
            locale: "en",
            queryText: "hope",
            generationModel: "model",
            mastraRunId: "run\nx=true",
          },
        ],
      }),
    )

    expect(response.status).toBe(200)
    const line = String(logSpy.mock.calls[0]?.[0] ?? "")
    expect(line).toContain("mastra_run_id=run_x_true")
    expect(line).not.toContain("\n")
    logSpy.mockRestore()
  })
})

describe("GET /api/internal/search-eval/candidates", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
    isValidSearchTraceSamplingBearer.mockReturnValue(true)
    listSearchEvalCandidates.mockResolvedValue([
      {
        id: "candidate-1",
        source: "catalog",
        locale: "en",
        queryText: "Jesus",
        expectedResultHints: [],
        sourceAnchors: [],
        labelProvenance: {},
        generationModel: "seed:v1",
        generationProvider: "mastra",
        judgeSummary: null,
        mastraRunId: "run-1",
        retentionExpiresAt: null,
        generatedAt: "2026-05-26T00:00:00.000Z",
        createdAt: "2026-05-26T00:00:00.000Z",
      },
    ])
  })

  it("does not expose candidate storage without bearer auth", async () => {
    isValidSearchTraceSamplingBearer.mockReturnValue(false)
    const response = await GET(getRequest())

    expect(response.status).toBe(401)
    expect(listSearchEvalCandidates).not.toHaveBeenCalled()
  })

  it("lists bounded generated candidates for a valid bearer", async () => {
    const response = await GET(
      getRequest(
        "/api/internal/search-eval/candidates?source=catalog,trace&locale=en&mastraRunId=run-1&limit=10",
      ),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      candidates: [
        {
          id: "candidate-1",
          source: "catalog",
          locale: "en",
          queryText: "Jesus",
          expectedResultHints: [],
          sourceAnchors: [],
          labelProvenance: {},
          generationModel: "seed:v1",
          generationProvider: "mastra",
          judgeSummary: null,
          mastraRunId: "run-1",
          retentionExpiresAt: null,
          generatedAt: "2026-05-26T00:00:00.000Z",
          createdAt: "2026-05-26T00:00:00.000Z",
        },
      ],
      generatedAt: expect.any(String),
    })
    expect(listSearchEvalCandidates).toHaveBeenCalledWith(
      {},
      {
        sources: ["catalog", "trace"],
        locales: ["en"],
        mastraRunId: "run-1",
        limit: 10,
      },
    )
  })

  it("returns trace-derived candidates without raw query text", async () => {
    listSearchEvalCandidates.mockResolvedValueOnce([
      {
        id: "candidate-trace",
        source: "trace",
        locale: "en",
        queryText: "raw trace query",
        expectedResultHints: ["raw trace query"],
        sourceAnchors: [
          {
            queryHash:
              "b54c7a2c2d7f75f6f139d885e9202f9ec5db932e8a2d17e0efba2a9f0c3d4e5f",
            text: "raw trace query",
          },
        ],
        labelProvenance: {
          rawQueryText: "raw trace query",
          publicQueryHash:
            "b54c7a2c2d7f75f6f139d885e9202f9ec5db932e8a2d17e0efba2a9f0c3d4e5f",
        },
        generationModel: "raw trace query",
        generationProvider: "raw trace query",
        judgeSummary: { rationale: "raw trace query" },
        mastraRunId: "raw trace query",
        retentionExpiresAt: "2026-06-01T00:00:00.000Z",
        generatedAt: "2026-05-26T00:00:00.000Z",
        createdAt: "2026-05-26T00:00:00.000Z",
      },
    ])

    const response = await GET(
      getRequest("/api/internal/search-eval/candidates?source=trace"),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.candidates[0]).toMatchObject({
      id: "candidate-trace",
      source: "trace",
      queryText: null,
      expectedResultHints: [],
      sourceAnchors: [],
      labelProvenance: { source: "trace", redacted: true },
      generationModel: "trace:redacted",
      generationProvider: null,
      judgeSummary: null,
      mastraRunId: null,
    })
    expect(JSON.stringify(body)).not.toContain("raw trace")
    expect(JSON.stringify(body)).not.toContain(
      "b54c7a2c2d7f75f6f139d885e9202f9ec5db932e8a2d17e0efba2a9f0c3d4e5f",
    )
  })

  it("rejects invalid read filters", async () => {
    for (const path of [
      "/api/internal/search-eval/candidates?source=bad",
      "/api/internal/search-eval/candidates?limit=0",
      "/api/internal/search-eval/candidates?limit=101",
    ]) {
      const response = await GET(getRequest(path))
      expect(response.status).toBe(400)
    }
    expect(listSearchEvalCandidates).not.toHaveBeenCalled()
  })

  it("maps candidate read outages to a sanitized 503", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    listSearchEvalCandidates.mockRejectedValueOnce(
      new Error("db password leak"),
    )

    const response = await GET(getRequest())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Candidate storage is temporarily unavailable",
    })
    const serializedLogs = JSON.stringify(logSpy.mock.calls)
    expect(serializedLogs).toContain("error_class=Error")
    expect(serializedLogs).not.toContain("db password leak")
    logSpy.mockRestore()
  })
})
