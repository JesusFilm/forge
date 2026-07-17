import { beforeEach, describe, expect, it, vi } from "vitest"

const getWatchSeoManifestMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/watch-seo-manifest", () => ({
  getWatchSeoManifest: getWatchSeoManifestMock,
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
  })
})
