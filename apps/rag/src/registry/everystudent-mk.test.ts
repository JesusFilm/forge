/**
 * The `everystudent-mk` registry entry — EveryStudent's Macedonian domain
 * (studentskiodgovori.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following the sibling `everystudent-*.test.ts` files.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery PLUS one pinned seed, because a real article is in neither the
 *     XML sitemap nor the site's own HTML map;
 *   - `.contentpadding` alone, because the empty `.content4` spacer would
 *     shadow it and silently extract 0 chars from every article;
 *   - the `/a/` URL block, which `articleHints` cannot express;
 *   - an `articleHints` regex that survives a Cyrillic or mixed-case slug.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const mk = (): SourceEntry => getSource("everystudent-mk")!
const HOST = "https://www.studentskiodgovori.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = mk().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-mk registry entry", () => {
  it("resolves everystudent-mk as an UNWALLED Macedonian source over plain HTTP", () => {
    const entry = mk()
    expect(entry.domain).toBe("www.studentskiodgovori.com")
    // Cyrillic Macedonian, measured: 355,089 Cyrillic vs 3,417 Latin characters
    // across all 49 articles (99.05% Cyrillic), with the Macedonian-only letters
    // ќ/њ/ѓ/љ/џ/ѕ present in quantity and the Serbian-only ђ/ћ absent entirely.
    // Unlike the neighbouring `sr` banner, which is Latin-script Serbian.
    expect(entry.languages).toEqual(["mk"])
    // Probed 2026-07-29: ~230 plain-HTTP requests, no Cloudflare block page,
    // no 429. Declaring a strategy would bill Firecrawl for a wall that is
    // not there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl that pins the ONE article neither sitemap lists", () => {
    const entry = mk()
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    // /a/zapoznaj402.html is a live 2,866-char article linked from 16 other
    // articles, yet it is in NEITHER /sitemap.xml NOR /m/mapa.html. Discovery
    // is sitemap-only, so deleting this seed silently loses the document.
    expect(seedUrls(entry)).toEqual([`${HOST}/a/zapoznaj402.html`])
    expect(entry.crawl.maxPages).toBeGreaterThan(65) // 65 distinct sitemap URLs
    expect(entry.crawl.minContentLength).toBe(250)
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. studentskiodgovori.com is its own domain, so the
    // Macedonian content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(mk().domain)
    expect(mk().key).toBe("everystudent-mk")
    const keys = ["everystudent", "everystudent-pl", "everystudent-mk"]
    expect(new Set(keys.map((k) => getSource(k)!.domain)).size).toBe(3)
  })

  it("keeps the live article slugs and would survive a Cyrillic or mixed-case one", () => {
    // Slugs today are all-lowercase Latin ASCII transliterations (verified: zero
    // non-ASCII bytes, zero %XX escapes, zero uppercase across all 65 <loc>),
    // but the content is Cyrillic — so a `[a-z0-9-]+` hint would be a live
    // hazard the day a slug is written in the site's own script. `[^/]+` covers
    // all three cases; narrowing this regex silently drops articles.
    expect(keeps(`${HOST}/a/dalipostoi101.html`)).toBe(true)
    expect(keeps(`${HOST}/a/chinii-koi-pagjaat.html`)).toBe(true)
    expect(keeps(`${HOST}/a/pomos-od-Bog.html`)).toBe(true)
    expect(keeps(`${HOST}/a/помош-од-Бог.html`)).toBe(true)
  })

  it("blocks the nav, contact and e-mail-series pages minContentLength cannot catch", () => {
    // Measured post-strip 2026-07-29 — every one CLEARS the 250-char floor, so
    // only a URL block excludes them. The homepage and 5 of the 7 /m/ indexes
    // have no .contentpadding at all, so extractContent falls back to <body> and
    // returns the whole nav page (1,002 ch / 386-1,649 ch), not nothing.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(keeps(`${HOST}/m/postoenjeto100.html`)).toBe(false)
    expect(keeps(`${HOST}/m/mapa.html`)).toBe(false) // 1,649 ch site plan
    expect(keeps(`${HOST}/kontakti.html`)).toBe(false) // 338 ch contact page
    // "Духовна авантура" — the 7-e-mail series. The signup landing page (904 ch,
    // absent from the sitemap) and the seven instalments the sitemap DOES list
    // (2,397-4,281 ch each). Macedonian twin of the French /aventure.html and
    // Arabic /pack.html.
    expect(keeps(`${HOST}/duhovna-avantura.html`)).toBe(false)
    expect(keeps(`${HOST}/avantura/1.html`)).toBe(false)
    expect(keeps(`${HOST}/avantura/7.html`)).toBe(false)
    // The one URL under /a/ that MATCHES articleHints, so `block` is the only
    // filter keeping it out: the sitemap's typo for /duhovna-avantura.html. It
    // 404s, and the 404 body still extracts 418 chars — over the floor.
    expect(keeps(`${HOST}/a/duhovna-avantura.html`)).toBe(false)
  })

  it("scopes to .contentpadding alone and never lets the empty .content4 spacer shadow it", () => {
    const { contentSelectors, stripSelectors } = mk().crawl
    // Measured 2026-07-29 with the repo's own extractContent over 68 fetched
    // pages: .contentpadding matched 61 with ZERO matched-but-empty cases
    // (101-23,515 ch), while .content4 matched 66 and extracted 0 chars on 61 of
    // them. extractContent binds the first selector that MATCHES rather than the
    // first that yields text, so adding .content4 here would skip every article
    // as `too-thin` on an HTTP 200 (#128). Not a fallback chain: exactly one.
    // The `"html"` fallback is a deliberate LAST entry (orchestrator, 2026-07-29):
    // it is only ever consulted when the primary misses, so it cannot shadow
    // anything, and it beats extract.ts's implicit `?? root` because <html> is a
    // real element and so carries no literal "<!DOCTYPE html>" text node. What
    // must never change is the FIRST entry, and the absence of `.content4`.
    expect(contentSelectors).toEqual([".contentpadding", "html"])
    expect(contentSelectors[0]).toBe(".contentpadding")
    expect(contentSelectors).not.toContain(".content4")
    expect(contentSelectors).not.toContain(".content4")
    // A custom ELEMENT tag, not a class — the missing "." is correct. 100
    // instances on 49/49 pages, 5,933 chars: the biggest chrome contributor.
    expect(stripSelectors).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA: the table shell AND its cells, or the emptied
    // shell survives on the 2 pages whose cells sit outside a classed table.
    expect(stripSelectors).toContain(".fctable")
    expect(stripSelectors).toContain(".fccell")
    // Required only because /a/zapoznaj401.html loses .contentpadding to an
    // unclosed <span> and falls back to the document root: drops the duplicate
    // <title>. extract.ts reads the title from `root` BEFORE the strip loop.
    expect(stripSelectors).toContain("head")
  })
})
