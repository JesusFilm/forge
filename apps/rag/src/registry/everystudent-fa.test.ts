/**
 * The `everystudent-fa` registry entry — EveryStudent's Persian/Farsi domain
 * (everypersianstudent.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-ru.test.ts` / `everystudent-fr.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled (thelife's Persian
 *     shagerdan.com is a DIFFERENT host, and that one is);
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the sitemap is reachable and
 *     the site's own HTML map adds nothing to it;
 *   - `/a/` only — the 21 Gospel-of-John chapters, the `/m/` indexes,
 *     `/sitemap.html`, `/contact.html`, `/a/fol.html` and the homepage ALL
 *     clear the 250-char floor, so `minContentLength` could never exclude them;
 *   - `contentSelectors` is the single measured container, because the shared
 *     `.content4` extracts 0 chars here and would shadow it.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import {
  allSources,
  getSource,
  resolveFetchStrategy,
  seedUrls,
} from "./index.js"
import type { SourceEntry } from "./types.js"

const fa = (): SourceEntry => getSource("everystudent-fa")!
const HOST = "https://www.everypersianstudent.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = fa().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-fa registry entry", () => {
  it("resolves everystudent-fa as an UNWALLED Persian source crawled over plain HTTP", () => {
    const entry = fa()
    expect(entry.domain).toBe("www.everypersianstudent.com")
    expect(entry.languages).toEqual(["fa"])
    // The load-bearing fact: probed 2026-07-29, 116 plain-HTTP GETs (all 107
    // sitemap URLs, robots.txt, /sitemap.xml and 7 off-sitemap probes) returned
    // real HTML off bare `Server: Apache` with no Cloudflare block-page
    // signature anywhere. Declaring a strategy here would bill every page for a
    // wall that isn't there. thelife's Persian shagerdan.com IS walled — that
    // is a different host and must not be generalized onto this one.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, with nothing left to pin as a seed", () => {
    const entry = fa()
    // /sitemap.xml answered 200 (8,479 bytes, 107 <loc>, all 107 distinct, and
    // a full GET sweep returned 107 × 200 with no redirects), so there is no
    // reason to hand-list. Precedent for the shape: thelife-fr.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    // seedPaths is absent BY EVIDENCE, not by omission: the site's own
    // /sitemap.html carries 86 internal links and every one is already in the
    // XML sitemap, including all 75 /a/ articles. The HTML-map delta is zero.
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    // Discovery needs the filter trio to be meaningful, not just present.
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.block?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(107) // 107 sitemap URLs
  })

  it("is a SEPARATE source key per domain, one domain to one entry (ADR-0006)", () => {
    // everypersianstudent.com is its own domain, so the Persian content must
    // not be folded into `everystudent` as a second language — the same rule
    // that keeps thelife-fr / thelife-zh separate from thelife.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(fa().domain)
    expect(fa().key).toBe("everystudent-fa")
    // The invariant itself: no two registered sources may share a domain.
    const domains = allSources().map((s) => s.domain)
    expect(new Set(domains).size).toBe(domains.length)
    // `languages` declares THIS domain only and claims no exclusivity over
    // `fa` — thelife's walled shagerdan.com would also carry it if registered.
    expect(fa().languages).toEqual(["fa"])
  })

  it("keeps /a/ articles and drops every non-article group the 250-char floor cannot", () => {
    expect(keeps(`${HOST}/a/faith.html`)).toBe(true)
    // One slug is mixed-case; the hint must not assume lowercase.
    expect(keeps(`${HOST}/a/Godreal.html`)).toBe(true)
    // The 21 Gospel-of-John chapters — verse-numbered Persian Scripture at
    // 2,313-6,765 chars each (~85,000 total). Public-domain Bible text, not
    // ministry writing, and it would outweigh the 75 articles in retrieval.
    expect(keeps(`${HOST}/j/j1.html`)).toBe(false)
    expect(keeps(`${HOST}/j/j21.html`)).toBe(false)
    // The 8 section indexes: headline+teaser link lists, 739-1,570 chars.
    expect(keeps(`${HOST}/m/exi.html`)).toBe(false)
    expect(keeps(`${HOST}/m/words.html`)).toBe(false)
    // The site plan (2,904 ch) and contact chrome (312 ch — above the floor).
    expect(keeps(`${HOST}/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/contact.html`)).toBe(false)
    // The homepage: no content container, <body> fallback yields 676 ch of nav.
    expect(keeps(`${HOST}/`)).toBe(false)
    // /a/fol.html — an email-signup follow-up page extracting 284 chars, ABOVE
    // the floor by 34, so length could never have decided it. Absent from
    // today's sitemap but linked from 4+ articles AND matching articleHints,
    // and this sitemap is generated by a link-following crawler — so only a URL
    // block keeps it out of a regenerated one.
    expect(keeps(`${HOST}/a/fol.html`)).toBe(false)
    expect(fa().crawl.minContentLength).toBe(250)
  })

  it("scopes to .contentpadding and never lets the empty .content4 spacer shadow it", () => {
    // Measured 2026-07-29 with node-html-parser exactly as extract.ts uses it,
    // over all 107 pages: .contentpadding is the ONLY element on this host that
    // extracts an article (937-27,323 chars across 74 of the 75). .content4
    // matches on 105 pages and extracts 0 chars on 99 of them; .content4b
    // exists on exactly one page and also extracts 0; .articletitle is an <h1>.
    // Every one of these tokens is ALSO declared in the page's inline <style>,
    // so a grep proves nothing. extractContent scopes to the first selector
    // that MATCHES AN ELEMENT, not the first that yields text, so any of them
    // listed here would silently extract nothing and every article would skip
    // as `too-thin` on a 200 (#128). This is the guard against that.
    // The MEASURED container must bind first. A trailing "html" (rule 1e) is
    // allowed and is what rescues pages whose container collapses — it can
    // shadow nothing, because nothing follows it. What must never appear is a
    // selector that matches at 0 chars ahead of the real one.
    expect(fa().crawl.contentSelectors[0]).toBe(".contentpadding")
    expect(fa().crawl.contentSelectors.at(-1)).toBe("html")
    expect(fa().crawl.contentSelectors).not.toContain(".content4")
    expect(fa().crawl.contentSelectors).not.toContain(".content4b")
    expect(fa().crawl.contentSelectors).not.toContain(".articletitle")
  })

  it("strips the share/CTA chrome, and `head` for the one page with a flattened DOM", () => {
    const strip = fa().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // Measured 2 instances / 99 ch inside .contentpadding on every article. The
    // missing leading "." is correct, not a typo.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA: the table shell as well as its cells, or the
    // emptied shell survives. 224 ch removed on /a/faith.html, 129 on
    // /a/trinity.html.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // /a/personally.html is served with malformed markup that flattens the DOM:
    // no .contentpadding and no <body>, so extractContent falls back to the
    // root and <head> would otherwise contribute a duplicate <title>
    // (7,334 → 7,311 ch). A measured no-op on the other 74 articles.
    expect(strip).toContain("head")
  })
})
