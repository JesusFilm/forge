/**
 * The `everystudent` registry entry — EveryStudent's English domain, and the
 * repo's first WALLED source (ADR-0012). Split out of `registry.test.ts` (the
 * §5.5 300-line cap), following `cru.test.ts`.
 *
 * Each guard below encodes a decision that cost real money or real corpus
 * quality to reach, so a future edit cannot quietly undo it:
 *   - the Firecrawl strategy (without it every page is a Cloudflare 403);
 *   - seed-only, because discovery was already paid for (#114);
 *   - no `/podcasts/` (measured 93.8% duplicates of `/wires/` articles);
 *   - robots.txt compliance, which `block` structurally cannot enforce here;
 *   - the CTA/share chrome strip that keeps citations clean.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const es = (): SourceEntry => getSource("everystudent")!

describe("everystudent registry entry", () => {
  it("resolves everystudent as a WALLED, seed-only source fetched through Firecrawl", () => {
    const entry = es()
    expect(entry.domain).toBe("www.everystudent.com")
    expect(entry.languages).toEqual(["en"])
    // The load-bearing fact: without this the acquire loop uses plain HTTP and
    // every page comes back as a Cloudflare 403.
    expect(resolveFetchStrategy(entry)).toBe("firecrawl")
    // Seed-only BY DESIGN — discovery was already paid for via /v2/map (#114),
    // and /sitemap.xml is 403 to plain HTTP anyway. A `sitemaps` entry here
    // would re-pay per scrape for URLs we already hold.
    expect(entry.crawl.sitemaps).toBeUndefined()
    // 116, not 117: /wires/who-was-jesus.html was removed 2026-08-06 under the
    // estate-wide scripture policy — 22,465 chars of Gospel-of-John excerpts
    // with, in the page's own words, "no commentary added" (campaign #111).
    expect(entry.crawl.seedPaths).toHaveLength(116)
    expect(entry.crawl.seedPaths).not.toContain("/wires/who-was-jesus.html")
  })

  it("everystudent seeds exclude the /podcasts/ duplicates and the section indexes", () => {
    const paths = es().crawl.seedPaths!
    // Every /podcasts/ page is an audio read-aloud of an article that already
    // exists under /wires/ or /features/ (93.8% shingle overlap measured on
    // loneliness, 2026-07-24) — ingesting them would buy near-duplicate docs.
    expect(paths.filter((p) => p.startsWith("/podcasts/"))).toEqual([])
    // Section indexes / utility pages, not articles.
    expect(paths.filter((p) => p.startsWith("/menus/"))).toEqual([])
    for (const chrome of [
      "/",
      "/donate",
      "/quiz",
      "/sitemap.html",
      "/contact.php",
    ]) {
      expect(paths).not.toContain(chrome)
    }
    // …but the article whose slug merely LOOKS like a search page is kept.
    expect(paths).toContain("/videos/jobsearch.html")
    // Real content is present across every kept section.
    expect(paths).toContain("/wires/loneliness.html")
    expect(paths).toContain("/knowingGod.html")
  })

  it("everystudent honours robots.txt — no disallowed path is seeded", () => {
    const paths = es().crawl.seedPaths!
    // Verified against the live robots.txt 2026-07-24. `block` cannot enforce
    // this (it filters DISCOVERED urls only), so the seed list is the guard and
    // this test is what keeps it honest when someone hand-adds a path.
    const disallowed = [
      /^\/4laws\.html$/,
      /^\/jdquestions\.html$/,
      /^\/team\//,
      /^\/admin\//,
      /^\/mobi\//,
      /^\/sys\//,
      /^\/mypage\//,
      /^\/atools\//,
      /^\/email\//,
      /^\/contact(US|MY)\.php$/,
    ]
    for (const p of paths) {
      for (const rule of disallowed) expect(p).not.toMatch(rule)
    }
  })

  it("everystudent strips the per-article call-to-action chrome, not just boilerplate", () => {
    const strip = es().crawl.stripSelectors
    // `.fccell` is the "FEATURE CLOSE" CTA table appended verbatim to every
    // article ("I just asked Jesus into my life…"); `sitelevel_noindex` wraps
    // share links + related-article cards. Losing either re-creates the slice-#2
    // accordion-TOC citation-quality problem.
    expect(strip).toContain(".fccell")
    expect(strip).toContain("sitelevel_noindex")
    expect(es().crawl.contentSelectors[0]).toBe(".content4")
  })
})
