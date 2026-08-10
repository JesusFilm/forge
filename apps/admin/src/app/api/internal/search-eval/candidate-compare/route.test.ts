import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitAuthRoute = vi.fn()
const isValidCandidateSearchEvalBearer = vi.fn()
const compare = vi.fn()
const createTypesenseWatchSearchComparisonService = vi.fn(() => ({ compare }))
const projectWatchSearchComparisonResult = vi.fn((result) => result)

vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute }))
vi.mock("@/auth/candidate-search-eval-bearer", () => ({
  isValidCandidateSearchEvalBearer,
}))
vi.mock("@/services/typesense-watch-search-comparison.service", () => ({
  createTypesenseWatchSearchComparisonService,
}))
vi.mock("@/services/search-trace-privacy", () => ({
  projectWatchSearchComparisonResult,
}))

const { POST } = await import("./route")

function request(body: unknown, authorization = "Bearer candidate-key") {
  return new Request(
    "http://admin.test/api/internal/search-eval/candidate-compare",
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  )
}

describe("POST /api/internal/search-eval/candidate-compare", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "redis" })
    isValidCandidateSearchEvalBearer.mockReturnValue(true)
    compare.mockResolvedValue({
      comparisonId: "comparison-1",
      input: { query: "Jesus" },
      current: { status: "success" },
      candidate: {
        status: "error",
        error: { code: "search_failed", errorClass: "Error" },
      },
    })
  })

  it("runs the fixed current-versus-candidate comparison", async () => {
    const response = await POST(
      request({
        query: "  Jesus  ",
        languageSlug: "japanese",
        locale: "ja",
        limit: 10,
        contentType: "video",
      }),
    )

    expect(response.status).toBe(200)
    expect(compare).toHaveBeenCalledWith({
      actorKey: expect.stringMatching(/^[a-f0-9]{32}$/),
      input: expect.objectContaining({
        query: "Jesus",
        targetLanguageSlug: "japanese",
        displayLanguageSlug: "japanese",
        acceptLanguage: "ja",
        limit: 10,
        resultTypes: ["video"],
      }),
    })
    expect(projectWatchSearchComparisonResult).toHaveBeenCalledOnce()
    await expect(response.json()).resolves.toMatchObject({
      current: { status: "success" },
      candidate: { status: "error" },
    })
  })

  it("rejects profile, collection, revision, and generation selectors", async () => {
    for (const forbidden of [
      { profile: "CANDIDATE" },
      { collection: "arbitrary" },
      { revision: "arbitrary" },
      { generationId: "arbitrary" },
    ]) {
      const response = await POST(request({ query: "Jesus", ...forbidden }))
      expect(response.status).toBe(400)
    }
    expect(compare).not.toHaveBeenCalled()
  })

  it("requires the dedicated bearer and enforces the route limit", async () => {
    isValidCandidateSearchEvalBearer.mockReturnValueOnce(false)
    await expect(POST(request({ query: "Jesus" }))).resolves.toHaveProperty(
      "status",
      401,
    )

    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "redis",
    })
    await expect(POST(request({ query: "Jesus" }))).resolves.toHaveProperty(
      "status",
      429,
    )
  })

  it("does not expose internal errors", async () => {
    compare.mockRejectedValueOnce(new Error("secret collection and key"))
    const response = await POST(request({ query: "Jesus" }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "Candidate comparison is temporarily unavailable",
    })
  })
})
