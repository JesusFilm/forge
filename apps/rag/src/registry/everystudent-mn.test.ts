/**
 * The `everystudent-mn` registry entry — EveryStudent's Mongolian domain
 * (tailal.mn). Follows `everystudent-fr.test.ts` / `everystudent-ru.test.ts`
 * and the §5.5 300-line cap.
 *
 * Each guard below encodes a decision that was measured on the live host and
 * would be silent and expensive to undo:
 *   - `html` as the ONLY content selector, because the shared `.content4`
 *     template extracts 0 chars here and would shadow it into a `too-thin` skip;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery mode PLUS 11 pinned seeds, because the 2017 XML sitemap omits
 *     13.4% of the live articles;
 *   - the URL blocks for the John scripture pages and the homepage-redirecting
 *     dead URL, neither of which `minContentLength` could ever catch.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const mn = (): SourceEntry => getSource("everystudent-mn")!

describe("everystudent-mn registry entry", () => {
  it("resolves everystudent-mn as a NON-walled Mongolian discovery source on plain HTTP", () => {
    const entry = mn()
    expect(entry.domain).toBe("www.tailal.mn")
    expect(entry.languages).toEqual(["mn"])
    // Verified 2026-07-29: ~235 plain-HTTP GETs, all 200, Apache, no Cloudflare
    // block page anywhere. Adding a fetchStrategy would bill every page to
    // Firecrawl for nothing (ADR-0012).
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery mode, not the hand-listed seed set the walled siblings need.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.articleHints).toEqual([
      "^https://www\\.tailal\\.mn/a/[^/]+\\.html$",
    ])
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. tailal.mn is its own domain, so the Mongolian
    // content must not be folded into `everystudent` as a second language —
    // the same rule that keeps everystudent-ru / thelife-fr separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(mn().domain)
    expect(mn().key).toBe("everystudent-mn")
    expect(mn().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("binds ONLY `html`, because every shared-template selector extracts 0 chars here", () => {
    const selectors = mn().crawl.contentSelectors
    // Measured over all 119 pages fetched 2026-07-29: `html` binds on 119/119;
    // `.contentpadding` and `body` bind on 5 each and on NO article; and
    // `.content4` binds on 84 of 86 articles while extracting 0 chars on every
    // one (it is an empty spacer div). extractContent scopes to the FIRST
    // selector that MATCHES AN ELEMENT, not the first that yields text, so any
    // of these listed ahead of `html` would shadow it and make every page skip
    // as `too-thin` on an HTTP 200 — silent, and invisible to unit tests.
    expect(selectors).toEqual(["html"])
    expect(selectors).not.toContain(".content4")
    expect(selectors).not.toContain(".content4b")
    expect(selectors).not.toContain(".contentpadding")
    expect(selectors).not.toContain("body")
  })

  it("pins the 11 articles the stale XML sitemap omits", () => {
    const seeds = mn().crawl.seedPaths!
    // The sitemap is Last-Modified 2017-12-22 and lists 73 /a/ pages; the
    // site's own HTML site plan (/m/map.html) links 83. These 11 are the
    // difference, each verified 200 with 2,184-18,349 extracted chars — 13.4%
    // of the live article set that discovery alone would miss.
    expect(seeds).toHaveLength(11)
    expect(new Set(seeds).size).toBe(seeds.length)
    for (const p of seeds) expect(p).toMatch(/^\/a\/[^/]+\.html$/)
    expect(seeds).toContain("/a/200kholbogdokh.html")
    expect(seeds).toContain("/a/500gyeroinoos.html")
    // Seeds bypass block: acquire.ts unions them AFTER filtering, so no seed
    // may collide with a block rule.
    const blocks = mn().crawl.block!.map((b) => new RegExp(b))
    for (const p of seeds) {
      const url = `${mn().crawl.baseUrl}${p}`
      expect(blocks.some((re) => re.test(url))).toBe(false)
    }
  })

  it("blocks the John scripture series, the dead redirect, nav and the homepage by URL", () => {
    const blocks = mn().crawl.block!.map((b) => new RegExp(b))
    const blocked = (u: string) => blocks.some((re) => re.test(u))
    const base = "https://www.tailal.mn"
    // 21 verbatim Gospel-of-John chapters (2,575-7,242 chars) + their index
    // page (1,695 chars): all clear minContentLength, so only a URL block works.
    expect(blocked(`${base}/iohan/iohan1.html`)).toBe(true)
    expect(blocked(`${base}/iohan/iohan21.html`)).toBe(true)
    expect(blocked(`${base}/a/Ezeniy.html`)).toBe(true)
    // The only non-200 sitemap URL: 301 -> homepage. NEVER argue the floor
    // catches this — extract.ts would return the 1,511-char homepage.
    expect(blocked(`${base}/a/510Moriytey.html`)).toBe(true)
    // Link-only dead ends + the decision follow-up email form.
    expect(blocked(`${base}/a/212Yzmerchid.html`)).toBe(true)
    expect(blocked(`${base}/a/217Hoyor.html`)).toBe(true)
    expect(blocked(`${base}/a/402fol.html`)).toBe(true)
    // Nav, contact, and the homepage at BOTH URLs it is served from.
    expect(blocked(`${base}/m/map.html`)).toBe(true)
    expect(blocked(`${base}/m/intl.html`)).toBe(true)
    expect(blocked(`${base}/cont.html`)).toBe(true)
    expect(blocked(`${base}/`)).toBe(true)
    expect(blocked(`${base}/index.html`)).toBe(true)
    // ...and a real article still gets through both filters.
    const hints = mn().crawl.articleHints!.map((h) => new RegExp(h))
    const keeper = `${base}/a/101Yertontsiyn.html`
    expect(hints.some((re) => re.test(keeper))).toBe(true)
    expect(blocked(keeper)).toBe(false)
  })

  it("strips the document head and this host's own share widget", () => {
    const strip = mn().crawl.stripSelectors
    // `head` is required ONLY because the scope is the whole document: without
    // it the surviving <title> lands as the first body line. Safe because
    // extractTitle() runs before the strip loop.
    expect(strip).toContain("head")
    // A custom ELEMENT tag, not a class — 2 per article, 2,228 chars of cookie
    // bar + top nav + bottom related/footer.
    expect(strip).toContain("sitelevel_noindex")
    // This host uses .likesharediv, NOT the siblings' .shareiconsmenupg (0
    // instances here). It must be named explicitly because the
    // <sitelevel_noindex> that nominally wraps it closes early.
    expect(strip).toContain(".likesharediv")
    // The "FEATURE CLOSE" CTA table (67-245 chars) plus its cells.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
  })
})
