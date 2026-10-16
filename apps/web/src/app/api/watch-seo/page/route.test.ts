import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth-session", () => ({ verifyAuthSession: vi.fn() }))
vi.mock("@/lib/watch-seo-admin-client", () => ({
  fetchWatchSeoAdmin: vi.fn(),
}))

import { verifyAuthSession } from "@/lib/auth-session"
import { fetchWatchSeoAdmin } from "@/lib/watch-seo-admin-client"
import { GET } from "./route"

describe("GET /watch/api/watch-seo/page", () => {
  beforeEach(() => vi.resetAllMocks())

  it("returns an empty denial and never contacts Admin for fallback sessions", async () => {
    vi.mocked(verifyAuthSession).mockResolvedValue({
      authenticated: true,
      userId: "fallback-user",
    })

    const response = await GET(
      new Request(
        "https://watch.example/watch/api/watch-seo/page?videoSlug=jesus&locale=en&languageSlug=english",
      ),
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toBe("")
    expect(fetchWatchSeoAdmin).not.toHaveBeenCalled()
  })

  it("forwards the bounded page identity using the private user token", async () => {
    vi.mocked(verifyAuthSession).mockResolvedValue({
      authenticated: true,
      userId: "admin-subject",
      accessToken: "user-token",
    })
    const dto = {
      schemaVersion: "watch-seo-marketing-v1",
      page: {
        videoId: "m1",
        dubId: null,
        language: "English",
        title: "Example",
        canonicalUrl: "https://watch.example/watch/example.html",
        contextualUrl: null,
      },
      rankings: family(null, "unavailable"),
      reach: family(null, "not_connected"),
      viewing: family(null, "not_connected"),
      ctaOutcomes: family(null, "unavailable"),
      aiTraffic: family(null, "not_connected"),
      content: family(null, "unavailable"),
      crawler: family(null, "unavailable"),
      previews: family(null, "unavailable"),
      opportunities: family({ items: [] }),
      alerts: [],
    }
    vi.mocked(fetchWatchSeoAdmin).mockResolvedValue(Response.json(dto))

    const response = await GET(
      new Request(
        "https://watch.example/watch/api/watch-seo/page?videoSlug=jesus&locale=en&languageSlug=english",
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: dto,
      adminOrigin: "http://localhost:1437",
      adminConfirmationUrl:
        "http://localhost:1437/dashboard/seo/proposals/confirm",
    })
    expect(fetchWatchSeoAdmin).toHaveBeenCalledWith(
      "read-model",
      "user-token",
      { method: "GET" },
      new URLSearchParams({ slug: "jesus", language: "english" }),
    )
  })
})

function family(
  data: unknown,
  state:
    | "available"
    | "partial"
    | "unavailable"
    | "not_connected"
    | "stale"
    | "compacted"
    | "unknown" = "available",
) {
  return { state, source: null, window: null, observedAt: null, data }
}
