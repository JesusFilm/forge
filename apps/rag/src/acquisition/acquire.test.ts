/* eslint-disable max-lines -- acquisition invariants are kept in one behavior-preservation suite */
/**
 * Acquisition unit tests — fakes only (FakeFetcher serving canned HTML), no
 * network. Covers the three things Acquisition must get right: normalizeUrl is
 * the deterministic dedup identity (invariant 2), extraction yields article
 * text with nav/sidebar/footer stripped + entities decoded, and acquireOne
 * assembles a faithful RawDocument (or a typed skip) over the injected Fetcher.
 */
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { FetchResult, Fetcher } from "../contracts/index.js"
import type { SourceEntry } from "../registry/index.js"
import { FakeFetcher, FakeRawDocumentStore } from "../fakes/index.js"
import {
  acquireOne,
  acquireSource,
  extractContent,
  normalizeUrl,
} from "./index.js"

const PAGE = `<!doctype html><html><head><title>The Nature of Faith | Starting With God</title></head>
<body>
  <nav class="nav1"><a href="/">Home</a><a href="/about.html">About</a></nav>
  <div id="content">
    <h1>The Nature of Faith</h1>
    <p>Faith is central to all of life &#8212; we exercise it daily.</p>
    <p>It isn&#8217;t blind; it rests on what is trustworthy.</p>
  </div>
  <div id="sidebar"><a href="/donate/">Donate now</a></div>
  <div class="footer">Copyright Starting With God</div>
  <script>var x = 1;</script>
</body></html>`

const entry: SourceEntry = {
  key: "test-src",
  name: "Test Source",
  domain: "example.com",
  trust: "trusted",
  ingestionMode: "html-scrape",
  languages: ["en"],
  defaultTags: [],
  defaultCategory: "article",
  rights: null,
  crawl: {
    baseUrl: "https://example.com",
    seedPaths: ["/a.html"],
    contentSelectors: ["#content"],
    stripSelectors: ["script", "nav", "#sidebar", ".footer"],
    requestDelayMs: 0,
    maxPages: 10,
    minContentLength: 20,
  },
}

const ok = (body: string): FetchResult => ({
  status: 200,
  body,
  etag: '"v1"',
  lastModified: null,
  notModified: false,
})

describe("normalizeUrl (invariant 2)", () => {
  it("strips fragment + tracking params, lowercases host, trims trailing slash", () => {
    expect(
      normalizeUrl(
        "https://WWW.Example.com/Path/?utm_source=x&gclid=1&keep=2#frag",
      ),
    ).toBe("https://www.example.com/Path?keep=2")
    expect(normalizeUrl("https://example.com/a/b/")).toBe(
      "https://example.com/a/b",
    )
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/") // root slash kept
    expect(normalizeUrl("https://example.com/x?ref=y&fbclid=z")).toBe(
      "https://example.com/x",
    )
  })

  it("is deterministic (idempotent)", () => {
    const once = normalizeUrl("https://example.com/p/?utm_medium=a#h")
    expect(normalizeUrl(once)).toBe(once)
  })
})

describe("extractContent", () => {
  it("returns title + article text, dropping nav/sidebar/footer/script and decoding entities", () => {
    const { title, text } = extractContent(PAGE, entry.crawl)
    expect(title).toBe("The Nature of Faith") // site suffix trimmed
    expect(text).toContain("Faith is central to all of life")
    expect(text).toContain("isn’t blind") // &#8217; decoded; em-dash &#8212; too
    expect(text).toContain("—")
    expect(text).not.toContain("Donate now")
    expect(text).not.toContain("Copyright")
    expect(text).not.toMatch(/Home|About/)
    expect(text).not.toContain("var x")
  })

  it("keeps paragraph breaks between blocks", () => {
    const { text } = extractContent(PAGE, entry.crawl)
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(2)
  })

  it("does not truncate a title whose final word is hyphenated", () => {
    // Only a spaced " | Site" / " - Site" suffix is stripped; a word-internal
    // hyphen ("Self-Aware") must survive.
    const hyphen = `<html><head><title>How to be Self-Aware</title></head><body><div id="content"><p>${"word ".repeat(10)}</p></div></body></html>`
    expect(extractContent(hyphen, entry.crawl).title).toBe(
      "How to be Self-Aware",
    )

    const suffixed = `<html><head><title>Becoming Christ-Centered | Starting With God</title></head><body><div id="content"><p>${"word ".repeat(10)}</p></div></body></html>`
    expect(extractContent(suffixed, entry.crawl).title).toBe(
      "Becoming Christ-Centered",
    )
  })
})

