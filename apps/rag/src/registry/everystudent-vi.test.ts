/**
 * The `everystudent-vi` registry entry — EveryStudent's Vietnamese domain
 * (everyvietstudent.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-fr.test.ts` / `everystudent-ru.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled, and adding a
 *     strategy here would bill 67 pages for a wall that isn't there;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery off the live sitemap, PLUS one pinned seed both site maps omit;
 *   - `/a/` only — the `/m/` indexes, `/co.html` and the homepage all clear the
 *     250-char floor, so `minContentLength` could never have excluded them, and
 *     the one 301-to-nav URL is blocked rather than argued away;
 *   - `.contentpadding` alone, because the shared `.content4` is an empty
 *     spacer that shadows it and silently extracts nothing.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const HOST = "https://www.everyvietstudent.com"
const vi = (): SourceEntry => getSource("everystudent-vi")!

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = vi().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-vi registry entry", () => {
  it("resolves everystudent-vi as an UNWALLED Vietnamese source crawled over plain HTTP", () => {
    const entry = vi()
    expect(entry.domain).toBe("www.everyvietstudent.com")
    expect(entry.languages).toEqual(["vi"])
    // The load-bearing fact: probed 2026-07-29, ~95 plain-HTTP requests
    // (robots.txt, /sitemap.xml, a HEAD sweep of all 76 sitemap URLs, all 66
    // articles, the 8 /m/ indexes, /co.html and the homepage) returned HTTP 200
    // with real HTML and no Cloudflare block-page signature — the host is
    // Apache with no Cloudflare in front. Declaring a strategy would bill every
    // page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl plus exactly one pinned seed both site maps omit", () => {
    const entry = vi()
    // /sitemap.xml answered 200 (6,220 bytes, 76 <loc>, all 76 distinct, 76/76
    // live with no redirect), so there is no reason to hand-list.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.block?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(76) // 76 sitemap URLs
    // /a/402Batdauvoi.html is a live 200 article (657 ch) that the XML sitemap
    // AND the site's own /m/map.html both omit — reachable only as a link from
    // /a/101DucChuaTroi.html and /a/401Nhanbiet.html. acquire.ts unions seeds
    // with discovered URLs, so pinning it is the only way it is ever fetched.
    expect(seedUrls(entry)).toEqual([`${HOST}/a/402Batdauvoi.html`])
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. everyvietstudent.com is its own domain, so the
    // Vietnamese content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(vi().domain)
    expect(vi().key).toBe("everystudent-vi")
  })

  it("keeps /a/ articles and drops the nav indexes, contact page and homepage", () => {
    // Slugs are ASCII-folded despite the language, but MIXED CASE — the hint
    // must not assume lowercase.
    expect(keeps(`${HOST}/a/101DucChuaTroi.html`)).toBe(true)
    expect(keeps(`${HOST}/a/511VanPhamDoiTruyHai.html`)).toBe(true)
    expect(keeps(`${HOST}/a/virus-corona.html`)).toBe(true)
    // The 8 /m/ section indexes extract 892-3,218 chars of headline+teaser link
    // lists — /m/ab.html is the about page, /m/map.html the HTML site map, and
    // /m/intl.html the page linking out to the sibling language domains.
    expect(keeps(`${HOST}/m/ex1.html`)).toBe(false)
    expect(keeps(`${HOST}/m/map.html`)).toBe(false)
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false)
    // The contact page (488 ch) and the homepage (892 ch of teaser cards).
    expect(keeps(`${HOST}/co.html`)).toBe(false)
    expect(keeps(`${HOST}/`)).toBe(false)
    // All of the above clear the 250-char floor, so only a URL block excludes
    // them: length is not aboutness.
    expect(vi().crawl.minContentLength).toBe(250)
  })

  it("blocks the one URL on this host that redirects into a nav index", () => {
    // /a/217HaithuChanLy.html is 301 -> /m/ex2.html. It is in neither the XML
    // sitemap nor /m/map.html today, so discovery cannot reach it — but if it
    // ever were, extract.ts would happily stage a copy of the ex2 index page,
    // which is well over minContentLength. Blocked by URL, not argued away.
    expect(keeps(`${HOST}/a/217HaithuChanLy.html`)).toBe(false)
  })

  it("scopes to .contentpadding and never lets the empty .content4 spacer shadow it", () => {
    // Measured 2026-07-29 with the repo's own extractContent against all 67
    // live article pages: .contentpadding is the ONLY element on this host that
    // extracts the article (657-28,225 ch, none under the floor). .content4
    // exists as an empty spacer div — 0 chars — and .content4b is absent.
    // Every one of these tokens is ALSO declared in the page's inline <style>,
    // so a grep proves nothing. extractContent scopes to the first selector
    // that MATCHES AN ELEMENT, not the first that yields text: the chain
    // [".content4", ".content4b", ".articletitle", ".contentpadding"] extracted
    // 0 chars on 67/67 pages, every article skipping `too-thin` on a 200.
    // The MEASURED container must bind first. A trailing "html" (rule 1e) is
    // allowed and is what rescues pages whose container collapses — it can
    // shadow nothing, because nothing follows it. What must never appear is a
    // selector that matches at 0 chars ahead of the real one.
    expect(vi().crawl.contentSelectors[0]).toBe(".contentpadding")
    expect(vi().crawl.contentSelectors.at(-1)).toBe("html")
    expect(vi().crawl.contentSelectors).not.toContain(".content4")
    expect(vi().crawl.contentSelectors).not.toContain(".content4b")
    expect(vi().crawl.contentSelectors).not.toContain(".articletitle")
  })

  it("strips the nav/CTA/share chrome so citations stay clean", () => {
    const strip = vi().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 2-4 instances per page, marginal removal 69-802 ch on 67/67 pages. The
    // missing leading "." is correct, not a typo.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA: the table shell as well as its cells. They are
    // mutually redundant on 66 pages, but .fccell is the one that still fires
    // on /a/726DucChuaTroiyeu.html (218 ch), whose malformed markup hides the
    // table shell from the parser.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // The "CHIA SẺ" AddToAny row. 0 marginal removal here because this host's
    // wrapping <sitelevel_noindex> does contain it — unlike the German and
    // Russian siblings, where the same markup is malformed (#128). Kept as a
    // zero-cost guard against that failure mode.
    expect(strip).toContain(".shareiconsmenupg")
  })
})
