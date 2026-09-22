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
    {
      contentSlug: "wedding-in-cana",
      alternates: [{ hreflang: "en", languageSlug: "english" }],
    },
  ],
  episodeRouteGroups: [
    {
      parentSlug: "lumo-the-gospel-of-john",
      childSlug: "wedding-in-cana",
      alternates: [{ hreflang: "en", languageSlug: "english" }],
    },
    {
      parentSlug: "the-life-of-jesus",
      childSlug: "wedding-in-cana",
      alternates: [{ hreflang: "en", languageSlug: "english" }],
    },
  ],
  skippedHreflangValues: {},
}

// Mirrors the production shape this bug is about: `jesus` is playable in
// languages whose BCP-47 tag has no Google-valid hreflang (`cebuano` -> `ceb`,
// `ilocano` -> null), and `pilipino-tagalog` has no hreflang-eligible sibling
// at all.
const longTailManifest: WatchSeoManifest = {
  version: "version-2",
  generatedAt: "2026-09-22T12:00:00.000Z",
  videoRouteGroups: [
    {
      contentSlug: "jesus",
      alternates: [
        { hreflang: "en", languageSlug: "english" },
        { hreflang: "es", languageSlug: "spanish-castilian" },
      ],
      languageSlugs: ["cebuano", "english", "ilocano", "spanish-castilian"],
    },
    {
      contentSlug: "magdalena",
      alternates: [],
      languageSlugs: ["pilipino-tagalog"],
    },
  ],
  episodeRouteGroups: [],
  skippedHreflangValues: {},
}

const expectedHomepageAlternates = [
  {
    hreflang: "en",
    languageSlug: "english",
    href: "https://www.jesusfilm.org/watch",
  },
  {
    hreflang: "en-GB",
    languageSlug: "english-british",
    href: "https://www.jesusfilm.org/watch/english-british.html",
  },
  {
    hreflang: "x-default",
    languageSlug: "english",
    href: "https://www.jesusfilm.org/watch",
  },
]