describe("acquireOne", () => {
  it("assembles a RawDocument with normalized canonicalUrl and a sha256 bodyHash", async () => {
    const fetchUrl = "https://example.com/a.html?utm_source=nl#top"
    const fetcher = new FakeFetcher({ [fetchUrl]: ok(PAGE) })
    const out = await acquireOne(fetcher, entry, fetchUrl)

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.doc.sourceKey).toBe("test-src")
    expect(out.doc.url).toBe(fetchUrl)
    expect(out.doc.canonicalUrl).toBe("https://example.com/a.html") // utm + fragment stripped
    expect(out.doc.title).toBe("The Nature of Faith")
    expect(out.doc.rawContent).toContain("Faith is central")
    expect(out.doc.fetch.status).toBe(200)
    expect(out.doc.fetch.bodyHash).toBe(
      createHash("sha256").update(PAGE).digest("hex"),
    )
    expect(out.doc.fetch.etag).toBe('"v1"')
    expect(Number.isNaN(Date.parse(out.doc.fetch.fetchedAt))).toBe(false)
  })

  it("skips on non-OK, not-modified, and too-thin content", async () => {
    const fetcher = new FakeFetcher({
      "https://example.com/missing.html": {
        status: 404,
        body: null,
        etag: null,
        lastModified: null,
        notModified: false,
      },
      "https://example.com/304.html": {
        status: 304,
        body: null,
        etag: null,
        lastModified: null,
        notModified: true,
      },
      "https://example.com/thin.html": ok(
        '<html><body><div id="content"><p>hi</p></div></body></html>',
      ),
    })

    expect(
      await acquireOne(fetcher, entry, "https://example.com/missing.html"),
    ).toMatchObject({
      ok: false,
      reason: "fetch-failed",
    })
    expect(
      await acquireOne(fetcher, entry, "https://example.com/304.html"),
    ).toMatchObject({
      ok: false,
      reason: "not-modified",
    })
    expect(
      await acquireOne(fetcher, entry, "https://example.com/thin.html"),
    ).toMatchObject({
      ok: false,
      reason: "too-thin",
    })
  })
})

