/**
 * The `everystudent-ur` registry entry — EveryStudent's Urdu domain
 * (zindagikaysawalat.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-fa.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the XML sitemap and the site's
 *     own HTML map agree on all 33 articles with zero delta either way;
 *   - `contentSelectors: [".contentpadding"]` and NOTHING else — `.content4`
 *     matches on 32 of 33 articles and extracts 0 chars, so listing it would
 *     shadow the real container and silently ingest nothing;
 *   - `/a/` only — `/a/fol.html`, the `/m/` indexes, the contact form and the
 *     homepage all clear the 250-char floor, so `minContentLength` could never
 *     have excluded them.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const ur = (): SourceEntry => getSource("everystudent-ur")!
const HOST = "https://www.zindagikaysawalat.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = ur().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-ur registry entry", () => {
  it("resolves everystudent-ur as an UNWALLED Urdu source crawled over plain HTTP", () => {
    const entry = ur()
    // The apex 301s to www (measured on /robots.txt and /sitemap.xml), and every
    // <loc> uses www — so the host, baseUrl and every regex must be pinned to it.
    expect(entry.domain).toBe("www.zindagikaysawalat.com")
    expect(entry.crawl.baseUrl).toBe(HOST)
    expect(entry.languages).toEqual(["ur"])
    // Verified 2026-07-29: ~60 plain-HTTP GETs (all 42 sitemap URLs plus probes)
    // against bare `server: Apache`, with 0 Cloudflare block-page signatures.
    // Declaring a strategy here would bill every page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, not a hand-listed seed set", () => {
    const entry = ur()
    // /sitemap.xml answered 200 (3,490 bytes, 42 <loc>, all distinct). The site's
    // own HTML map, /m/sitemap.html, lists 33 /a/ links and the diff is ZERO in
    // both directions, so there is nothing to pin as a seed. A link harvest over
    // all 42 pages found exactly one extra /a/ URL — /a/fol.html — and it is a
    // signup page, blocked below.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(42) // 42 sitemap URLs
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. zindagikaysawalat.com is its own domain, so the
    // Urdu content must not be folded into `everystudent` as a second language —
    // the same rule that keeps thelife-fr / thelife-zh separate. It is also a
    // distinct key from the other two Arabic-script banners.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(ur().domain)
    expect(ur().key).toBe("everystudent-ur")
    expect(ur().key).toMatch(/^[a-z0-9-]+$/)
    const arabicScript = [
      "everystudent-ar",
      "everystudent-fa",
      "everystudent-ur",
    ]
    expect(new Set(arabicScript.map((k) => getSource(k)!.domain)).size).toBe(3)
  })

  it("keeps /a/ articles and drops the signup page, indexes, contact form and homepage", () => {
    expect(keeps(`${HOST}/a/isthere.html`)).toBe(true)
    // A genuine article despite its slug: "Why can you believe the Bible?" is
    // apologetics, not Bible text. This host serves no Scripture at all —
    // /j/j1.html, /a/yuhanna.html and /a/john.html are 404 — so unlike -es, -sq
    // and -fa there is no full Gospel to exclude under the scripture policy.
    expect(keeps(`${HOST}/a/bible.html`)).toBe(true)
    // /a/fol.html MATCHES articleHints and extracts 604 chars, so neither the
    // hint regex nor the 250 floor excludes it — only this URL block does. It is
    // the "Starting with God" post-decision signup that hands off to
    // khudakaysathagaaz.com, and it is absent from today's crawler-generated
    // sitemap, so the block is what makes discovery safe rather than lucky.
    expect(keeps(`${HOST}/a/fol.html`)).toBe(false)
    // The 7 section indexes extract 448-973 chars via the <body> fallback and
    // /m/about.html 641 via .contentpadding — all above the floor. The same rule
    // covers /m/sitemap.html (1,195 ch site plan, itself absent from the XML
    // sitemap) and /m/forum.html, the one sitemap URL that 301s to the homepage.
    expect(keeps(`${HOST}/m/exi.html`)).toBe(false)
    expect(keeps(`${HOST}/m/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/m/forum.html`)).toBe(false)
    // Contact chrome: 354 chars, ABOVE the 250 floor by 104.
    expect(keeps(`${HOST}/contact.html`)).toBe(false)
    // The homepage does NOT extract to 0 — with no .contentpadding present the
    // <body> fallback yields 818 chars of teaser list.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(ur().crawl.minContentLength).toBe(250)
  })

  it("scopes to .contentpadding alone and never lets the empty .content4 shadow it", () => {
    const { contentSelectors } = ur().crawl
    // Measured 2026-07-29 with the repo's own extractContent over all 33
    // articles: `.contentpadding` binds on 32 and yields 1,520-21,041 chars,
    // while `.content4` binds on those same 32 and yields 0 chars every time.
    // extractContent scopes to the first selector that MATCHES AN ELEMENT, not
    // the first that yields text, so adding `.content4` "as a fallback" would win
    // and return "" — every article skipping `too-thin` on an HTTP 200, invisible
    // to these tests. That is how five of the eight pilot entries shipped (#128).
    // `.content4b` / `.container2` exist only on /a/bible.html and also yield 0.
    // The `"html"` fallback is a deliberate LAST entry (orchestrator, 2026-07-29):
    // it is only ever consulted when the primary misses, so it cannot shadow
    // anything, and it beats extract.ts's implicit `?? root` because <html> is a
    // real element and so carries no literal "<!DOCTYPE html>" text node. What
    // must never change is the FIRST entry, and the absence of `.content4`.
    expect(contentSelectors).toEqual([".contentpadding", "html"])
    expect(contentSelectors[0]).toBe(".contentpadding")
    expect(contentSelectors).not.toContain(".content4")
  })

  it("strips the chrome measured on this host, including the root-fallback <head>", () => {
    const strip = ur().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 68 instances, removing 97-784 chars on 33/33 pages: cookie bar, top and
    // bottom nav, sidebar and footer. The missing leading "." is correct.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA cells, 164 instances. Marginal 0 on 32 pages (their
    // CTA sits inside sitelevel_noindex) but 112 chars on /a/fourlaws.html, where
    // nothing else removes them — so it is not a no-op. .fctable holds the shell.
    expect(strip).toContain(".fccell")
    expect(strip).toContain(".fctable")
    // Load-bearing only on /a/bible.html, whose <h2 class="subhead"> is closed
    // with </em></h1>; the mismatch dissolves the div stack so the container
    // falls back to the document root, where <head> would add a duplicate title
    // (37 chars). Safe only because extract.ts reads the title from `root` BEFORE
    // the strip loop — a future edit reordering those two steps would lose it.
    expect(strip).toContain("head")
  })
})
