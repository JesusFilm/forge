import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth-session", () => ({ verifyAuthSession: vi.fn() }))
vi.mock("@/lib/watch-seo-admin-client", () => ({
  fetchWatchSeoAdmin: vi.fn(),
}))

import { verifyAuthSession } from "@/lib/auth-session"
import { fetchWatchSeoAdmin } from "@/lib/watch-seo-admin-client"
import { GET } from "./route"

describe("GET /watch/api/watch-seo/capability", () => {
  beforeEach(() => vi.resetAllMocks())

  it("fails closed without an access token and does not call Admin", async () => {
    vi.mocked(verifyAuthSession).mockResolvedValue({
      authenticated: true,
      userId: "fallback-user",
    })

    const response = await GET(
      new Request("https://watch.example/watch/api/watch-seo/capability"),
    )

    expect(await response.json()).toEqual({ canViewWatchSeo: false })
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(fetchWatchSeoAdmin).not.toHaveBeenCalled()
  })

  it("returns only the validated capability boolean", async () => {
    vi.mocked(verifyAuthSession).mockResolvedValue({
      authenticated: true,
      userId: "admin-subject",
      accessToken: "user-token",
    })
    vi.mocked(fetchWatchSeoAdmin).mockResolvedValue(
      Response.json({ canViewWatchSeo: true, user: { email: "secret" } }),
    )

    const response = await GET(
      new Request("https://watch.example/watch/api/watch-seo/capability"),
    )

    expect(await response.json()).toEqual({ canViewWatchSeo: true })
    expect(fetchWatchSeoAdmin).toHaveBeenCalledWith(
      "capability",
      "user-token",
      { method: "GET" },
    )
  })

  it("preserves 429 and Retry-After so the client can retry", async () => {
    vi.mocked(verifyAuthSession).mockResolvedValue({
      authenticated: true,
      userId: "admin-subject",
      accessToken: "user-token",
    })
    vi.mocked(fetchWatchSeoAdmin).mockResolvedValue(
      new Response(null, { status: 429, headers: { "retry-after": "17" } }),
    )
    const response = await GET(
      new Request("https://watch.example/watch/api/watch-seo/capability"),
    )
    expect(response.status).toBe(429)
    expect(response.headers.get("retry-after")).toBe("17")
  })
})
