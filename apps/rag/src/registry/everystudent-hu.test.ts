/**
 * The `everystudent-hu` registry entry — EveryStudent's Hungarian domain
 * (everystudent.hu). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-ru.test.ts` / `everystudent-de.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled, and adding a
 *     strategy here would bill 83 pages for a wall that isn't there;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the sitemap is reachable AND
 *     complete (cross-checked against the site's own HTML map);
 *   - `/a/` AND `/story/` — the testimonies are corpus, the indexes are not,
 *     and 11 of the 13 excluded pages clear the 250-char floor, so
 *     `minContentLength` could never have excluded them;
 *   - `.contentpadding` ALONE, because the empty `.content4` spacer would
 *     shadow it and silently extract nothing.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const hu = (): SourceEntry => getSource("everystudent-hu")!

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = hu().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

const HOST = "https://www.everystudent.hu"

describe("everystudent-hu registry entry", () => {
  it("resolves everystudent-hu as an UNWALLED Hungarian source crawled over plain HTTP", () => {
    const entry = hu()
    // The bare apex 301-redirects to www, so www is the canonical host and the
    // one every sitemap <loc> uses.
    expect(entry.domain).toBe("www.everystudent.hu")
    expect(entry.languages).toEqual(["hu"])
    // The load-bearing fact: probed 2026-07-29, ~110 plain-HTTP requests
    // (robots.txt, /sitemap.xml, a HEAD sweep of all 95 sitemap URLs, and a GET
    // of every one of them) all returned HTTP 200 with real HTML and no
    // Cloudflare block-page signature. Declaring a strategy here would bill
    // every page for a wall that does not exist.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, not a hand-listed seed set", () => {
    const entry = hu()
    // /sitemap.xml answered 200 (7,055 bytes, 95 <loc>, all 95 distinct, 95/95
    // live with zero redirects), so there is no reason to hand-list. It is also
    // COMPLETE: cross-checked against /m/sitemap.html plus the union of links on
    // all 7 /m/ indexes, /story/ and the homepage, no article is missing — which
    // is why no seedPaths need pinning, unlike the siblings with stale maps.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    // Discovery needs the filter trio to be meaningful, not just present.
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.block?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(95) // 95 sitemap URLs
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. everystudent.hu is its own domain, so the
    // Hungarian content must not be folded into `everystudent` as a second
    // language — the same rule that keeps everystudent-ru / thelife-fr separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(hu().domain)
    expect(hu().key).toBe("everystudent-hu")
    // `languages` is a declaration about THIS domain only; nothing may treat the
    // entry as the sole owner of the language.
    expect(hu().languages).toEqual(["hu"])
  })

  it("keeps /a/ articles AND /story/ testimonies, including mixed-case slugs", () => {
    expect(keeps(`${HOST}/a/letezik.html`)).toBe(true)
    expect(keeps(`${HOST}/a/isten-szemelyes-megismerese.html`)).toBe(true)
    // Slugs are ASCII but NOT all lowercase — a lowercase-only hint would
    // silently drop these. Measured: 0 non-ASCII and 0 percent-encoded <loc>s,
    // but every /story/ slug is a capitalised first name.
    expect(keeps(`${HOST}/a/Istenmegismerese.html`)).toBe(true)
    expect(keeps(`${HOST}/story/Agi.html`)).toBe(true)
    expect(keeps(`${HOST}/story/TothPetra.html`)).toBe(true)
    // The 20 testimonies are corpus (2,773-5,135 ch of first-person Hungarian
    // narrative on the same container), so the hints must carry BOTH prefixes.
    expect(hu().crawl.articleHints).toHaveLength(2)
  })

  it("blocks the indexes, email-series signups and homepage that clear the 250-char floor", () => {
    // 11 of the 13 excluded pages extract well over 250 chars, so the floor
    // could never have caught them: when no contentSelector matches,
    // extractContent falls back to <body> and returns the whole nav page.
    // /m/* section indexes (735-1,284 ch), the about page (3,589) and the
    // site plan (3,186); the prefix also covers the other-languages page.
    expect(keeps(`${HOST}/m/letezese.html`)).toBe(false)
    expect(keeps(`${HOST}/m/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false)
    // The testimony INDEX (1,697 ch) — distinct from the testimonies above.
    expect(keeps(`${HOST}/story/`)).toBe(false)
    // The localized Gospel-of-John email study (1,241 ch) and the "Lelki
    // hátizsák" 5-part email series (1,558 ch) — signup form copy, not a seeker
    // question being answered. Only a URL block catches these.
    expect(keeps(`${HOST}/janos.html`)).toBe(false)
    expect(keeps(`${HOST}/hatizsak.html`)).toBe(false)
    // Contact form (240 ch) and the homepage (1,009 ch via <body> fallback).
    expect(keeps(`${HOST}/contact1.html`)).toBe(false)
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(hu().crawl.minContentLength).toBe(250)
  })

  it("scopes to .contentpadding alone and never lets the empty .content4 spacer shadow it", () => {
    // Measured 2026-07-29 with the repo's own extractContent against all 95
    // live pages: .contentpadding matched an element on 85 and extracted 0 chars
    // on NONE of them (median 5,269). .content4 matched an element on 91 but
    // extracted 0 chars on 85 — it is an empty spacer div — and .content4b
    // matched 4 and was empty on 3. Every one of these tokens is ALSO declared
    // in the page's inline <style>, so a grep proves nothing.
    //
    // extractContent scopes to the first selector that MATCHES AN ELEMENT, not
    // the first that yields text. contentSelectors is therefore NOT a fallback
    // chain: any zero-text selector listed ahead of .contentpadding shadows it,
    // every page extracts nothing and skips `too-thin` on a 200 — silent, and
    // invisible to these tests. This equality is the guard against that.
    // The MEASURED container must bind first. A trailing "html" (rule 1e) is
    // allowed and is what rescues pages whose container collapses — it can
    // shadow nothing, because nothing follows it. What must never appear is a
    // selector that matches at 0 chars ahead of the real one.
    expect(hu().crawl.contentSelectors[0]).toBe(".contentpadding")
    expect(hu().crawl.contentSelectors.at(-1)).toBe("html")
    expect(hu().crawl.contentSelectors).not.toContain(".content4")
    expect(hu().crawl.contentSelectors).not.toContain(".content4b")
    expect(hu().crawl.contentSelectors).not.toContain(".articletitle")
  })

  it("strips only the chrome measured to remove text, and omits the no-ops", () => {
    const strip = hu().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 172 instances / 15,863 ch across the 83 content pages: the nav and footer.
    // The missing leading "." is correct, not a typo.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA: the table shell (14,231 ch) as well as its cells
    // (9,345 ch), or the emptied shell survives.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // The share widget (1,660 ch standalone). NOTE: on THIS host it is redundant
    // — stripping sitelevel_noindex already removes it on 83/83 pages, so the
    // malformed-markup rationale from #128 does NOT apply here. Kept as a guard.
    expect(strip).toContain(".shareiconsmenupg")
    // Measured no-ops, deliberately NOT copied from the siblings: .hr2 (176
    // instances, 0 ch), .articledivider (80 instances, 0 ch), .relatedbottom
    // (0 instances). Shipping strip selectors that remove nothing is noise.
    expect(strip).not.toContain(".hr2")
    expect(strip).not.toContain(".articledivider")
    expect(strip).not.toContain(".relatedbottom")
  })
})
