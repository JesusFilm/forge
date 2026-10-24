/**
 * The `everystudent-et` registry entry — EveryStudent's Estonian domain
 * (tudengielu.net). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-de.test.ts` / `everystudent-ru.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled, and adding a
 *     strategy would bill every page for a wall that isn't there;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds — the sitemap is reachable AND complete;
 *   - `.contentleftpadding` ALONE, because this host does not run the
 *     `.content4`/`.contentpadding` template every sibling shares, and a
 *     no-element selector listed ahead of it would shadow it into <body>;
 *   - the 21 `/johannese/` Bible chapters stay out — third-party © and 2,834+
 *     chars each, so `minContentLength` could never catch them.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const et = (): SourceEntry => getSource("everystudent-et")!

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = et().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-et registry entry", () => {
  it("resolves everystudent-et as an UNWALLED Estonian source crawled over plain HTTP", () => {
    const entry = et()
    // The bare host 301s to www, so www is canonical and what every <loc> uses.
    expect(entry.domain).toBe("www.tudengielu.net")
    expect(entry.crawl.baseUrl).toBe("https://www.tudengielu.net")
    expect(entry.languages).toEqual(["et"])
    // The load-bearing fact: probed 2026-07-29, ~110 plain-HTTP requests
    // (a HEAD sweep and a full GET of all 77 sitemap URLs, plus robots.txt and
    // 17 probe paths) all answered from plain Apache with no Cloudflare block
    // page anywhere. Declaring a strategy here would bill pages for nothing.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, with no seeds needed", () => {
    const entry = et()
    // /sitemap.xml answered 200 (5,680 bytes, 77 <loc>, 77 distinct, 77/77 live
    // on a HEAD sweep). It is nine years stale by its own Last-Modified, so it
    // was cross-checked against the site's own HTML map /m/kaart.html and every
    // on-site /a/ link: the article sets match EXACTLY, difference empty in both
    // directions. Nothing to pin, so seedPaths stays absent.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    // Discovery needs the filter trio to be meaningful, not just present.
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.block?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(77) // 77 sitemap URLs
    expect(entry.crawl.minContentLength).toBe(250)
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. tudengielu.net is its own domain, so the Estonian
    // content must not be folded into `everystudent` as a second language — the
    // same rule that keeps everystudent-ru / thelife-fr / thelife-zh separate.
    // Note the host carries no "everystudent" string at all; the sibling
    // relationship is editorial, not nominal.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(et().domain)
    expect(et().key).toBe("everystudent-et")
    expect(et().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("scopes extraction to .contentleftpadding ALONE — this host is NOT on the shared template", () => {
    const selectors = et().crawl.contentSelectors
    // Measured 2026-07-29 with the repo's own extractContent across all 77 live
    // pages: .contentleftpadding binds on 77/77 and extracts the article
    // (1,114-27,503 chars on the 46 kept). tudengielu.net runs an older,
    // hand-rolled layout, so every selector inherited from a sibling MISSES.
    expect(selectors).toEqual([".contentleftpadding"])
    // NOT a fallback chain: extractContent scopes to the first selector that
    // MATCHES AN ELEMENT, not the first that yields text. Each of these had NO
    // ELEMENT on all 77 pages, so adding one back cannot help and, if this host
    // is ever re-templated, would shadow the working selector into a <body>
    // fallback that silently ingests nav + sidebar + footer on every article.
    for (const dead of [
      ".content4",
      ".content4b",
      ".contentpadding",
      ".articletitle",
    ]) {
      expect(selectors).not.toContain(dead)
    }
    // .contentleft is the identical-extracting PARENT (same char count on 77/77);
    // omitted so it is unambiguous which container was measured.
    expect(selectors).not.toContain(".contentleft")
  })

  it("strips this host's own AddToAny share chrome, not the siblings' absent selectors", () => {
    const strip = et().crawl.stripSelectors
    // .a2a_dd is the one selector this host genuinely needs: the "Saada lehekülg
    // sõbrale" share link, 136 instances across 46/46 articles, 1,080 chars.
    // .a2a_kit is listed FIRST because all 91 of its instances contain an
    // .a2a_dd, so outer-then-inner takes the whole widget rather than a shell.
    expect(strip).toContain(".a2a_kit")
    expect(strip).toContain(".a2a_dd")
    expect(strip.indexOf(".a2a_kit")).toBeLessThan(strip.indexOf(".a2a_dd"))
    expect(strip).toContain(".addthis_toolbox")
    // `form` does real work here: /a/seks2.html carries the site's only <form>,
    // a 731-char "Jah/Ei" quiz.
    expect(strip).toContain("form")
    // Deliberately ABSENT — each measured at 0 element instances on all 77
    // pages. Carrying them would falsely imply this host shares the estate
    // template, which the contentSelectors guard above shows it does not.
    for (const absent of [
      "sitelevel_noindex",
      ".shareiconsmenupg",
      ".fccell",
      ".fctable",
      ".articledivider",
      ".relatedbottom",
    ]) {
      expect(strip).not.toContain(absent)
    }
  })

  it("keeps only /a/ articles — the John chapters, indexes, contact and homepage are URL-blocked", () => {
    const base = "https://www.tudengielu.net"
    // The keep set: 46 /a/<slug>.html articles.
    expect(keeps(`${base}/a/olemas.html`)).toBe(true)
    expect(keeps(`${base}/a/kolmainsust.html`)).toBe(true)
    expect(keeps(`${base}/a/jolka.html`)).toBe(true)

    // 21 chapters of VERBATIM Bible text, "© Eesti Piibliselts" — a third-party
    // rights holder this entry's `rights` line would misattribute. 2,834-7,691
    // chars each, so minContentLength could never have caught them.
    expect(keeps(`${base}/johannese/j1.html`)).toBe(false)
    expect(keeps(`${base}/johannese/j21.html`)).toBe(false)

    // Section indexes: headline+teaser link lists, 77-2,635 chars. FIVE of the
    // eight clear the 250 floor, so URL-blocking is the only thing that works.
    expect(keeps(`${base}/m/kkk.html`)).toBe(false) // 1,929 ch
    expect(keeps(`${base}/m/kaart.html`)).toBe(false) // 2,635 ch, the site plan
    // Contact page: 285 ch — clears the floor by 35.
    expect(keeps(`${base}/kontakt.html`)).toBe(false)
    // Homepage: 653 ch of welcome copy + teaser pairs. Also clears the floor.
    expect(keeps(`${base}/`)).toBe(false)
    expect(keeps(base)).toBe(false)

    // Every non-article group is caught by `block` EXPLICITLY, not merely missed
    // by articleHints — so widening the hints later cannot silently readmit them.
    const block = et().crawl.block!
    const blocked = (u: string): boolean =>
      block.some((p) => new RegExp(p).test(u))
    for (const u of [
      `${base}/johannese/j7.html`,
      `${base}/m/eksistents.html`,
      `${base}/kontakt.html`,
      `${base}/`,
    ]) {
      expect(blocked(u)).toBe(true)
    }
    // ...and blocking must not reach the articles.
    expect(blocked(`${base}/a/piibel.html`)).toBe(false)
  })
})
