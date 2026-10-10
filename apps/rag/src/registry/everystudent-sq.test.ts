/**
 * The `everystudent-sq` registry entry — EveryStudent's Albanian domain
 * (pyetjetejetes.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-ru.test.ts` / `everystudent-ko.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the sitemap is reachable and is
 *     a strict superset of the site's own HTML map;
 *   - `contentSelectors: ["html"]` — the shared `.content4`/`.contentpadding`
 *     template MATCHES on this host but extracts 0 chars, so listing either
 *     would shadow the real container and ingest nothing;
 *   - `/a/` only — the `/m/` indexes, the two email-signup pages, the contact
 *     form and the homepage all clear the 250-char floor, so `minContentLength`
 *     could never have excluded them;
 *   - the robots.txt Disallow, which uniquely for this banner names an `/a/` path.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const sq = (): SourceEntry => getSource("everystudent-sq")!
const HOST = "https://www.pyetjetejetes.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = sq().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-sq registry entry", () => {
  it("resolves everystudent-sq as an UNWALLED Albanian source crawled over plain HTTP", () => {
    const entry = sq()
    expect(entry.domain).toBe("www.pyetjetejetes.com")
    expect(entry.languages).toEqual(["sq"])
    // Verified 2026-07-29: robots.txt, /sitemap.xml, all 78 /a/ articles, all 8
    // /m/ indexes and the homepage returned HTTP/2 200 to plain curl against
    // bare Apache — no Cloudflare layer at all. Declaring a strategy here would
    // bill every page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, not a hand-listed seed set", () => {
    const entry = sq()
    // /sitemap.xml answered 200 (11,698 bytes, 131 <loc>, all distinct), and the
    // site's own HTML map (/m/sitemap.html) lists only 72 /a/ links — all 72
    // already in the XML. The XML is the superset, so nothing needs pinning.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(131) // 131 sitemap URLs
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. pyetjetejetes.com is its own domain, so the
    // Albanian content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(sq().domain)
    expect(sq().key).toBe("everystudent-sq")
    expect(sq().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("keeps /a/ articles and drops the PDFs, indexes, signup pages and homepage", () => {
    expect(keeps(`${HOST}/a/trinine.html`)).toBe(true)
    // One slug is mixed-case; the hint must not assume lowercase.
    expect(keeps(`${HOST}/a/Zoti-vertete.html`)).toBe(true)
    // 41 of the 131 sitemap URLs are /pdf/ print twins — this source is
    // html-scrape and cannot read a PDF.
    expect(keeps(`${HOST}/pdf/ekziston.pdf`)).toBe(false)
    // The 8 section indexes extract 333-3,305 chars, so the 250 floor cannot
    // catch them. /m/sitemap.html is the site plan; /m/faqe.html about+privacy.
    expect(keeps(`${HOST}/m/ekzistenca.html`)).toBe(false)
    expect(keeps(`${HOST}/m/sitemap.html`)).toBe(false)
    // The Gospel-of-John study signup (1,756 ch) and the "Kutia e Aventurës
    // Shpirtërore" 7-email series (1,241 ch) — length is not aboutness, so only
    // a URL block excludes them. Contact form: 395 ch.
    expect(keeps(`${HOST}/gjonit.html`)).toBe(false)
    expect(keeps(`${HOST}/aventures.html`)).toBe(false)
    expect(keeps(`${HOST}/kontaktoni1.html`)).toBe(false)
    // The homepage extracts 778 chars via the `html` container, NOT 0.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(sq().crawl.minContentLength).toBe(250)
  })

  it("honours the robots.txt Disallow and the one dead /a/ URL", () => {
    // Uniquely among the EveryStudent banners, robots.txt here names an /a/
    // path: `Disallow: /a/ungjillin2.html`. It returns 200 and extracts 2,523
    // chars, so neither the floor nor the article hint would exclude it.
    expect(keeps(`${HOST}/a/ungjillin2.html`)).toBe(false)
    // /a/erdhi.html 301s to the /m/ekzistenca.html section index. It is linked
    // from /m/video.html but absent from the sitemap; blocked so a regenerated
    // sitemap cannot stage a copy of that nav page. All 78 sitemap /a/ URLs
    // were swept 2026-07-29 and returned 200 with no redirect — this is the
    // only dead article path found anywhere on the host.
    expect(keeps(`${HOST}/a/erdhi.html`)).toBe(false)
  })

  it("scopes to <html> and never lets the empty .content4 template shadow it", () => {
    const { contentSelectors } = sq().crawl
    // Measured 2026-07-29 with the repo's own extractContent over all 78
    // articles: stray </sitelevel_noindex> end tags close the content divs early
    // and flatten the article into <html>'s direct children. `.content4` matches
    // on 78/78 and extracts 0 chars; `.contentpadding` matches on 52/78 and
    // extracts 0 chars; `.content4b` and <body> do not match at all. Because
    // extractContent scopes to the first selector that MATCHES AN ELEMENT rather
    // than the first that yields text, adding either would win and return "" —
    // every article skipping `too-thin` on a 200, invisible to these tests.
    // Same failure shape as everystudent-ko.
    expect(contentSelectors).toEqual(["html"])
  })

  it("strips the chrome that only an <html> container exposes", () => {
    const strip = sq().crawl.stripSelectors
    // Load-bearing BECAUSE the container is <html>: without it every document
    // opens with a duplicate of its own <title>. Safe only because extract.ts
    // reads the title from `root` before the strip loop — keep that order.
    expect(strip).toContain("head")
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 2 instances on 78/78 pages, removing exactly 905 chars on every one: the
    // cookie bar + nav, and the "TREGOJUA MIQVE:" share + related + footer block.
    // The missing leading "." is correct, not a typo.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA cells — 354 instances, 79-196 chars per page.
    // `.fctable` is deliberately absent: 0 instances on this host, because the
    // CTA table carries no class here. Do not add it expecting it to bind.
    expect(strip).toContain(".fccell")
    expect(strip).not.toContain(".fctable")
    // The AddToAny share row — this host's share widget (the Korean sibling's
    // .likesharediv is 0 instances here). 0 chars today; stripped so a markup
    // change adding text labels cannot leak them into all 78 articles.
    expect(strip).toContain(".a2a_kit")
  })
})