describe("acquireSource", () => {
  const multi: SourceEntry = {
    ...entry,
    crawl: {
      ...entry.crawl,
      baseUrl: "https://t.example",
      requestDelayMs: 0, // no real waiting in tests
      seedPaths: ["/a.html", "/b.html", "/missing.html"],
    },
  }

  it("walks seed URLs, stages ok docs, and tallies skips", async () => {
    const fetcher = new FakeFetcher({
      "https://t.example/a.html": ok(PAGE),
      "https://t.example/b.html": ok(PAGE),
      // /missing.html unseeded → FakeFetcher returns 404 → fetch-failed
    })
    const store = new FakeRawDocumentStore()

    const summary = await acquireSource({ fetcher, store }, multi)

    expect(summary.attempted).toBe(3)
    expect(summary.written).toBe(2)
    expect(summary.skipped["fetch-failed"]).toBe(1)
    expect(store.count()).toBe(2)
    expect(
      store
        .bySourceKey("test-src")
        .map((d) => d.canonicalUrl)
        .sort(),
    ).toEqual(["https://t.example/a.html", "https://t.example/b.html"])
  })

  it("treats a thrown fetch (network/timeout) as a skip and keeps crawling", async () => {
    const throwing: Fetcher = {
      async fetch(url: string): Promise<FetchResult> {
        if (url === "https://t.example/b.html") throw new Error("ETIMEDOUT")
        return ok(PAGE)
      },
    }
    const store = new FakeRawDocumentStore()

    const summary = await acquireSource({ fetcher: throwing, store }, multi)

    expect(summary.attempted).toBe(3)
    expect(summary.written).toBe(2) // a.html + missing.html still acquired
    expect(summary.skipped["fetch-failed"]).toBe(1) // b.html threw, did not abort
    expect(store.count()).toBe(2) // proves the crawl continued past the throw
  })

  it("honors maxPages as a hard cap", async () => {
    const capped: SourceEntry = {
      ...multi,
      crawl: { ...multi.crawl, maxPages: 1 },
    }
    const fetcher = new FakeFetcher({ "https://t.example/a.html": ok(PAGE) })
    const summary = await acquireSource(
      { fetcher, store: new FakeRawDocumentStore() },
      capped,
    )
    expect(summary.attempted).toBe(1)
    expect(summary.written).toBe(1)
  })

  it("discovers URLs from a sitemap, then acquires only the discovered pages", async () => {
    const discovery: SourceEntry = {
      ...entry,
      crawl: {
        ...entry.crawl,
        baseUrl: "https://d.example",
        seedPaths: undefined, // pure discovery source
        sitemaps: ["/sitemap.xml"],
        allow: ["^https://d\\.example/"],
        articleHints: ["/learn/"],
        block: ["/donate"],
      },
    }
    const fetcher = new FakeFetcher({
      "https://d.example/sitemap.xml": ok(
        `<?xml version="1.0"?><urlset>
          <url><loc>https://d.example/learn/one</loc></url>
          <url><loc>https://d.example/learn/two</loc></url>
          <url><loc>https://d.example/donate</loc></url>
        </urlset>`,
      ),
      "https://d.example/learn/one": ok(PAGE),
      "https://d.example/learn/two": ok(PAGE),
    })
    const store = new FakeRawDocumentStore()

    const summary = await acquireSource({ fetcher, store }, discovery)

    // /donate dropped at discovery; the sitemap fetch is not an "attempt".
    expect(summary.attempted).toBe(2)
    expect(summary.written).toBe(2)
    expect(
      store
        .bySourceKey("test-src")
        .map((d) => d.canonicalUrl)
        .sort(),
    ).toEqual(["https://d.example/learn/one", "https://d.example/learn/two"])
  })

  it("dryRun resolves the URL list without fetching or staging anything", async () => {
    const fetcher = new FakeFetcher({
      "https://t.example/a.html": ok(PAGE),
      "https://t.example/b.html": ok(PAGE),
    })
    const store = new FakeRawDocumentStore()

    const summary = await acquireSource({ fetcher, store }, multi, {
      dryRun: true,
    })

    expect(summary.resolved).toBe(3) // a.html, b.html, missing.html resolved from seeds
    expect(summary.attempted).toBe(0) // nothing fetched
    expect(summary.written).toBe(0)
    expect(store.count()).toBe(0) // nothing staged
  })

  it("with resume, skips canonical URLs already staged and fetches only the remainder", async () => {
    const fetcher = new FakeFetcher({
      "https://t.example/a.html": ok(PAGE),
      "https://t.example/b.html": ok(PAGE),
    })
    const store = new FakeRawDocumentStore()
    // Simulate a prior (interrupted) run that already staged a.html.
    await store.putRawDocument({
      sourceKey: "test-src",
      url: "https://t.example/a.html",
      canonicalUrl: "https://t.example/a.html",
      title: "prior",
      rawContent: "prior content",
      fetch: {
        status: 200,
        bodyHash: "deadbeef",
        etag: null,
        lastModified: null,
        fetchedAt: new Date(0).toISOString(),
        notModified: false,
      },
    })

    const resumable: SourceEntry = {
      ...multi,
      crawl: { ...multi.crawl, seedPaths: ["/a.html", "/b.html"] },
    }
    const summary = await acquireSource({ fetcher, store }, resumable, {
      resume: true,
    })

    expect(summary.resolved).toBe(1) // a.html dropped as already-staged
    expect(summary.attempted).toBe(1) // only b.html fetched
    expect(summary.written).toBe(1)
    // Both rows present (a.html from the prior run, b.html from this run) — a
    // restart re-fetched nothing it already had.
    expect(
      store
        .bySourceKey("test-src")
        .map((d) => d.canonicalUrl)
        .sort(),
    ).toEqual(["https://t.example/a.html", "https://t.example/b.html"])
  })

  it("with resume, backfills past already-staged URLs so the cap bounds remaining work", async () => {
    // Pure-discovery source: 3 sitemap URLs, maxPages=2, /learn/one already
    // staged by a prior interrupted run. The cap must bound the work that
    // REMAINS, so /learn/two AND /learn/three resolve (2). Capping discovery
    // before the resume-skip would yield only 1 (the bug).
    const discovery: SourceEntry = {
      ...entry,
      crawl: {
        ...entry.crawl,
        baseUrl: "https://cap.example",
        seedPaths: undefined,
        sitemaps: ["/sitemap.xml"],
        allow: ["^https://cap\\.example/"],
        articleHints: ["/learn/"],
        maxPages: 2,
      },
    }
    const fetcher = new FakeFetcher({
      "https://cap.example/sitemap.xml": ok(
        `<?xml version="1.0"?><urlset>
          <url><loc>https://cap.example/learn/one</loc></url>
          <url><loc>https://cap.example/learn/two</loc></url>
          <url><loc>https://cap.example/learn/three</loc></url>
        </urlset>`,
      ),
    })
    const store = new FakeRawDocumentStore()
    const u1 = "https://cap.example/learn/one" // staged by a prior interrupted run
    await store.putRawDocument({
      sourceKey: "test-src",
      url: u1,
      canonicalUrl: u1,
      title: "prior",
      rawContent: "prior content",
      fetch: {
        status: 200,
        bodyHash: "x",
        etag: null,
        lastModified: null,
        fetchedAt: new Date(0).toISOString(),
        notModified: false,
      },
    })

    const summary = await acquireSource({ fetcher, store }, discovery, {
      resume: true,
      dryRun: true,
    })
    expect(summary.resolved).toBe(2) // two + three; one already staged, cap bounds remainder
  })
})
