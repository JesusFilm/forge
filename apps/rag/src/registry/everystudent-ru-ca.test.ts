/**
 * The `everystudent-ru-ca` registry entry — EveryStudent's Central-Asian
 * Russian domain (studentstan.com).
 *
 * Every guard here encodes a decision that cost real measurement and would be
 * silent and expensive to undo. The load-bearing one is the seed list: this
 * host is a **mirror** of the already-acquired `everystudent-ru`, so the entry
 * exists only to carry the handful of articles that are NOT duplicates. If a
 * future change "completes" the seed list from the site's own map, it silently
 * adds ~81 near-duplicate Russian articles that the ingest dedup gate cannot
 * catch, because that gate keys on `(sourceKey, canonicalUrl)`.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { everystudentRuCa } from "./everystudent-ru-ca.js"
import { getSource } from "./index.js"

const ruCa = everystudentRuCa

describe("everystudent-ru-ca registry entry", () => {
  it("is a SEPARATE key from the Russian sibling it mirrors (ADR-0006)", () => {
    expect(ruCa.key).toBe("everystudent-ru-ca")
    expect(ruCa.key).toMatch(/^[a-z0-9-]+$/)
    expect(ruCa.domain).toBe("www.studentstan.com")
    // One domain = one source, even when the content overlaps heavily. The
    // alternative considered and rejected was folding these paths into
    // everystudent-ru's seedPaths, which would serve two domains from one key
    // and store mirstudentov canonical_urls for pages that live on studentstan.
    const ru = getSource("everystudent-ru")
    expect(ru?.domain).not.toBe(ruCa.domain)
    // Both declare `ru`. That collision is known and deliberately NOT solved
    // here — language-filtered retrieval cannot separate the two.
    expect(ruCa.languages).toEqual(["ru"])
    expect(ru?.languages).toEqual(["ru"])
  })

  it("seeds ONLY the measured-unique articles, never the site's full map", () => {
    // 🔴 The whole point of this entry. Measured 2026-07-30 over all 87
    // studentstan articles against the full 99-article everystudent-ru corpus:
    // 42 pairs at >=95% overlap, mean 84.1%, and the lowest same-slug pair
    // (52.7%) is word-for-word identical on inspection. Only 6 articles are
    // genuinely new; 5 are seeded (see the header for why /a/jfil.html is not).
    expect(ruCa.crawl.seedPaths).toEqual([
      "/a/mutniye.html",
      "/a/uznat.html",
      "/a/aborti.html",
      "/a/rashmor.html",
      "/a/svetlana.html",
    ])
    // Guards against a future "the map lists 86, let's use them all" change.
    expect(ruCa.crawl.seedPaths).toHaveLength(5)
    // The duplicates, named so the intent is explicit rather than inferred
    // from an absence. These are among the >=99% pairs.
    for (const dup of [
      "/a/christianstvo.html",
      "/a/dostoy.html",
      "/a/abdul.html",
      "/a/ad.html",
    ]) {
      expect(ruCa.crawl.seedPaths).not.toContain(dup)
    }
  })

  it("is SEED mode with no discovery — this host has NO sitemap at all", () => {
    // /sitemap.xml, /sitemap_index.xml, /sitemap.xml.gz, /wp-sitemap.xml and
    // /robots.txt are all 404 on the canonical www host (2026-07-30). With no
    // discovery there is nothing for the filters to filter, and critically no
    // `block` array is needed because the seed list IS the filter. Adding
    // discovery here would pull in all 87 articles — see the previous test.
    expect(ruCa.crawl.sitemaps).toBeUndefined()
    expect(ruCa.crawl.allow).toBeUndefined()
    expect(ruCa.crawl.block).toBeUndefined()
    expect(ruCa.crawl.articleHints).toBeUndefined()
    // Apex 301s to www; pinning the wrong one would redirect every fetch.
    expect(ruCa.crawl.baseUrl).toBe("https://www.studentstan.com")
    // Bare Apache, no Cloudflare block page — plain HTTP, no Firecrawl.
    expect(ruCa.crawl.fetchStrategy).toBeUndefined()
  })

  it("scopes to the measured WordPress container, not the FreeFind selectors", () => {
    // This host is NOT the shared EveryStudent template. .post-content binds
    // 86/87 pages at 488-25,282 chars with ZERO matched-but-empty pages, which
    // is what makes the trailing "html" (rule 1e) safe — nothing follows it,
    // so it can shadow nothing, and it beats extract.ts's implicit `?? root`
    // because <html> carries no literal doctype text node.
    expect(ruCa.crawl.contentSelectors).toEqual([".post-content", "html"])
    // .content4 matched 0 pages and 0 chars here, in class AND id form.
    // Inheriting the sibling selector list would bind nothing useful.
    for (const absent of [
      ".content4",
      "#content4",
      ".contentpadding",
      "#contentpadding",
      ".articletitle",
    ]) {
      expect(ruCa.crawl.contentSelectors).not.toContain(absent)
    }
  })

  it("strips THIS host's chrome and carries no dead parity selectors", () => {
    const strip = ruCa.crawl.stripSelectors ?? []
    // .sectionlink is this host's call-to-action: 211 instances across 85
    // pages, 7,591 characters. Nothing else removes it.
    expect(strip).toContain(".sectionlink")
    // `head` is only reachable on the "html" fallback path, and is safe
    // because extract.ts reads the title from `root` BEFORE the strip loop.
    expect(strip).toContain("head")
    // The legacy FreeFind list has 0 instances in this host's raw HTML.
    // Carrying them would claim measurements that were never taken.
    for (const dead of [
      ".fccell",
      ".fctable",
      ".hr2",
      ".articledivider",
      ".relatedbottom",
      ".shareiconsmenupg",
      ".likesharediv",
    ]) {
      expect(strip).not.toContain(dead)
    }
  })
})
