import { beforeEach, describe, expect, it, vi } from "vitest"

const { getWatchSeoManifestMock, logWatchServerEventMock } = vi.hoisted(() => ({
  getWatchSeoManifestMock: vi.fn(),
  logWatchServerEventMock: vi.fn(),
}))

vi.mock("@/lib/watch-seo-manifest", () => ({
  getWatchSeoManifest: getWatchSeoManifestMock,
}))

vi.mock("@/lib/watch-observability", () => ({
  logWatchServerEvent: logWatchServerEventMock,
}))

const manifest = {
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
  episodeRouteGroups: [],
  skippedHreflangValues: {},
}

describe("watch sitemap routes", () => {
  beforeEach(() => {
    getWatchSeoManifestMock.mockReset()
    getWatchSeoManifestMock.mockResolvedValue(manifest)
    logWatchServerEventMock.mockReset()
  })

  it("serves a sitemap index", async () => {
    const { GET } = await import("./sitemap.xml/route")
    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/xml")
    const xml = await response.text()
    expect(xml).toContain("<sitemapindex")
    expect(xml).toContain("https://www.jesusfilm.org/watch/sitemap/0.xml")
  })

  it("returns 503 when the sitemap manifest is unavailable", async () => {
    getWatchSeoManifestMock.mockResolvedValueOnce(null)
    const { GET } = await import("./sitemap.xml/route")

    const response = await GET()

    expect(response.status).toBe(503)
    await expect(response.text()).resolves.toBe("Watch sitemap unavailable")
  })

  it("serves a child sitemap chunk", async () => {
    const { GET } = await import("./sitemap/[id]/route")

    const response = await GET(new Request("http://web.test/sitemap/0.xml"), {
      params: Promise.resolve({ id: "0.xml" }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/xml")
    const xml = await response.text()
    expect(xml).toContain("<urlset")
    expect(xml).toContain(
      "<loc>https://www.jesusfilm.org/watch/jesus.html/english.html</loc>",
    )
    expect(xml).toContain('hreflang="es"')
  })

  it("404s malformed and missing child sitemap chunks", async () => {
    const { GET } = await import("./sitemap/[id]/route")

    const malformed = await GET(new Request("http://web.test/sitemap/nope"), {
      params: Promise.resolve({ id: "nope" }),
    })
    const missing = await GET(new Request("http://web.test/sitemap/99.xml"), {
      params: Promise.resolve({ id: "99.xml" }),
    })

    expect(malformed.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(logWatchServerEventMock).not.toHaveBeenCalled()
  })

  it("returns 503 and logs bounded diagnostics for generation failures", async () => {
    getWatchSeoManifestMock.mockResolvedValue({
      ...manifest,
      videoRouteGroups: [
        manifest.videoRouteGroups[0],
        manifest.videoRouteGroups[0],
      ],
    })
    const indexRoute = await import("./sitemap.xml/route")
    const childRoute = await import("./sitemap/[id]/route")

    const indexResponse = await indexRoute.GET()
    const childResponse = await childRoute.GET(
      new Request("http://web.test/sitemap/0.xml"),
      {
        params: Promise.resolve({ id: "0.xml" }),
      },
    )

    expect(indexResponse.status).toBe(503)
    expect(childResponse.status).toBe(503)
    expect(logWatchServerEventMock).toHaveBeenNthCalledWith(
      1,
      "watch_sitemap.generation.failed",
      {
        actual: undefined,
        code: "duplicate_loc",
        limit: undefined,
        manifest_version: "version-1",
        route: "index",
      },
      { level: "error" },
    )
    expect(logWatchServerEventMock).toHaveBeenNthCalledWith(
      2,
      "watch_sitemap.generation.failed",
      {
        actual: undefined,
        chunk_id: 0,
        code: "duplicate_loc",
        limit: undefined,
        manifest_version: "version-1",
        route: "child",
      },
      { level: "error" },
    )
    expect(JSON.stringify(logWatchServerEventMock.mock.calls)).not.toContain(
      "https://www.jesusfilm.org/watch/jesus",
    )
  })
})
