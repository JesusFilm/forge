import { afterEach, describe, expect, it, vi } from "vitest"

import {
  clearWatchRouteManifestCache,
  getWatchRouteManifest,
  isWatchRouteAdmittedByManifest,
  parseWatchRouteManifest,
  type WatchRouteManifest,
} from "./watch-route-manifest"

const manifest: WatchRouteManifest = {
  version: "version-1",
  generatedAt: "2026-05-29T12:00:00.000Z",
  contentSlugs: ["easter", "jesus"],
  oneSegmentSlugs: ["easter"],
  episodePairsByParent: {
    jesus: ["the-beginning", "missing-language"],
  },
  audioLanguageSlugs: ["english", "spanish-latin-american"],
  audioLanguageIndexesByContent: {
    jesus: [0],
  },
  audioLanguageIndexesByEpisode: {
    jesus: {
      "the-beginning": [1],
      "missing-language": [0],
    },
  },
}

const originalEnv = { ...process.env }

afterEach(() => {
  process.env.ADMIN_GRAPHQL_URL = originalEnv.ADMIN_GRAPHQL_URL
  process.env.WEB_ADMIN_API_KEYS = originalEnv.WEB_ADMIN_API_KEYS
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clearWatchRouteManifestCache()
})

describe("parseWatchRouteManifest", () => {
  it("accepts the admin manifest contract", () => {
    expect(parseWatchRouteManifest(manifest)).toEqual(manifest)
  })

  it("rejects payloads that do not carry bounded admission sets", () => {
    expect(
      parseWatchRouteManifest({
        ...manifest,
        episodePairsByParent: { jesus: "the-beginning" },
      }),
    ).toBeNull()
    expect(
      parseWatchRouteManifest({
        ...manifest,
        audioLanguageSlugs: [null],
      }),
    ).toBeNull()
    expect(
      parseWatchRouteManifest({
        ...manifest,
        audioLanguageIndexesByContent: { jesus: [null] },
      }),
    ).toBeNull()
    expect(
      parseWatchRouteManifest({
        ...manifest,
        audioLanguageIndexesByEpisode: { jesus: { "the-beginning": [null] } },
      }),
    ).toBeNull()
  })
})

describe("getWatchRouteManifest", () => {
  it("logs a Datadog-visible breadcrumb when the admin manifest fetch fails", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "key-one"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 503 })),
    )

    await expect(getWatchRouteManifest()).resolves.toBeNull()

    expect(warnSpy).toHaveBeenCalledWith(
      "[watch] event=watch_route_manifest.fetch.failed status=503 url=https://admin.test/api/watch-route-manifest",
    )
  })

  it("logs a Datadog-visible breadcrumb when the admin manifest fetch throws", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "key-one"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout now")))

    await expect(getWatchRouteManifest()).resolves.toBeNull()

    expect(warnSpy).toHaveBeenCalledWith(
      "[watch] event=watch_route_manifest.fetch.error detail=timeout_now url=https://admin.test/api/watch-route-manifest",
    )
  })

  it("logs a Datadog-visible breadcrumb when the admin manifest payload is invalid", async () => {
    process.env.ADMIN_GRAPHQL_URL = "https://admin.test/api/graphql"
    process.env.WEB_ADMIN_API_KEYS = "key-one"
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    )

    await expect(getWatchRouteManifest()).resolves.toBeNull()

    expect(warnSpy).toHaveBeenCalledWith(
      "[watch] event=watch_route_manifest.fetch.invalid_payload url=https://admin.test/api/watch-route-manifest",
    )
  })
})

describe("isWatchRouteAdmittedByManifest", () => {
  it("admits valid one-segment, video, and episode shapes", () => {
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "one-segment",
        slug: "easter",
      }),
    ).toBe(true)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "video",
        contentSlug: "jesus",
        audioLanguageSlug: "english",
      }),
    ).toBe(true)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "episode",
        parentSlug: "jesus",
        childSlug: "the-beginning",
        audioLanguageSlug: "spanish-latin-american",
      }),
    ).toBe(true)
  })

  it("rejects unknown slugs and content/audio combinations outside the exact route-audio index", () => {
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "video",
        contentSlug: "anything",
        audioLanguageSlug: "english",
      }),
    ).toBe(false)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "episode",
        parentSlug: "jesus",
        childSlug: "anything",
        audioLanguageSlug: "english",
      }),
    ).toBe(false)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "video",
        contentSlug: "jesus",
        audioLanguageSlug: "en",
      }),
    ).toBe(false)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "video",
        contentSlug: "jesus",
        audioLanguageSlug: "spanish-latin-american",
      }),
    ).toBe(false)
    expect(
      isWatchRouteAdmittedByManifest(manifest, {
        kind: "episode",
        parentSlug: "jesus",
        childSlug: "the-beginning",
        audioLanguageSlug: "english",
      }),
    ).toBe(false)
  })
})
