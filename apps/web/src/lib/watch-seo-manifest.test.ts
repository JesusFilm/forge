import { afterEach, describe, expect, it, vi } from "vitest"

import {
  clearWatchSeoManifestCache,
  getWatchSeoManifest,
  parseWatchSeoManifest,
  setWatchSeoManifestSourceForTest,
  type WatchSeoManifest,
} from "./watch-seo-manifest"

const manifest: WatchSeoManifest = {
  version: "version-1",
  generatedAt: "2026-06-12T12:00:00.000Z",
  videoRouteGroups: [
    {
      contentSlug: "jesus",
      alternates: [
        { hreflang: "en", languageSlug: "english" },
        { hreflang: "es", languageSlug: "spanish-castilian" },
      ],
    },
  ],
  episodeRouteGroups: [
    {
      parentSlug: "lumo-the-gospel-of-john",
      childSlug: "wedding-in-cana",
      alternates: [{ hreflang: "en", languageSlug: "english" }],
    },
  ],
  skippedHreflangValues: { "es-419": 1 },
}

const originalEnv = { ...process.env }

afterEach(() => {
  process.env.ADMIN_GRAPHQL_URL = originalEnv.ADMIN_GRAPHQL_URL
  process.env.WEB_ADMIN_API_KEYS = originalEnv.WEB_ADMIN_API_KEYS
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearWatchSeoManifestCache()
})

describe("parseWatchSeoManifest", () => {
  it("accepts the admin SEO manifest contract", () => {
    expect(parseWatchSeoManifest(manifest)).toEqual(manifest)
  })

  it("rejects malformed route groups and skipped-count maps", () => {
    expect(
      parseWatchSeoManifest({
        ...manifest,
        videoRouteGroups: [{ contentSlug: "jesus", alternates: "en" }],
      }),
    ).toBeNull()
    expect(
      parseWatchSeoManifest({
        ...manifest,
        episodeRouteGroups: [
          {
            parentSlug: "series",
            childSlug: null,
            alternates: [],
          },
        ],
      }),
    ).toBeNull()
    expect(
      parseWatchSeoManifest({
        ...manifest,
        skippedHreflangValues: { "es-419": "1" },
      }),
    ).toBeNull()
  })
})

describe("getWatchSeoManifest", () => {
  it("uses a test source override", async () => {
    const reset = setWatchSeoManifestSourceForTest(async () => manifest)

    await expect(getWatchSeoManifest()).resolves.toEqual(manifest)

    reset()
  })

  it("fetches through the admin SEO manifest endpoint with the first consumer bearer", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "key-one,key-two"
    const signal = new AbortController().signal
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal)
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { etag: '"version-1"' },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    try {
      await expect(getWatchSeoManifest()).resolves.toEqual(manifest)

      expect(fetchMock).toHaveBeenCalledWith(
        "https://admin.test/api/watch-seo-manifest",
        expect.objectContaining({
          headers: { Authorization: "Bearer key-one" },
          cache: "no-store",
          signal,
        }),
      )
      expect(timeoutSpy).toHaveBeenCalledWith(10_000)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it("reuses the cached manifest on 304 and failed refreshes", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "key-one"
    let now = 1_000
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { etag: '"version-1"' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
    vi.stubGlobal("fetch", fetchMock)

    try {
      await expect(getWatchSeoManifest()).resolves.toEqual(manifest)
      now += 61_000
      await expect(getWatchSeoManifest()).resolves.toEqual(manifest)
      now += 61_000
      await expect(getWatchSeoManifest()).resolves.toEqual(manifest)
      expect(warnSpy).toHaveBeenCalledWith(
        "[watch] event=watch_seo_manifest.fetch.failed status=503 url=https://admin.test/api/watch-seo-manifest",
      )
    } finally {
      dateSpy.mockRestore()
    }
  })

  it("retries initial fetch failures after a short miss TTL", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "key-one"
    let now = 1_000
    const dateSpy = vi.spyOn(Date, "now").mockImplementation(() => now)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { etag: '"version-1"' },
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    try {
      await expect(getWatchSeoManifest()).resolves.toBeNull()
      now += 6_000
      await expect(getWatchSeoManifest()).resolves.toEqual(manifest)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(warnSpy).toHaveBeenCalledWith(
        "[watch] event=watch_seo_manifest.fetch.error detail=timeout url=https://admin.test/api/watch-seo-manifest",
      )
    } finally {
      dateSpy.mockRestore()
    }
  })

  it("logs invalid payloads in the Watch event format", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "key-one"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    )

    await expect(getWatchSeoManifest()).resolves.toBeNull()

    expect(warnSpy).toHaveBeenCalledWith(
      "[watch] event=watch_seo_manifest.fetch.invalid_payload url=https://admin.test/api/watch-seo-manifest",
    )
  })
})
