/**
 * The `everystudent-sr` registry entry — EveryStudent's Serbian domain
 * (studentskikutak.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-pt.test.ts` / `everystudent-ru.test.ts`.
 *
 * Each guard below encodes a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this host is not walled, and adding a
 *     `fetchStrategy` would start billing per page for nothing;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - the 7 pinned articles covering the stale sitemap's 10.4% blind spot;
 *   - the 5 DEAD sitemap URLs, 3 of which redirect to a nav index and would
 *     otherwise stage byte-identical copies of it;
 *   - `.contentpadding` alone, because `.content4` matches and extracts 0 chars;
 *   - the share/CTA/sidebar chrome strip that keeps citations clean.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const sr = (): SourceEntry => getSource("everystudent-sr")!

/** Applies the entry's own allow/block/articleHints to a URL, as discover.ts does. */
const keeps = (url: string): boolean => {
  const { allow, block, articleHints } = sr().crawl
  const hit = (ps: string[] | undefined) =>
    (ps ?? []).some((p) => new RegExp(p).test(url))
  return hit(allow) && !hit(block) && hit(articleHints)
}

describe("everystudent-sr registry entry", () => {
  it("is an UNWALLED, plain-HTTP, discovery-mode Serbian source", () => {
    const entry = sr()
    expect(entry.domain).toBe("www.studentskikutak.com")
    // Serbian is digraphic, but verified 2026-07-29 this host serves LATIN
    // script only: across all 77 articles the sole Cyrillic is the incidental
    // word "видео" on a dropped video stub. No parallel /cir/ tree, no
    // hreflang, no duplicate-content trap — so one plain `sr`, not sr-Latn.
    expect(entry.languages).toEqual(["sr"])
    // The load-bearing fact: verified 2026-07-29, ~110 plain-curl requests all
    // returned HTTP 200 from Apache/HTTP2 with no Cloudflare anywhere.
    // Declaring a fetchStrategy would bill every page through Firecrawl for
    // nothing.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, not a hand-listed inventory: /sitemap.xml is free to fetch.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. studentskikutak.com is its own domain, so the
    // Serbian content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate, and
    // that keeps this entry distinct from the Croatian and Macedonian siblings.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(sr().domain)
    expect(sr().key).toBe("everystudent-sr")
  })

  it("pins the 7 live articles the stale 2020-11-25 sitemap omits", () => {
    const seeds = sr().crawl.seedPaths!
    // The sitemap is a one-off xml-sitemaps.com run: every <lastmod> reads
    // 2020-11-13 and it lists 74 /a/ URLs, while the site's own /mapa.html
    // links 77 — and 5 of the sitemap's own entries are dead. Discovery ALONE
    // would silently miss 10.4% of the corpus, so these 7 are pinned;
    // acquire.ts unions seedPaths with the discovered set (69 + 7 = 76).
    // Deleting them would lose a tenth of the source with no error anywhere.
    expect(seeds).toHaveLength(7)
    expect(new Set(seeds).size).toBe(7)
    for (const p of seeds) expect(p).toMatch(/^\/a\/[^/]+\.html$/)
    // A seed that the block list also matched would be self-contradictory.
    for (const p of seeds) {
      expect(keeps(`https://www.studentskikutak.com${p}`)).toBe(true)
    }
    // Measured at 9,756 ch via the implicit root fallback — this page has no
    // .contentpadding wrapper at all, so it is the one most likely to be
    // "cleaned up" by someone who did not measure it.
    expect(seeds).toContain("/a/zajednistvo.html")
  })

  it("blocks the 5 DEAD sitemap URLs, three of which redirect to a nav index", () => {
    // Verified 2026-07-29. These match articleHints, so the hints cannot save
    // us and minContentLength cannot either: when no contentSelector matches,
    // extractContent falls back to <body> and returns the whole nav page.
    // Unblocked, the three 301s would stage 3 byte-identical copies of
    // /m/postanje100.html (1,031 ch).
    for (const slug of ["glinpos111", "mutnevode112", "zivot114"]) {
      expect(keeps(`https://www.studentskikutak.com/a/${slug}.html`)).toBe(
        false,
      )
    }
    // Both plain 404s.
    for (const slug of ["pravedanrat216", "ranac"]) {
      expect(keeps(`https://www.studentskikutak.com/a/${slug}.html`)).toBe(
        false,
      )
    }
    // A 33-char video stub: <title>Video: Padajući Tanjiri</title>.
    expect(keeps("https://www.studentskikutak.com/a/tanjiri.html")).toBe(false)
    // …while the real articles still pass, including the one mixed-case slug.
    for (const u of [
      "https://www.studentskikutak.com/a/imaliboga101.html",
      "https://www.studentskikutak.com/a/Bibliji215.html",
    ]) {
      expect(keeps(u)).toBe(true)
    }
  })

  it("drops every nav page, the duplicated homepage and the email-series signup", () => {
    // All measured 2026-07-29 under this entry's shipped config, and all ABOVE
    // the 250-char floor — several only because extractContent falls back to
    // <body>. Only a URL block excludes them.
    for (const u of [
      "https://www.studentskikutak.com/", // homepage, 846 ch
      "https://www.studentskikutak.com/index.html", // the SAME page, byte-identical; sitemap lists both
      "https://www.studentskikutak.com/m/postanje100.html", // section index, 1,031 ch
      "https://www.studentskikutak.com/m/osajtu803.html", // about + privacy, 2,823 ch
      "https://www.studentskikutak.com/m/autoru.html", // author bio, 1,654 ch
      "https://www.studentskikutak.com/m/intl.html", // links out to the sibling language domains
      "https://www.studentskikutak.com/mapa.html", // site plan, 2,712 ch of link list
      "https://www.studentskikutak.com/kontakt.html", // contact form, 373 ch — over the floor
      // "Paket duhovne avanture", the 7-message email-series signup (1,233 ch):
      // the Serbian twin of the French /aventure.html and Arabic /pack.html.
      "https://www.studentskikutak.com/ranac.html",
    ]) {
      expect(keeps(u)).toBe(false)
    }
  })

  it("scopes to .contentpadding and never lets the empty .content4 spacer shadow it", () => {
    const { contentSelectors } = sr().crawl
    // Measured 2026-07-29 with the repo's own extractContent across ALL 77 live
    // articles: .contentpadding matches 76/77 and extracts 33-23,205 ch with
    // none empty, while .content4 matches 76/77 and extracts 0 chars on every
    // one, and .content4b matches 1 and is also empty. extractContent scopes to
    // the first selector that MATCHES AN ELEMENT, not the first that yields
    // text, so either listed ahead of .contentpadding would silently extract
    // nothing and every article would skip `too-thin` on an HTTP 200. Adding
    // .content4b as a *fallback* would instead drop /a/zajednistvo.html, which
    // the implicit root fallback extracts correctly. Hence: exactly one.
    expect(contentSelectors).toEqual([".contentpadding"])
  })

  it("strips the share/CTA/sidebar chrome so citations stay clean", () => {
    const strip = sr().crawl.stripSelectors
    // A custom ELEMENT tag here, not a class (2 instances / 102 ch inside
    // .contentpadding) whose nesting is malformed — it opens inside
    // .contentpadding and closes only after it, so the parser pops it early and
    // it does NOT contain the share block (#128).
    expect(strip).toContain("sitelevel_noindex")
    // …which is why this one is load-bearing: it is the div that actually holds
    // the share icons, and the only selector that removes them.
    expect(strip).toContain(".shareiconsmenupg")
    // The "FEATURE CLOSE" CTA table: 4-6 cells, 55-202 ch per page.
    expect(strip).toContain(".fccell")
    // Site-specific and NOT present in the sibling entries. Audited across all
    // 77 articles: 2 instances / 93 ch of pure nav chrome ("Imate pitanje? /
    // Paket duhovne avanture / Podeli sa drugima" and "► Mapa sajta / ►
    // Pošalji stranicu"), identical on every page and never article text.
    expect(strip).toContain(".sidebar")
  })
})
