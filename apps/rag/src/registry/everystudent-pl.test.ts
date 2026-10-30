/**
 * The `everystudent-pl` registry entry — EveryStudent's Polish domain
 * (kazdystudent.pl). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following the sibling `everystudent-*.test.ts` files.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled, and adding a
 *     strategy would bill every page for a wall that isn't there;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the sitemap is reachable;
 *   - `.contentpadding` alone, because the empty `.content4` spacer would
 *     shadow it and silently extract 0 chars from every page;
 *   - the two `/a/` URL blocks, which `articleHints` cannot express;
 *   - an `articleHints` regex that survives the uppercase slugs.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const pl = (): SourceEntry => getSource("everystudent-pl")!
const HOST = "https://www.kazdystudent.pl"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = pl().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-pl registry entry", () => {
  it("resolves everystudent-pl as an UNWALLED Polish source crawled over plain HTTP", () => {
    const entry = pl()
    expect(entry.domain).toBe("www.kazdystudent.pl")
    expect(entry.languages).toEqual(["pl"])
    // The load-bearing fact: probed 2026-07-29, ~185 plain-HTTP requests
    // (robots.txt, /sitemap.xml, all 78 articles, all 7 /m/ indexes, the
    // homepage and every root-level page) returned HTTP 200 with real HTML and
    // no Cloudflare block page. Declaring a strategy here would bill Firecrawl
    // credits for a wall that does not exist.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, not a hand-listed seed set", () => {
    const entry = pl()
    // /sitemap.xml answered 200 (6,681 bytes, 90 <loc>, 90 distinct), and both
    // the site's own /mapa.html and a full href harvest across all 78 articles
    // agree on the same 78 /a/ URLs — no article is missing, so there is
    // nothing to pin in seedPaths. Precedent for the shape: thelife-fr.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(90) // 90 distinct sitemap URLs
    expect(entry.crawl.minContentLength).toBe(250)
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. kazdystudent.pl is its own domain, so the Polish
    // content must not be folded into `everystudent` as a second language — the
    // same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(pl().domain)
    expect(pl().key).toBe("everystudent-pl")
    const keys = ["everystudent", "everystudent-ru", "everystudent-pl"]
    expect(new Set(keys.map((k) => getSource(k)!.domain)).size).toBe(3)
  })

  it("keeps every /a/ article INCLUDING the uppercase slugs a lowercase-only hint would drop", () => {
    // Polish slugs on this host are de-diacriticised ASCII (verified: zero
    // non-ASCII bytes and zero %XX escapes across all 90 <loc> values), but two
    // carry an uppercase letter. A `[a-z0-9-]+` hint would silently lose them.
    expect(keeps(`${HOST}/a/Boza-pomoc.html`)).toBe(true)
    expect(keeps(`${HOST}/a/jak-osobiscie-poznac-Boga.html`)).toBe(true)
    expect(keeps(`${HOST}/a/malzenstwo.html`)).toBe(true)
    expect(keeps(`${HOST}/a/nicosc.html`)).toBe(true)
  })

  it("blocks the nav pages and email-signup landing pages minContentLength cannot catch", () => {
    // Measured post-strip 2026-07-29 — every one of these CLEARS the 250-char
    // floor, so only a URL block excludes them. The homepage and /m/ indexes
    // have no .contentpadding at all, which means extractContent falls back to
    // <body> and returns the whole nav page (1,138 ch / ~958 ch), not nothing.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(keeps(`${HOST}/m/zycie.html`)).toBe(false)
    expect(keeps(`${HOST}/mapa.html`)).toBe(false) // 2,920 ch site plan
    expect(keeps(`${HOST}/prywatnosci.html`)).toBe(false) // 2,529 ch about/privacy
    expect(keeps(`${HOST}/pytanie.html`)).toBe(false) // 401 ch contact form
    expect(keeps(`${HOST}/wideo.html`)).toBe(false) // 1,490 ch video transcript
    // "Darmowy kurs: Miesiąc z Janem" — the 31-email Gospel-of-John signup.
    expect(keeps(`${HOST}/jan.html`)).toBe(false) // 837 ch
    // "Darmowy kurs: Czy jest Bóg?" — the 7-email series, Polish twin of the
    // German /abenteuerreise.html and Arabic /pack.html.
    expect(keeps(`${HOST}/czybogjest.html`)).toBe(false) // 856 ch
  })

  it("blocks the two /a/ URLs that articleHints alone would admit", () => {
    // These two sit under /a/ and MATCH articleHints, so `block` is the only
    // thing keeping them out — deleting either line silently readmits them.
    // The 8-email "Duchowy Zestaw Startowy" signup, 619 ch.
    expect(keeps(`${HOST}/a/nowezycie.html`)).toBe(false)
    // A real article, blocked for a SOURCE-SIDE MARKUP BUG: 66 <p> openers vs
    // 67 </p> closers collapses the div tree, .contentpadding never forms, and
    // extractContent falls through to the document root — a 31,117-char blob
    // opening with the literal "<!DOCTYPE html>".
    expect(keeps(`${HOST}/a/biblia.html`)).toBe(false)
  })

  it("scopes to .contentpadding alone and never lets the empty .content4 spacer shadow it", () => {
    const { contentSelectors, stripSelectors } = pl().crawl
    // Measured 2026-07-29 with the repo's own extractContent: .contentpadding
    // is the only element that extracts the article (18,722 ch raw on
    // /a/istnienieboga.html; 1,785-22,911 ch across the 77 kept pages).
    // .content4 matches but extracts 0 chars on ALL 78 articles, and
    // extractContent binds the first selector that MATCHES rather than the
    // first that yields text — so listing it would skip every page as
    // `too-thin` on an HTTP 200 (#128). Not a fallback chain: exactly one.
    expect(contentSelectors).toEqual([".contentpadding"])
    // A custom ELEMENT tag, not a class — the missing "." is correct.
    // 2 instances / 144 ch: the "UDOSTĘPNIJ INNYM:" row + related links.
    expect(stripSelectors).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA: the table shell as well as its cells, or the
    // emptied shell survives. 52-180 ch.
    expect(stripSelectors).toContain(".fctable")
    expect(stripSelectors).toContain(".fccell")
    // A no-op in list order on THIS host (its sitelevel_noindex wrapper is
    // well-formed here, unlike -de/-ru), kept as a guard against markup drift.
    expect(stripSelectors).toContain(".shareiconsmenupg")
  })
})
