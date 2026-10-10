/**
 * The `everystudent-ta` registry entry — EveryStudent's Tamil domain
 * (ungalthervuenna.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-sq.test.ts` / `everystudent-pl.test.ts`.
 *
 * Each guard below pins a decision that took live measurement on 2026-07-30 to
 * reach, so a future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds — and specifically NOT seeding the three
 *     `/a/` URLs the site's own nav links, because all three are 404;
 *   - `contentSelectors: ["html"]` and nothing else — `.content4` MATCHES on
 *     31/31 articles and extracts 0 chars, so listing it anywhere shadows the
 *     real container and ingests nothing;
 *   - `/a/` only — the `/m/` indexes, `/contact.html` and the homepage all clear
 *     the 250-char floor, so `minContentLength` could never have excluded them;
 *   - the strip list, which is what makes an `<html>` container usable at all.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const ta = (): SourceEntry => getSource("everystudent-ta")!
const HOST = "https://www.ungalthervuenna.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = ta().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-ta registry entry", () => {
  it("resolves everystudent-ta as an UNWALLED Tamil source crawled over plain HTTP", () => {
    const entry = ta()
    // Canonicalisation was checked BOTH ways: the apex 301s to `www` over http
    // and https alike, and nothing redirects toward the apex (unlike
    // everystudent.sk). Every sitemap <loc> uses this host, and the filters
    // match the full absolute URL — pin the wrong one and every filter misses.
    expect(entry.domain).toBe("www.ungalthervuenna.com")
    expect(entry.crawl.baseUrl).toBe(`${HOST}`)
    expect(entry.languages).toEqual(["ta"])
    // Verified 2026-07-30 over ~90 plain-HTTP GETs: bare Apache, no Cloudflare
    // layer at all, no block-page signature anywhere. Declaring a strategy here
    // would bill every page for a wall that does not exist.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, with nothing pinned as a seed", () => {
    const entry = ta()
    // /sitemap.xml answered 200 (3,298 bytes, 40 <loc>, all distinct, all live).
    // /sitemap_index.xml is 404, so there is no larger Yoast inventory hiding
    // behind the flat file — the everystudent.sk fossil trap does not apply.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.maxPages).toBeGreaterThan(40) // 40 sitemap URLs
    // The site's own nav links three /a/ URLs the sitemap lacks — addiction,
    // created, gaylesbian — and ALL THREE return 404. They are dead nav links,
    // not articles the sitemap forgot, so there is deliberately nothing to pin.
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. ungalthervuenna.com is its own domain, so the
    // Tamil content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(ta().domain)
    expect(ta().key).toBe("everystudent-ta")
    expect(ta().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("keeps the 31 /a/ articles and drops the indexes, contact page, homepage and dead links", () => {
    // The sitemap publishes https:// <loc> values and discover.ts filters the
    // RAW string, so an http-pinned `allow` would discover zero.
    expect(keeps(`${HOST}/a/isthere.html`)).toBe(true)
    // One slug is mixed-case; a [a-z0-9-]+ hint would silently drop this article.
    expect(keeps(`${HOST}/a/Godreal.html`)).toBe(true)
    // The 7 section indexes extract 265-1,176 chars and /contact.html 340, so
    // the 250 floor cannot catch any of them. /m/map.html is the site plan;
    // /m/intl.html is the language index (live, but absent from the sitemap).
    expect(keeps(`${HOST}/m/existence.html`)).toBe(false)
    expect(keeps(`${HOST}/m/map.html`)).toBe(false)
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false)
    expect(keeps(`${HOST}/contact.html`)).toBe(false)
    // The homepage extracts 1,162 chars via the `html` container, NOT 0.
    expect(keeps(`${HOST}/`)).toBe(false)
    // Dead nav links (404). Absent from the sitemap today, so the block is what
    // stops a regenerated sitemap quietly staging three 404 bodies.
    for (const slug of ["addiction", "created", "gaylesbian"]) {
      expect(keeps(`${HOST}/a/${slug}.html`)).toBe(false)
    }
    expect(ta().crawl.minContentLength).toBe(250)
  })

  it("scopes to <html> alone and never lets the empty .content4 template shadow it", () => {
    const { contentSelectors } = ta().crawl
    // Measured 2026-07-30 with the repo's own extractContent over all 31
    // articles: a stray </sitelevel_noindex> closes the content div stack early
    // and flattens each article into <html>'s direct children. `.content4`
    // MATCHES on 31/31 and extracts 0 chars; `.contentpadding`, `#content4`,
    // `.content4b` and even <body> do not match at all. Because extractContent
    // scopes to the first selector that MATCHES AN ELEMENT rather than the first
    // that yields text, adding `.content4` in ANY position would win and return
    // "" — every article skipping `too-thin` on a 200, invisible to these tests.
    // A trailing "html" fallback would never fire for the same reason, so
    // `["html"]` has to be the sole entry. Same shape as everystudent-sq / -ko.
    expect(contentSelectors).toEqual(["html"])
  })

  it("strips the chrome that only an <html> container exposes, and omits what cannot bind", () => {
    const strip = ta().crawl.stripSelectors
    // Load-bearing BECAUSE the container is <html>: without it every document
    // opens with a duplicate of its own <title> (31 ch/page once script+style
    // are gone). Safe only because extract.ts reads the title from `root` at
    // line 43, before the strip loop at line 52 — keep that order.
    expect(strip).toContain("head")
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 2 instances on 31/31 pages removing 2,063 chars each: the cookie bar + top
    // nav, and the bottom share/sidebar/footer block. The missing leading "."
    // is correct, not a typo, and this is by far the largest contributor.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA cells — 146 instances, 123 chars/page.
    expect(strip).toContain(".fccell")
    // This host's share widgets. `.likesharediv` measures 351 chars/page on its
    // own but 0 in list order (that text is a <script> payload, already gone);
    // `.a2a_kit` is image-only. Both kept as drift guards.
    expect(strip).toContain(".likesharediv")
    expect(strip).toContain(".a2a_kit")
    // Measured at 0 instances on this host and therefore OMITTED rather than
    // carried as sibling parity: the CTA table has no class here, the share row
    // is .likesharediv/.a2a_kit, and there is no related-articles block at all.
    expect(strip).not.toContain(".fctable")
    expect(strip).not.toContain(".shareiconsmenupg")
    expect(strip).not.toContain(".relatedbottom")
  })
})
