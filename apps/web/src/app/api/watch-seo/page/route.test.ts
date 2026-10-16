import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth-session", () => ({ verifyAuthSession: vi.fn() }))
vi.mock("@/lib/watch-seo-admin-client", () => ({
  fetchWatchSeoAdmin: vi.fn(),
}))
vi.mock("@/lib/watch-seo-read-model-adapter", () => ({
  adaptWatchSeoReadModel: vi.fn(),
}))
vi.mock("@/env", () => ({
  env: {
    ADMIN_GRAPHQL_URL: "http://forgeadmin.railway.internal:8080/api/graphql",
    NEXT_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
  },
}))

import { verifyAuthSession } from "@/lib/auth-session"
import { env } from "@/env"
import { fetchWatchSeoAdmin } from "@/lib/watch-seo-admin-client"
import { adaptWatchSeoReadModel } from "@/lib/watch-seo-read-model-adapter"
import type { WatchSeoMarketingData } from "@/components/watch/seo/types"
import { GET } from "./route"

describe("GET /watch/api/watch-seo/page", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv("NODE_ENV", "production")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    Object.assign(env, {
      NEXT_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
    })
  })

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
    const dto: WatchSeoMarketingData = {
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
    const wire = { version: "watch-seo-read-model/v1" }
    vi.mocked(fetchWatchSeoAdmin).mockResolvedValue(Response.json(wire))
    vi.mocked(adaptWatchSeoReadModel).mockReturnValue(dto)

    const response = await GET(
      new Request(
        "https://watch.example/watch/api/watch-seo/page?videoSlug=jesus&locale=en&languageSlug=english",
      ),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: dto,
      adminOrigin: "https://admin.jesusfilm.org",
      adminConfirmationUrl:
        "https://admin.jesusfilm.org/dashboard/seo/proposals/confirm",
    })
    expect(fetchWatchSeoAdmin).toHaveBeenCalledWith(
      "read-model",
      "user-token",
      { method: "GET" },
      new URLSearchParams({ slug: "jesus", language: "english" }),
    )
    expect(adaptWatchSeoReadModel).toHaveBeenCalledWith(wire)
    expect(response.headers.get("cache-control")).toContain("private, no-store")
  })

  it("cannot bypass the query-free adapter with a presentation-shaped upstream response", async () => {
    vi.mocked(verifyAuthSession).mockResolvedValue({
      authenticated: true,
      userId: "admin",
      accessToken: "user-token",
    })
    vi.mocked(fetchWatchSeoAdmin).mockResolvedValue(
      Response.json({ schemaVersion: "watch-seo-marketing-v1" }),
    )
    vi.mocked(adaptWatchSeoReadModel).mockReturnValue(null)
    const response = await GET(
      new Request(
        "https://watch.example/watch/api/watch-seo/page?videoSlug=jesus&locale=en&languageSlug=english",
      ),
    )
    expect(response.status).toBe(502)
    expect(await response.text()).toBe("")
  })

  it("fails closed when production navigation points at private HTTP transport", async () => {
    Object.assign(env, {
      NEXT_PUBLIC_ADMIN_GRAPHQL_URL:
        "http://forgeadmin.railway.internal/api/graphql",
    })
    vi.mocked(verifyAuthSession).mockResolvedValue({
      authenticated: true,
      userId: "admin",
      accessToken: "user-token",
    })
    vi.mocked(fetchWatchSeoAdmin).mockResolvedValue(
      Response.json({ version: "watch-seo-read-model/v1" }),
    )
    vi.mocked(adaptWatchSeoReadModel).mockReturnValue({
      schemaVersion: "watch-seo-marketing-v1",
    } as WatchSeoMarketingData)
    const response = await GET(
      new Request(
        "https://watch.example/watch/api/watch-seo/page?videoSlug=jesus&locale=en&languageSlug=english",
      ),
    )
    expect(response.status).toBe(502)
    expect(await response.text()).toBe("")
  })
})

function family<T>(
  data: T,
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
