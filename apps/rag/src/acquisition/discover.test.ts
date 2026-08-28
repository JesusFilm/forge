/**
 * Discovery-crawl unit tests — fakes only (FakeFetcher), no network. Canned
 * sitemap XML exercises sitemapindex recursion, the allow/block/articleHints
 * filters, de-dup, the maxPages cap, the cycle guard, and a 404 sitemap skip.
 */
import { describe, expect, it } from "vitest"
import type { CrawlPolicy } from "../registry/index.js"
import type { FetchResult } from "../contracts/index.js"
import { FakeFetcher } from "../fakes/index.js"
import { discoverUrls } from "./discover.js"

const ok = (body: string): FetchResult => ({
  status: 200,
  body,
  etag: null,
  lastModified: null,
  notModified: false,
})

const urlset = (...locs: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((l) => `  <url><loc>${l}</loc></url>`).join("\n")}
</urlset>`

const sitemapIndex = (...locs: string[]): string =>
  `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${locs.map((l) => `  <sitemap><loc>${l}</loc></sitemap>`).join("\n")}
</sitemapindex>`

const policy = (over: Partial<CrawlPolicy> = {}): CrawlPolicy => ({
  baseUrl: "https://example.org",
  sitemaps: ["/sitemap_index.xml"],
  allow: ["^https://example\\.org/"],
  articleHints: ["/learn/", "/blog/"],
  block: ["/donate", "\\.pdf$"],
  contentSelectors: ["main"],
  stripSelectors: [],
  requestDelayMs: 0,
  maxPages: 50,
  minContentLength: 250,
  ...over,
})

describe("discoverUrls", () => {
  it("recurses a sitemap index and applies allow/block/articleHints + de-dup", async () => {
    const fetcher = new FakeFetcher()
      .set(
        "https://example.org/sitemap_index.xml",
        ok(sitemapIndex("https://example.org/sitemap-pages.xml")),
      )
      .set(
        "https://example.org/sitemap-pages.xml",
        ok(
          urlset(
            "https://example.org/learn/what-is-faith",
            "https://example.org/blog/a-story",
            "https://example.org/donate", // blocked
            "https://example.org/resources/guide.pdf", // blocked (asset)
            "https://example.org/about/team", // not an article hint
            "https://other.org/learn/elsewhere", // off-allow
            "https://example.org/learn/what-is-faith", // duplicate
          ),
        ),
      )

    const result = await discoverUrls({ fetcher }, policy())

    expect(result.urls).toEqual([
      "https://example.org/learn/what-is-faith",
      "https://example.org/blog/a-story",
    ])
    expect(result.sitemapsFetched).toBe(2) // index + one child
    expect(result.totalSeen).toBe(7) // pre-filter page locs (dup counted)
  })

  it("caps the result at maxPages", async () => {
    const fetcher = new FakeFetcher().set(
      "https://example.org/sitemap_index.xml",
      ok(
        urlset(
          "https://example.org/learn/a",
          "https://example.org/learn/b",
          "https://example.org/learn/c",
        ),
      ),
    )
    const result = await discoverUrls({ fetcher }, policy({ maxPages: 2 }))
    expect(result.urls).toHaveLength(2)
  })

  it("keeps everything when no allow/hints are set (block still applies)", async () => {
    const fetcher = new FakeFetcher().set(
      "https://example.org/sitemap_index.xml",
      ok(
        urlset(
          "https://example.org/anything",
          "https://example.org/donate", // still blocked
        ),
      ),
    )
    const result = await discoverUrls(
      { fetcher },
      policy({ allow: [], articleHints: [] }),
    )
    expect(result.urls).toEqual(["https://example.org/anything"])
  })

  it("does not re-fetch an already-seen sitemap (cycle guard)", async () => {
    const fetcher = new FakeFetcher().set(
      "https://example.org/sitemap_index.xml",
      ok(
        sitemapIndex(
          "https://example.org/sitemap_index.xml", // self-reference
          "https://example.org/sitemap-pages.xml",
          "https://example.org/sitemap-pages.xml", // duplicate child
        ),
      ),
    )
    fetcher.set(
      "https://example.org/sitemap-pages.xml",
      ok(urlset("https://example.org/learn/x")),
    )
    const result = await discoverUrls({ fetcher }, policy())
    expect(result.sitemapsFetched).toBe(2) // index once + child once
    expect(result.urls).toEqual(["https://example.org/learn/x"])
  })

  it("skips a sitemap that fails to fetch and continues", async () => {
    const fetcher = new FakeFetcher().set(
      "https://example.org/sitemap_index.xml",
      ok(
        sitemapIndex(
          "https://example.org/missing.xml", // 404 (unseeded)
          "https://example.org/sitemap-pages.xml",
        ),
      ),
    )
    fetcher.set(
      "https://example.org/sitemap-pages.xml",
      ok(urlset("https://example.org/learn/x")),
    )
    const result = await discoverUrls({ fetcher }, policy())
    expect(result.urls).toEqual(["https://example.org/learn/x"])
    expect(result.sitemapsFetched).toBe(3) // index + missing + pages
  })
})
