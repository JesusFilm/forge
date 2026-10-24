import { beforeEach, describe, expect, it, vi } from "vitest"

const testEnv = vi.hoisted(() => ({
  CLOUDFLARE_CACHE_PURGE_TOKEN: undefined as string | undefined,
  CLOUDFLARE_ZONE_ID: undefined as string | undefined,
}))

vi.mock("@/env", () => ({ env: testEnv }))

import {
  WATCH_DYNAMIC_COLLECTIONS_CACHE_TAG,
  dynamicCollectionEdgeCacheHeaders,
  purgeWatchDynamicCollectionsCache,
} from "./cloudflare-cache"

describe("Cloudflare dynamic collection cache", () => {
  beforeEach(() => {
    testEnv.CLOUDFLARE_CACHE_PURGE_TOKEN = undefined
    testEnv.CLOUDFLARE_ZONE_ID = undefined
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it("enables live edge headers only when purge is fully configured", () => {
    expect(dynamicCollectionEdgeCacheHeaders("live", true)).toEqual({})

    testEnv.CLOUDFLARE_ZONE_ID = "a".repeat(32)
    expect(dynamicCollectionEdgeCacheHeaders("live", true)).toEqual({})

    testEnv.CLOUDFLARE_CACHE_PURGE_TOKEN = "purge-token"
    expect(dynamicCollectionEdgeCacheHeaders("preview", true)).toEqual({})
    expect(dynamicCollectionEdgeCacheHeaders("live", false)).toEqual({})
    expect(dynamicCollectionEdgeCacheHeaders("live", true)).toEqual({
      "Cloudflare-CDN-Cache-Control":
        "public, max-age=21600, stale-while-revalidate=86400",
      "Cache-Tag": WATCH_DYNAMIC_COLLECTIONS_CACHE_TAG,
    })
  })

  it("skips purge without complete configuration", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(purgeWatchDynamicCollectionsCache()).resolves.toBe("skipped")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("purges the shared feed tag through the fixed Cloudflare endpoint", async () => {
    testEnv.CLOUDFLARE_ZONE_ID = "a".repeat(32)
    testEnv.CLOUDFLARE_CACHE_PURGE_TOKEN = "purge-token"
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ success: true }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(purgeWatchDynamicCollectionsCache()).resolves.toBe("purged")
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/zones/${"a".repeat(32)}/purge_cache`,
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: "Bearer purge-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags: [WATCH_DYNAMIC_COLLECTIONS_CACHE_TAG] }),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it.each([
    ["an HTTP failure", async () => new Response(null, { status: 503 })],
    ["a malformed success response", async () => Response.json({ ok: true })],
    ["a network failure", async () => Promise.reject(new Error("secret leak"))],
  ])("contains %s without exposing credentials", async (_name, result) => {
    testEnv.CLOUDFLARE_ZONE_ID = "a".repeat(32)
    testEnv.CLOUDFLARE_CACHE_PURGE_TOKEN = "purge-token"
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(result))

    await expect(purgeWatchDynamicCollectionsCache()).resolves.toBe("failed")
    expect(warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain("purge-token")
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret leak")
  })
})
