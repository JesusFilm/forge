import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/env", () => ({
  env: {
    WATCH_SEO_API_KEYS: "watch-service-key",
    ADMIN_GRAPHQL_URL: "http://forgeadmin.railway.internal:8080/api/graphql",
    NEXT_PUBLIC_ADMIN_GRAPHQL_URL: "https://admin.jesusfilm.org/api/graphql",
  },
}))

import { env } from "@/env"
import { fetchWatchSeoAdmin } from "./watch-seo-admin-client"
import { watchSeoAdminOrigin } from "./watch-seo-admin-origin"

afterEach(() => vi.unstubAllGlobals())

describe("Watch SEO transport and navigation", () => {
  it("keeps Railway private transport separate from public Admin confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}))
    vi.stubGlobal("fetch", fetchMock)
    await fetchWatchSeoAdmin(
      "read-model",
      "user-token",
      { method: "GET" },
      new URLSearchParams({ slug: "jesus", language: "english" }),
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      "http://forgeadmin.railway.internal:8080/api/watch-seo/read-model?slug=jesus&language=english",
    )
    expect(init.cache).toBe("no-store")
    const headers = new Headers(init.headers)
    expect(headers.get("authorization")).toBe("Bearer watch-service-key")
    expect(headers.get("x-watch-user-authorization")).toBe("Bearer user-token")
    const publicOrigin = watchSeoAdminOrigin(
      env.NEXT_PUBLIC_ADMIN_GRAPHQL_URL,
      true,
    )
    expect(
      new URL("/dashboard/seo/proposals/confirm", publicOrigin!).toString(),
    ).toBe("https://admin.jesusfilm.org/dashboard/seo/proposals/confirm")
  })
})
