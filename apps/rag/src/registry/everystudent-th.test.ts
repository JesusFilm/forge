/**
 * The `everystudent-th` registry entry — EveryStudent's Thai domain
 * (everythaistudent.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following the sibling `everystudent-*.test.ts` files.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery PLUS one pinned seed, because the XML sitemap is one real
 *     article short of the site's own HTML map;
 *   - `.contentpadding` alone, because the empty `.content4` spacer matches on
 *     every article and would shadow it into 0 chars;
 *   - the two `/a/` URL blocks, which `articleHints` cannot express;
 *   - an `articleHints` regex that survives the uppercase slugs.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const th = (): SourceEntry => getSource("everystudent-th")!
const HOST = "https://www.everythaistudent.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = th().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-th registry entry", () => {
  it("resolves everystudent-th as an UNWALLED Thai source crawled over plain HTTP", () => {
    const entry = th()
    expect(entry.domain).toBe("www.everythaistudent.com")
    expect(entry.languages).toEqual(["th"])
    // The load-bearing fact: probed 2026-07-29, ~130 plain-HTTP requests (the
    // sitemap, all 52 sitemap URLs, the two off-sitemap articles and a 52-URL
    // HEAD sweep) returned HTTP 200 with real HTML from a bare Apache — no
    // Cloudflare block page anywhere. Declaring a strategy here would bill
    // Firecrawl credits for a wall that does not exist.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl that PINS the one article the XML sitemap is missing", () => {
    const entry = th()
    // /sitemap.xml answered 200 (4,384 bytes, 52 <loc>, 52 distinct, 43 of them
    // /a/ articles). But the site's own /m/map.html links a 44th:
    // /a/500gaylesbian.html — a genuine 14,792-char article, HTTP 200, absent
    // from every <loc>. acquire.ts unions seedPaths with discovered URLs, so
    // pinning it is the only way to reach it until the sitemap is regenerated.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toEqual(["/a/500gaylesbian.html"])
    expect(seedUrls(entry)).toEqual([`${HOST}/a/500gaylesbian.html`])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(52) // 52 distinct sitemap URLs
    expect(entry.crawl.minContentLength).toBe(250)
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. everythaistudent.com is its own domain, so the
    // Thai content must not be folded into `everystudent` as a second language —
    // the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(th().domain)
    expect(th().key).toBe("everystudent-th")
    const keys = ["everystudent", "everystudent-pl", "everystudent-th"]
    expect(new Set(keys.map((k) => getSource(k)!.domain)).size).toBe(3)
  })

  it("keeps every /a/ article INCLUDING the uppercase slugs a lowercase-only hint would drop", () => {
    // Slugs on this host are pure ASCII English under Thai page titles (verified:
    // zero non-ASCII bytes and zero %XX escapes across all 52 <loc> values), but
    // three carry an uppercase letter. A `[a-z0-9-]+` hint would silently lose
    // them, and nothing downstream would report the loss.
    expect(keeps(`${HOST}/a/100Godrealvid.html`)).toBe(true)
    expect(keeps(`${HOST}/a/106Godreal.html`)).toBe(true)
    expect(keeps(`${HOST}/a/video-Jesus.html`)).toBe(true)
    expect(keeps(`${HOST}/a/101isthere.html`)).toBe(true)
  })

  it("blocks the nav pages and the two /a/ URLs minContentLength cannot catch", () => {
    // Measured post-strip 2026-07-29 with the shipped selectors — every one of
    // these CLEARS the 250-char floor, so only a URL block excludes them.
    // The homepage has no .contentpadding at all, so extractContent falls back
    // to <body> and returns the whole teaser page, not nothing.
    expect(keeps(`${HOST}/`)).toBe(false) // 826 ch
    expect(keeps(`${HOST}/m/map.html`)).toBe(false) // 1,728 ch site plan
    expect(keeps(`${HOST}/m/about.html`)).toBe(false) // 3,385 ch
    expect(keeps(`${HOST}/contact.html`)).toBe(false) // 296 ch contact form
    // ── These two sit under /a/ and MATCH articleHints, so `block` is the ONLY
    // thing keeping them out; deleting either line silently readmits them.
    // "เริ่มต้นกับพระเจ้า" — the post-decision page handing readers off to
    // ThaiNewToJesus.com for the Spiritual Starter Kit emails, 944 ch.
    expect(keeps(`${HOST}/a/402fol.html`)).toBe(false)
    // A real article blocked for a SOURCE-SIDE MARKUP BUG: `<sup>13</sup</p>` is
    // missing its ">", the element stack unwinds, .contentpadding never forms,
    // and extractContent falls to the document root — 10,502 ch opening with the
    // literal string "<!DOCTYPE html>".
    // NOT blocked (orchestrator, 2026-07-29). The markup bug is real, but the
    // "html" fallback in contentSelectors plus "head" in stripSelectors extracts
    // the article cleanly instead of a DOCTYPE-led root blob. Blocking it cost a
    // genuine 10,718-ch document to avoid a cosmetic artefact.
    expect(keeps(`${HOST}/a/300whatislife.html`)).toBe(true)
  })

  it("scopes to .contentpadding alone and never lets the empty .content4 spacer shadow it", () => {
    const { contentSelectors, stripSelectors } = th().crawl
    // Measured 2026-07-29 with the repo's own extractContent: .contentpadding is
    // the only element that extracts the article (2,718-32,056 ch across the 43
    // kept pages, 0 of them empty). .content4 matches on 53 of 56 pages and
    // extracts 0 chars on EVERY one of the 44 articles — it is an empty spacer
    // SIBLING, not a parent — and extractContent binds the first selector that
    // MATCHES rather than the first that yields text, so listing it would skip
    // every page as `too-thin` on an HTTP 200 (#128). Exactly one selector.
    // The `"html"` fallback is a deliberate LAST entry (orchestrator, 2026-07-29):
    // it is only ever consulted when the primary misses, so it cannot shadow
    // anything, and it beats extract.ts's implicit `?? root` because <html> is a
    // real element and so carries no literal "<!DOCTYPE html>" text node. What
    // must never change is the FIRST entry, and the absence of `.content4`.
    expect(contentSelectors).toEqual([".contentpadding", "html"])
    expect(contentSelectors[0]).toBe(".contentpadding")
    expect(contentSelectors).not.toContain(".content4")
    expect(contentSelectors).not.toContain(".content4")
    expect(contentSelectors).not.toContain(".content4b")
    // A custom ELEMENT tag, not a class — the missing "." is correct. 2 instances
    // / 62 ch on all 43 articles: "แชร์ต่อกับคนอื่น:" + the related/footer block.
    expect(stripSelectors).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA, 78-386 ch. BOTH are needed: /a/401fourlaws.html
    // has 4 bare .fccell cells and no .fctable at all.
    expect(stripSelectors).toContain(".fctable")
    expect(stripSelectors).toContain(".fccell")
    // A 0-char no-op in list order on THIS host — its sitelevel_noindex wrapper
    // is well-formed and already contains it. Kept as a markup-drift guard.
    expect(stripSelectors).toContain(".shareiconsmenupg")
  })
})
