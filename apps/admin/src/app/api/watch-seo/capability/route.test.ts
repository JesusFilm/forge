import { beforeEach, describe, expect, it, vi } from "vitest"

const rateLimitMock = vi.fn()
const subjectLimitMock = vi.fn()
const authorizeMock = vi.fn()

vi.mock("@/auth/rate-limit", () => ({
  rateLimitAuthRoute: rateLimitMock,
  incrementFixedWindow: subjectLimitMock,
}))
vi.mock("@/db/client", () => ({ prisma: { __prisma: true } }))
vi.mock("@/services/watch-seo/authorization", () => ({
  authorizeWatchSeoRequest: authorizeMock,
}))

const { GET } = await import("./route")

const request = (headers: HeadersInit = {}) =>
  new Request("http://admin.test/api/watch-seo/capability", { headers })

describe("GET /api/watch-seo/capability", () => {
  beforeEach(() => {
    rateLimitMock.mockReset()
    subjectLimitMock.mockReset()
    authorizeMock.mockReset()
    rateLimitMock.mockResolvedValue({ allowed: true, source: "local" })
    subjectLimitMock.mockResolvedValue({ allowed: true, source: "local" })
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  it("answers exactly one boolean for an active Admin, uncached", async () => {
    authorizeMock.mockResolvedValue({ ok: true, adminUserId: "user-1" })
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ canViewWatchSeo: true })
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(response.headers.get("vary")).toContain("Authorization")
  })

  it("returns a byte-identical denial for every failure reason", async () => {
    const reasons = [
      "config_absent",
      "service_key_invalid",
      "missing_token",
      "inactive",
      "client_not_web",
      "environment_mismatch",
      "user_not_found",
      "role_not_admin",
      "lookup_failed",
    ]
    const bodies = new Set<string>()
    for (const reason of reasons) {
      authorizeMock.mockResolvedValue({ ok: false, reason })
      const response = await GET(request())
      expect(response.status).toBe(403)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      bodies.add(await response.text())
    }
    expect([...bodies]).toEqual(['{"canViewWatchSeo":false}'])
  })

  it("logs a closed reason enum and no credential material", async () => {
    authorizeMock.mockResolvedValue({ ok: false, reason: "role_not_admin" })
    await GET(
      request({
        authorization: "Bearer very-secret-service-key",
        "x-watch-user-authorization": "Bearer very-secret-user-token",
      }),
    )
    const lines = (
      console.warn as unknown as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((call) => String(call[0]))
      .join("\n")
    expect(lines).toContain("event=denied")
    expect(lines).toContain("reason=role_not_admin")
    expect(lines).not.toContain("very-secret")
  })

  it("rate-limits before authorizing so floods never reach the auth chain", async () => {
    rateLimitMock.mockResolvedValue({ allowed: false, source: "local" })
    const response = await GET(request())
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("60")
    expect(authorizeMock).not.toHaveBeenCalled()
    expect(rateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ route: "watch-seo-capability:ip" }),
    )
  })

  it("returns 429 when the verified subject exhausts its quota", async () => {
    authorizeMock.mockImplementation(async (_request, _db, deps) => {
      const admitted = await deps.admitSubject("subject-1")
      return admitted
        ? { ok: true, adminUserId: "user-1" }
        : { ok: false, reason: "subject_rate_limited" }
    })
    subjectLimitMock.mockResolvedValue({ allowed: false, source: "redis" })
    const response = await GET(request())
    expect(response.status).toBe(429)
  })
})
