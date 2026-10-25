/**
 * The `everystudent-it` registry entry — EveryStudent's Italian domain
 * (ognistudente.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-sq.test.ts` / `everystudent-pl.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds — the XML sitemap is complete, and the
 *     only four on-site URLs it lacks are 301s to pages already in it;
 *   - `contentSelectors: [".post-content"]` and nothing else. This host is
 *     **WordPress 6.7.5 / theme sight2016**, not the FreeFind template every
 *     sibling uses; all seven previously-catalogued container classes are 0
 *     matches here, and copying them in "as fallbacks" is the exact mistake
 *     that broke five pilot entries;
 *   - the robots.txt Disallow on `/personalmente2/`, which the acquire path
 *     does not enforce for us;
 *   - the flat-permalink shape of `articleHints`, which is what keeps the six
 *     `/category/` indexes and the homepage out structurally.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const itSrc = (): SourceEntry => getSource("everystudent-it")!
const HOST = "https://www.ognistudente.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = itSrc().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-it registry entry", () => {
  it("resolves everystudent-it as an UNWALLED Italian source crawled over plain HTTP", () => {
    const entry = itSrc()
    expect(entry.domain).toBe("www.ognistudente.com")
    expect(entry.languages).toEqual(["it"])
    // Verified 2026-07-29: robots.txt, /sitemap.xml and all 50 sitemap URLs
    // returned HTTP/2 200 to plain curl against bare Apache, with zero
    // Cloudflare block-page signatures. Declaring a strategy here would bill
    // every page through Firecrawl for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. ognistudente.com is its own domain, so the
    // Italian content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(itSrc().domain)
    expect(itSrc().key).toBe("everystudent-it")
    expect(itSrc().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("is a DISCOVERY crawl off the live sitemap, with nothing pinned as seeds", () => {
    const entry = itSrc()
    // /sitemap.xml answered 200 (7,611 bytes, 50 <loc>, all distinct). Every
    // internal href on all 50 pages was harvested as a cross-check: the only
    // four real URLs the XML lacks (/allinizio-era-il-nulla/,
    // /oltre-la-fede-cieca/, /personalmente/, /lavventura-spirituale/) are all
    // 301s to pages already in it. So there is nothing to pin.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    expect(entry.crawl.maxPages).toBeGreaterThan(50) // 50 sitemap URLs
  })

  it("binds ONLY the measured WordPress container — no FreeFind selector may be added", () => {
    const selectors = itSrc().crawl.contentSelectors
    // The load-bearing fact. This host is WordPress 6.7.5 / theme sight2016,
    // not the FreeFind template. Measured 2026-07-29 with the repo's own
    // extractContent over all 50 fetched pages: `.post-content` matches 50/50
    // and yields 1,443-28,485 chars on the 38 articles.
    expect(selectors).toEqual([".post-content"])
    // extractContent scopes to the FIRST selector that MATCHES an element, not
    // the first that yields text — so a sibling selector added "as a fallback"
    // can shadow the real container and skip every page as `too-thin` on an
    // HTTP 200. All seven of these measured 0 matches on this host; none of
    // them belongs here.
    for (const dead of [
      ".contentpadding",
      ".content4",
      ".content4b",
      ".cb-entry-content",
      ".entry-content",
      ".contentleftpadding",
      ".article-content",
    ]) {
      expect(selectors).not.toContain(dead)
    }
  })

  it("strips this host's own CTA and share chrome, and no FreeFind parity no-ops", () => {
    const strip = itSrc().crawl.stripSelectors
    // `.sectionlink` is the only real strip here: 2-3 instances removing 58-159
    // chars, the CTA link pair closing every article body (this host's
    // equivalent of the siblings' .fccell). `.a2a_kit` is the AddToAny share
    // row — 0 chars today because the buttons are images, kept as a drift guard.
    expect(strip).toContain(".sectionlink")
    expect(strip).toContain(".a2a_kit")
    // Each of these has ZERO occurrences in this host's raw HTML — not zero
    // extracted chars, zero markup. On WordPress they cannot drift into
    // existence, so carrying them would be theatre copied from a sibling.
    for (const absent of [
      "sitelevel_noindex",
      ".fccell",
      ".fctable",
      ".hr2",
      ".articledivider",
      ".relatedbottom",
      ".shareiconsmenupg",
    ]) {
      expect(strip).not.toContain(absent)
    }
  })

  it("keeps flat article permalinks and drops robots-disallowed, signup, index and homepage URLs", () => {
    expect(keeps(`${HOST}/trinita/`)).toBe(true)
    expect(keeps(`${HOST}/bibbia/`)).toBe(true)
    // /chi/ and /chi-2/ look like the ceu/ceu2 duplicate hazard but measured
    // 0.0% 12-word shingle overlap — a deliberate continuation series.
    expect(keeps(`${HOST}/chi/`)).toBe(true)
    expect(keeps(`${HOST}/chi-2/`)).toBe(true)
    // All 50 slugs are lowercase today, but the hint must not assume it.
    expect(keeps(`${HOST}/Maiuscola-Test/`)).toBe(true)

    // robots.txt disallows /personalmente2/ (written as an absolute URL, so a
    // strict parser matches nothing) and five legacy prefixes. The acquire path
    // does NOT enforce robots.txt, so these blocks are the enforcement.
    expect(keeps(`${HOST}/personalmente2/`)).toBe(false)
    expect(keeps(`${HOST}/articoli/qualcosa.html`)).toBe(false)
    expect(keeps(`${HOST}/menus/intl.html`)).toBe(false)
    // The 7-email "L'Avventura Spirituale" signup, 1,364 chars — it CLEARS the
    // 250 floor, so only a URL block excludes it.
    expect(keeps(`${HOST}/lavventura-spirituale-post/`)).toBe(false)
    // Site plan (1,454 ch) and credits (982 ch) — both clear the floor too.
    expect(keeps(`${HOST}/mappa-del-sito/`)).toBe(false)
    expect(keeps(`${HOST}/crediti/`)).toBe(false)
    // Category indexes and homepage: excluded structurally by the
    // single-path-segment hint, and blocked as well.
    expect(keeps(`${HOST}/category/conoscere-dio/`)).toBe(false)
    expect(keeps(`${HOST}/`)).toBe(false)
    // WordPress plumbing linked from every page.
    expect(keeps(`${HOST}/wp-json/wp/v2/posts/806`)).toBe(false)
    expect(keeps(`${HOST}/esisteundio/feed/`)).toBe(false)
  })
})
