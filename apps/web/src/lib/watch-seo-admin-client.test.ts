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
  it.each(["follow", "manual", "error"] as const)(
    "enforces no redirects even when init requests %s",
    async (redirect) => {
      const fetchMock = vi.fn().mockResolvedValue(Response.json({}))
      vi.stubGlobal("fetch", fetchMock)
      await fetchWatchSeoAdmin("capability", "user-token", { redirect })
      expect(fetchMock).toHaveBeenCalledOnce()
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        redirect: "error",
        cache: "no-store",
      })
    },
  )

  it("fails closed on a synthetic redirect transport rejection", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"))
    vi.stubGlobal("fetch", fetchMock)
    expect(
      await fetchWatchSeoAdmin("read-model", "user-token", {
        method: "GET",
      }),
    ).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error")
  })

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
    expect(init.redirect).toBe("error")
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
