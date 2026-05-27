import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitAuthRoute = vi.fn()
const isValidSearchTraceSamplingBearer = vi.fn()
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
      text,
    } as unknown as Request)

    expect(response.status).toBe(429)
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
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {})

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
  it("does not expose candidate storage without bearer auth", async () => {
    const response = await GET()

    expect(response.status).toBe(401)
  })
})
