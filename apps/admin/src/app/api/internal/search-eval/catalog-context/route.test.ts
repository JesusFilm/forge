import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitAuthRoute = vi.fn()
const isValidSearchTraceSamplingBearer = vi.fn()
const readSearchEvalCatalogContext = vi.fn()

vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute }))
vi.mock("@/auth/search-trace-bearer", () => ({
  isValidSearchTraceSamplingBearer,
}))
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/search-eval/catalog-context", async (original) => {
  const actual =
    await original<typeof import("@/services/search-eval/catalog-context")>()
  return {
    ...actual,
    readSearchEvalCatalogContext,
  }
})

const { POST, GET } = await import("./route")

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request(
    "http://admin.test/api/internal/search-eval/catalog-context",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer trace-key",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  )
}

function rawRequest(body: string, headers: HeadersInit = {}) {
  return new Request(
    "http://admin.test/api/internal/search-eval/catalog-context",
    {
      method: "POST",
      headers,
      body,
    },
  )
}

describe("POST /api/internal/search-eval/catalog-context", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitAuthRoute.mockResolvedValue({ allowed: true, source: "local" })
    isValidSearchTraceSamplingBearer.mockReturnValue(true)
    readSearchEvalCatalogContext.mockResolvedValue({
      localeProfiles: [{ locale: "en", tier: 1, source: "harness" }],
      anchors: [
        {
          source: "video",
          id: "video-locale-1",
          locale: "en",
          title: "JESUS",
          slug: "jesus",
          label: "FEATURE_FILM",
          snippet: "The story of Jesus.",
          description: null,
          keywords: ["Jesus"],
          expectedResultHints: [
            {
              type: "video",
              id: "video-1",
              slug: "jesus",
              title: "JESUS",
            },
          ],
        },
      ],
    })
  })

  it("returns compact catalog context for a valid bearer", async () => {
    const response = await POST(request({ locales: ["en"], limit: 12 }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      localeProfiles: [{ locale: "en", tier: 1, source: "harness" }],
      anchors: [
        expect.objectContaining({
          source: "video",
          id: "video-locale-1",
          expectedResultHints: [
            {
              type: "video",
              id: "video-1",
              slug: "jesus",
              title: "JESUS",
            },
          ],
        }),
      ],
      generatedAt: expect.any(String),
    })
    expect(rateLimitAuthRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "search-eval-catalog-context",
        limit: 20,
        windowMs: 60_000,
      }),
    )
    expect(readSearchEvalCatalogContext).toHaveBeenCalledWith(
      {},
      { locales: ["en"], limit: 12 },
    )
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
    expect(readSearchEvalCatalogContext).not.toHaveBeenCalled()
  })

  it("returns 429 before auth or body parsing when rate-limited", async () => {
    rateLimitAuthRoute.mockResolvedValueOnce({
      allowed: false,
      source: "local",
    })
    const text = vi.fn(async () => JSON.stringify({ locales: ["en"] }))

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
        "content-length": "4097",
      }),
      text: vi.fn(async () => "{}"),
    } as unknown as Request)
    expect(response.status).toBe(413)
    expect(readSearchEvalCatalogContext).not.toHaveBeenCalled()
  })

  it("rejects malformed filters before reading catalog rows", async () => {
    for (const body of [
      null,
      [],
      { locales: "en" },
      { locales: [] },
      { locales: [12] },
      { locales: Array.from({ length: 31 }, () => "en") },
      { limit: "10" },
    ]) {
      const response = await POST(request(body))
      expect(response.status).toBe(400)
    }
    expect(readSearchEvalCatalogContext).not.toHaveBeenCalled()
  })

  it("keeps vectors, raw transcripts, auth data, and scoring payloads out of the response", async () => {
    const response = await POST(request({ locales: ["en"] }))
    const serialized = JSON.stringify(await response.json())

    expect(serialized).not.toMatch(
      /embedding|vector|transcript|Bearer|cookie|ipAddress|userId|score/i,
    )
  })

  it("sanitizes caller-controlled filter values in audit logs", async () => {
    const logSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const response = await POST(request({ locales: ["en\nx=true"] }))

    expect(response.status).toBe(200)
    const line = String(logSpy.mock.calls[0]?.[0] ?? "")
    expect(line).toContain("locales=en_x_true")
    expect(line).not.toContain("\n")
    logSpy.mockRestore()
  })
})

describe("GET /api/internal/search-eval/catalog-context", () => {
  it("does not expose context without bearer auth", async () => {
    const response = await GET()

    expect(response.status).toBe(401)
  })
})
