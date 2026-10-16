import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitMock = vi.fn()
const authorizeMock = vi.fn()
const readMock = vi.fn()

class NotFound extends Error {
  constructor() {
    super("nope")
    this.name = "WatchSeoPageNotFoundError"
  }
}

vi.mock("@/auth/rate-limit", () => ({ rateLimitAuthRoute: rateLimitMock }))
vi.mock("@/db/client", () => ({ prisma: { __prisma: true } }))
vi.mock("@/services/watch-seo/authorization", () => ({
  authorizeWatchSeoRequest: authorizeMock,
}))
vi.mock("@/services/watch-seo/read-model.service", () => ({
  WatchSeoPageNotFoundError: NotFound,
  WatchSeoReadModelService: vi.fn(() => ({ read: readMock })),
}))

const { GET } = await import("./route")

const get = (query: string) =>
  GET(new Request(`http://admin.test/api/watch-seo/read-model?${query}`))

describe("GET /api/watch-seo/read-model", () => {
  beforeEach(() => {
    rateLimitMock.mockReset()
    authorizeMock.mockReset()
    readMock.mockReset()
    rateLimitMock.mockResolvedValue({ allowed: true, source: "local" })
    authorizeMock.mockResolvedValue({ ok: true, adminUserId: "user-1" })
    readMock.mockResolvedValue({ version: "watch-seo-read-model/v1" })
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    vi.spyOn(console, "error").mockImplementation(() => undefined)
  })

  it("returns the versioned model uncached for an authorized Admin", async () => {
    const response = await get("slug=jesus&language=english")
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    await expect(response.json()).resolves.toEqual({
      version: "watch-seo-read-model/v1",
    })
    expect(readMock).toHaveBeenCalledWith({
      videoSlug: "jesus",
      languageSlug: "english",
      contextualParentSlug: null,
    })
  })

  it("passes the contextual parent through as a distinct identity", async () => {
    await get("slug=ep-1&language=english&parent=series-a")
    expect(readMock).toHaveBeenCalledWith(
      expect.objectContaining({ contextualParentSlug: "series-a" }),
    )
  })

  it("denies uniformly and reads nothing when authorization fails", async () => {
    for (const reason of [
      "service_key_invalid",
      "role_not_admin",
      "inactive",
    ]) {
      authorizeMock.mockResolvedValue({ ok: false, reason })
      const response = await get("slug=jesus&language=english")
      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({ error: "forbidden" })
    }
    expect(readMock).not.toHaveBeenCalled()
  })

  it("validates input only after authorization, so outsiders see 403 not 400", async () => {
    authorizeMock.mockResolvedValue({
      ok: false,
      reason: "service_key_invalid",
    })
    const denied = await get("slug=../etc&language=")
    expect(denied.status).toBe(403)
    authorizeMock.mockResolvedValue({ ok: true, adminUserId: "user-1" })
    const invalid = await get("slug=../etc&language=english")
    expect(invalid.status).toBe(400)
    expect(readMock).not.toHaveBeenCalled()
  })

  it.each([
    "language=english",
    "slug=jesus",
    "slug=jesus&language=english&extra=1",
    "slug=a/b&language=english",
    "slug=jesus&language=en%20glish",
    `slug=${"a".repeat(300)}&language=english`,
  ])("rejects malformed input %s", async (query) => {
    const response = await get(query)
    expect(response.status).toBe(400)
    expect(readMock).not.toHaveBeenCalled()
  })

  it("maps an unknown page to 404 and unexpected failures to a generic 500", async () => {
    readMock.mockRejectedValueOnce(new NotFound())
    expect((await get("slug=jesus&language=english")).status).toBe(404)

    readMock.mockRejectedValueOnce(new Error("SELECT secret_column FROM x"))
    const response = await get("slug=jesus&language=english")
    expect(response.status).toBe(500)
    const text = await response.text()
    expect(text).toBe('{"error":"internal_error"}')
    expect(text).not.toContain("secret_column")
  })

  it("rate-limits before authorizing", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, source: "local" })
    const response = await get("slug=jesus&language=english")
    expect(response.status).toBe(429)
    expect(authorizeMock).not.toHaveBeenCalled()
  })
})
