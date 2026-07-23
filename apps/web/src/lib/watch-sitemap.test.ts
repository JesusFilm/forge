import { describe, expect, it } from "vitest"

import {
  DEFAULT_MAX_SITEMAP_BYTES,
  DEFAULT_MAX_SITEMAP_URLS,
  WatchSitemapGenerationError,
  createWatchSitemapEntries,
  getWatchSitemapChunks,
  normalizeWatchSitemapChunkId,
  renderWatchSitemapChunk,
  renderWatchSitemapIndex,
  watchSitemapChunkUrl,
} from "./watch-sitemap"
import type { WatchSeoManifest } from "./watch-seo-manifest"

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
    {
      contentSlug: "bad slug",
      alternates: [{ hreflang: "fr", languageSlug: "french" }],
    },
  ],
  episodeRouteGroups: [
    {
      parentSlug: "lumo-the-gospel-of-john",
      childSlug: "wedding-in-cana",
      alternates: [{ hreflang: "en", languageSlug: "english" }],
    },
  ],
  skippedHreflangValues: {},
}

describe("watch sitemap rendering", () => {
  it("expands route groups into one self-inclusive entry per alternate URL", () => {
    const entries = createWatchSitemapEntries(manifest)

    expect(entries).toHaveLength(3)
    expect(entries[0]).toEqual({
      loc: "https://www.jesusfilm.org/watch/jesus.html/english.html",
      alternates: [
        {
          hreflang: "en",
          languageSlug: "english",
          href: "https://www.jesusfilm.org/watch/jesus.html/english.html",
        },
        {
          hreflang: "es",
          languageSlug: "spanish-castilian",
          href: "https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html",
        },
      ],
    })
    expect(entries[2]?.loc).toBe(
      "https://www.jesusfilm.org/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    )
  })

  it("renders a sitemap index with canonical child sitemap URLs", () => {
    const xml = renderWatchSitemapIndex(manifest, { maxUrls: 1 })

    expect(xml).toContain("<sitemapindex")
    expect(xml).toContain(
      "<loc>https://www.jesusfilm.org/watch/sitemap/0.xml</loc>",
    )
    expect(xml).toContain(
      "<loc>https://www.jesusfilm.org/watch/sitemap/1.xml</loc>",
    )
    expect(xml).toContain(
      "<loc>https://www.jesusfilm.org/watch/sitemap/2.xml</loc>",
    )
  })

  it("renders child sitemap XML with xhtml alternate links", () => {
    const xml = renderWatchSitemapChunk(manifest, 0)

    expect(xml).toContain("<urlset")
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
    expect(xml).toContain(
      "<loc>https://www.jesusfilm.org/watch/jesus.html/english.html</loc>",
    )
    expect(xml).toContain(
      'hreflang="es" href="https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html"',
    )
    expect(xml).not.toContain("bad slug")
  })

  it("escapes XML attribute and text values", () => {
    const xml = renderWatchSitemapChunk(
      {
        ...manifest,
        videoRouteGroups: [
          {
            contentSlug: "jesus",
            alternates: [{ hreflang: 'en"bad', languageSlug: "english" }],
          },
        ],
        episodeRouteGroups: [],
      },
      0,
    )

    expect(xml).toContain("en&quot;bad")
  })

  it("splits chunks by URL count and serialized byte limits", () => {
    expect(getWatchSitemapChunks(manifest, { maxUrls: 1 })).toHaveLength(3)
    expect(getWatchSitemapChunks(manifest, { maxBytes: 600 })).toHaveLength(3)
  })

  it("uses safety ceilings below search-engine hard limits", () => {
    expect(DEFAULT_MAX_SITEMAP_BYTES).toBe(35_000_000)
    expect(DEFAULT_MAX_SITEMAP_URLS).toBe(49_999)
  })

  it("counts escaped multibyte values as serialized UTF-8 bytes", () => {
    const multibyteManifest: WatchSeoManifest = {
      ...manifest,
      videoRouteGroups: [
        {
          contentSlug: "jesus",
          alternates: [
            { hreflang: "français", languageSlug: "french" },
            { hreflang: "日本語", languageSlug: "japanese" },
          ],
        },
      ],
      episodeRouteGroups: [],
    }

    const [chunk] = getWatchSitemapChunks(multibyteManifest, {
      maxBytes: 1_000,
    })
    const xml = renderWatchSitemapChunk(multibyteManifest, 0, {
      maxBytes: 1_000,
    })

    expect(chunk?.bytes).toBe(Buffer.byteLength(xml ?? "", "utf8"))
    expect(chunk?.bytes).toBeGreaterThan(xml?.length ?? 0)
  })

  it("rejects invalid limits and entries that cannot fit", () => {
    expect(() => getWatchSitemapChunks(manifest, { maxBytes: 0 })).toThrowError(
      expect.objectContaining<Partial<WatchSitemapGenerationError>>({
        code: "invalid_max_bytes",
      }),
    )
    expect(() => getWatchSitemapChunks(manifest, { maxUrls: 0 })).toThrowError(
      expect.objectContaining<Partial<WatchSitemapGenerationError>>({
        code: "invalid_max_urls",
      }),
    )
    expect(() =>
      getWatchSitemapChunks(manifest, { maxBytes: 200 }),
    ).toThrowError(
      expect.objectContaining<Partial<WatchSitemapGenerationError>>({
        code: "entry_exceeds_max_bytes",
      }),
    )
  })

  it("rejects duplicate canonical URLs across route groups", () => {
    expect(() =>
      getWatchSitemapChunks({
        ...manifest,
        videoRouteGroups: [
          manifest.videoRouteGroups[0]!,
          manifest.videoRouteGroups[0]!,
        ],
        episodeRouteGroups: [],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<WatchSitemapGenerationError>>({
        code: "duplicate_loc",
      }),
    )
  })

  it("keeps complete reciprocal alternate sets across chunk boundaries", () => {
    const chunks = getWatchSitemapChunks(manifest, { maxUrls: 1 })
    const entries = chunks.flatMap((chunk) => chunk.entries)
    const alternatesByLoc = new Map(
      entries.map((entry) => [
        entry.loc,
        [...entry.alternatesXml.matchAll(/href="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      ]),
    )

    for (const [loc, alternates] of alternatesByLoc) {
      expect(alternates).toContain(loc)
      for (const alternate of alternates) {
        expect(alternatesByLoc.get(alternate)).toEqual(alternates)
      }
    }
  })

  it("shares repeated alternate XML within a route group while chunking", () => {
    const chunks = getWatchSitemapChunks(manifest)
    const [first, second] = chunks[0]?.entries ?? []

    expect(first?.alternatesXml).toBe(second?.alternatesXml)
  })

  it("normalizes numeric chunk ids and rejects unsafe ids", () => {
    expect(normalizeWatchSitemapChunkId("12")).toBe(12)
    expect(normalizeWatchSitemapChunkId("12.xml")).toBe(12)
    expect(normalizeWatchSitemapChunkId("../12.xml")).toBeNull()
    expect(normalizeWatchSitemapChunkId("abc.xml")).toBeNull()
  })

  it("returns null for missing chunks", () => {
    expect(renderWatchSitemapChunk(manifest, 99)).toBeNull()
  })

  it("uses the canonical sitemap child path", () => {
    expect(watchSitemapChunkUrl(5)).toBe(
      "https://www.jesusfilm.org/watch/sitemap/5.xml",
    )
  })
})