describe("watch sitemap rendering", () => {
  it("expands route groups into one self-inclusive entry per alternate URL", () => {
    const entries = createWatchSitemapEntries(manifest)

    expect(entries).toHaveLength(5)
    expect(entries[0]).toEqual({
      loc: "https://www.jesusfilm.org/watch/jesus.html",
      alternates: [
        {
          hreflang: "en",
          languageSlug: "english",
          href: "https://www.jesusfilm.org/watch/jesus.html",
        },
        {
          hreflang: "es",
          languageSlug: "spanish-castilian",
          href: "https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html",
        },
      ],
    })
    expect(entries[2]?.loc).toBe(
      "https://www.jesusfilm.org/watch/wedding-in-cana.html",
    )
    expect(entries.map(({ loc }) => loc)).not.toContain(
      "https://www.jesusfilm.org/watch/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    )
  })

  it("emits a canonical URL for every playable language, hreflang-eligible or not", () => {
    const entries = createWatchSitemapEntries(longTailManifest)

    expect(entries.slice(0, 5).map(({ loc }) => loc)).toEqual([
      // The hreflang cluster keeps its existing order and URLs.
      "https://www.jesusfilm.org/watch/jesus.html",
      "https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html",
      // The long tail the old alternates-only derivation deleted.
      "https://www.jesusfilm.org/watch/jesus.html/cebuano.html",
      "https://www.jesusfilm.org/watch/jesus.html/ilocano.html",
      "https://www.jesusfilm.org/watch/magdalena.html/pilipino-tagalog.html",
    ])
  })

  it("annotates only the hreflang cluster and leaves the long tail unannotated", () => {
    const entries = createWatchSitemapEntries(longTailManifest)
    const byLoc = new Map(entries.map((entry) => [entry.loc, entry.alternates]))

    // A URL with no Google-valid hreflang gets no `<xhtml:link>` at all.
    // Attaching the cluster's set to it would break reciprocity — the URL is
    // not in that set — and Google then ignores the whole cluster.
    expect(
      byLoc.get("https://www.jesusfilm.org/watch/jesus.html/cebuano.html"),
    ).toEqual([])
    expect(
      byLoc.get("https://www.jesusfilm.org/watch/jesus.html/ilocano.html"),
    ).toEqual([])
    expect(
      byLoc.get(
        "https://www.jesusfilm.org/watch/magdalena.html/pilipino-tagalog.html",
      ),
    ).toEqual([])
    expect(
      byLoc
        .get("https://www.jesusfilm.org/watch/jesus.html")
        ?.map(({ hreflang }) => hreflang),
    ).toEqual(["en", "es"])
  })

  it("renders long-tail canonical entries without xhtml alternate links", () => {
    const xml = renderWatchSitemapChunk(longTailManifest, 0) ?? ""

    expect(xml).toContain(
      "<url><loc>https://www.jesusfilm.org/watch/jesus.html/cebuano.html</loc></url>",
    )
    expect(xml).toContain(
      "<url><loc>https://www.jesusfilm.org/watch/magdalena.html/pilipino-tagalog.html</loc></url>",
    )
    expect(xml).toContain(
      'hreflang="es" href="https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html"',
    )
  })

  it("falls back to the alternate list when a snapshot omits languageSlugs", () => {
    // Pre-change admin snapshots carry no `languageSlugs`; web must keep
    // publishing exactly what it published before rather than emptying out.
    const entries = createWatchSitemapEntries(manifest)

    expect(entries.map(({ loc }) => loc)).toEqual([
      "https://www.jesusfilm.org/watch/jesus.html",
      "https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html",
      "https://www.jesusfilm.org/watch/wedding-in-cana.html",
      "https://www.jesusfilm.org/watch",
      "https://www.jesusfilm.org/watch/english-british.html",
    ])
  })

  it("chunks long-tail entries under the same byte and URL limits", () => {
    const chunks = getWatchSitemapChunks(longTailManifest, { maxUrls: 2 })
    const locs = chunks.flatMap((chunk) =>
      chunk.entries.map((entry) => entry.loc),
    )

    expect(chunks.every((chunk) => chunk.entries.length <= 2)).toBe(true)
    expect(locs).toContain(
      "https://www.jesusfilm.org/watch/jesus.html/cebuano.html",
    )
    expect(new Set(locs).size).toBe(locs.length)
  })

  it("adds reciprocal default and British-English homepage alternates", () => {
    const entries = createWatchSitemapEntries(manifest)
    const homepageEntries = entries.slice(-2)

    expect(homepageEntries).toEqual([
      {
        loc: "https://www.jesusfilm.org/watch",
        alternates: expectedHomepageAlternates,
      },
      {
        loc: "https://www.jesusfilm.org/watch/english-british.html",
        alternates: expectedHomepageAlternates,
      },
    ])
  })

  it("emits only home entries for a contextual-only manifest", () => {
    const entries = createWatchSitemapEntries({
      ...manifest,
      videoRouteGroups: [],
    })

    expect(entries).toHaveLength(2)
    expect(entries.map(({ loc }) => loc)).toEqual([
      "https://www.jesusfilm.org/watch",
      "https://www.jesusfilm.org/watch/english-british.html",
    ])
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
      "<loc>https://www.jesusfilm.org/watch/jesus.html</loc>",
    )
    expect(xml).toContain(
      'hreflang="es" href="https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html"',
    )
    expect(xml).not.toContain("bad slug")
  })

  it("keeps collision-owned English explicit while international URLs stay explicit", () => {
    const entries = createWatchSitemapEntries({
      ...manifest,
      videoRouteGroups: [
        {
          contentSlug: "russian",
          alternates: [
            { hreflang: "en", languageSlug: "english" },
            { hreflang: "ro", languageSlug: "romanian" },
          ],
        },
      ],
      episodeRouteGroups: [],
    })

    expect(entries.slice(0, 2).map(({ loc }) => loc)).toEqual([
      "https://www.jesusfilm.org/watch/russian.html/english.html",
      "https://www.jesusfilm.org/watch/russian.html/romanian.html",
    ])
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
    expect(getWatchSitemapChunks(manifest, { maxUrls: 1 })).toHaveLength(5)
    const byteChunks = getWatchSitemapChunks(manifest, { maxBytes: 600 })
    expect(byteChunks.length).toBeGreaterThan(1)
    expect(byteChunks.every((chunk) => chunk.bytes <= 600)).toBe(true)
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
    const chunks = getWatchSitemapChunks(longTailManifest, { maxUrls: 1 })
    const entries = chunks.flatMap((chunk) => chunk.entries)
    const alternatesByLoc = new Map(
      entries.map((entry) => [
        entry.loc,
        [...entry.alternatesXml.matchAll(/href="([^"]+)"/g)].map(
          (match) => match[1],
        ),
      ]),
    )
    const annotatedLocs = [...alternatesByLoc].filter(
      ([, alternates]) => alternates.length > 0,
    )

    // Every annotated URL is still in its own set and publishes the same set as
    // every URL it points at — the invariant the long tail must not weaken.
    expect(annotatedLocs.length).toBeGreaterThan(0)
    for (const [loc, alternates] of annotatedLocs) {
      expect(alternates).toContain(loc)
      for (const alternate of alternates) {
        expect(alternatesByLoc.get(alternate)).toEqual(alternates)
      }
    }
    // The long tail carries no annotations, so it cannot break reciprocity.
    expect(
      alternatesByLoc.get(
        "https://www.jesusfilm.org/watch/jesus.html/cebuano.html",
      ),
    ).toEqual([])
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
