/**
 * The `everystudent-zh-tw` registry entry — EveryStudent's Traditional-Chinese
 * domain (everystudent.com.tw). Split out of `registry.test.ts` (the §5.5
 * 300-line cap), following `everystudent-zh-cn.test.ts` / `everystudent-fr.test.ts`.
 *
 * Each guard below encodes a decision that was measured on 2026-07-29 and would
 * be costly to silently undo:
 *   - `languages: ["zh"]`, the ISO 639-1 base code — NOT `["zh-tw"]`;
 *   - a SEPARATE key from `everystudent` / `everystudent-zh-cn`, one domain = one source;
 *   - discovery, not seeds, because the sitemap is reachable over plain HTTP;
 *   - the SINGLE measured content selector, because extract.ts is first-match-wins
 *     and a chain here would only risk shadowing;
 *   - the block on the KnowHimPersonally tract, which the length floor cannot catch.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const tw = (): SourceEntry => getSource("everystudent-zh-tw")!

/** Replicates discover.ts `keepUrl` exactly: allow ∧ articleHints ∧ ¬block. */
function keepUrl(url: string, entry: SourceEntry): boolean {
  const compile = (p?: string[]) => (p ?? []).map((x) => new RegExp(x))
  const any = (res: RegExp[]) => res.some((re) => re.test(url))
  const allow = compile(entry.crawl.allow)
  const hints = compile(entry.crawl.articleHints)
  const block = compile(entry.crawl.block)
  if (allow.length > 0 && !any(allow)) return false
  if (hints.length > 0 && !any(hints)) return false
  if (block.length > 0 && any(block)) return false
  return true
}

describe("everystudent-zh-tw registry entry", () => {
  it("declares the ISO 639-1 base code `zh`, never the `zh-tw` regional variant", () => {
    const entry = tw()
    // The variant is recorded in the KEY, the name and the docstring only.
    // Content detection emits bare `zh`, so anything else would make the
    // declared language disagree with every stored per-document label.
    expect(entry.languages).toEqual(["zh"])
    expect(entry.languages).not.toContain("zh-tw")
    expect(entry.key).toBe("everystudent-zh-tw")
    // Bare host is canonical — www.everystudent.com.tw 301s to it (2026-07-29).
    expect(entry.domain).toBe("everystudent.com.tw")
    expect(entry.crawl.baseUrl).toBe("https://everystudent.com.tw")
  })

  it("is an UNWALLED discovery crawl, not a seeded one", () => {
    const entry = tw()
    // Verified 2026-07-29: all 70 sitemap URLs returned 200 through Cloudflare
    // with no block-page signature, and /sitemap.xml answers plain HTTP. So no
    // fetchStrategy — Firecrawl would bill per page for nothing.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, like everystudent-zh-cn and thelife-fr: the sitemap is free.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
  })

  it("is a SEPARATE key from the English and Simplified banners (ADR-0006)", () => {
    // One domain = one source. everystudent.com.tw must not be folded into
    // `everystudent` as a second language, nor merged with the Simplified
    // banner — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    const cn = getSource("everystudent-zh-cn")!
    const domains = [en.domain, cn.domain, tw().domain]
    expect(new Set(domains).size).toBe(3)
    expect(en.languages).toEqual(["en"])
    // ⚠️ KNOWN, ACCEPTED collision: three sources now declare `zh` — this one
    // (Traditional), everystudent-zh-cn and thelife-zh (both Simplified).
    // Language-filtered retrieval cannot separate them; the corpus has no
    // script facet. Asserted so the collision stays visible, not fixed here.
    for (const k of [
      "thelife-zh",
      "everystudent-zh-cn",
      "everystudent-zh-tw",
    ]) {
      expect(getSource(k)!.languages).toEqual(["zh"])
    }
  })

  it("binds the ONE measured container, and none of the sibling templates", () => {
    const entry = tw()
    // extract.ts binds the FIRST selector matching an ELEMENT and stops, even
    // if that element yields 0 chars — so a fallback chain can only shadow.
    // .entry-content was measured extracting the body on all 46 kept articles
    // (median 1,204 ch); it is present exactly once per article page.
    expect(entry.crawl.contentSelectors).toEqual([".entry-content"])
    // This host is WordPress/Enfold: the legacy shared template and the zh-cn
    // `cb-` theme were both measured at 0 occurrences here (2026-07-29).
    for (const dead of [
      ".content4",
      ".content4b",
      ".articletitle",
      ".contentpadding",
      ".cb-entry-content",
      "#cb-content",
    ]) {
      expect(entry.crawl.contentSelectors).not.toContain(dead)
    }
  })

  it("strips only chrome measured removing text, including load-bearing noscript", () => {
    const strip = tw().crawl.stripSelectors
    // EWWW lazy-load emits <noscript><img srcset="..."></noscript> and
    // node-html-parser treats noscript content as RAW TEXT — 70,746 ch of
    // base64/URL junk across 43 of 46 articles. Removing this entry would
    // roughly double the corpus with garbage.
    expect(strip).toContain("noscript")
    // Site-specific, each measured: 1,466 / 1,370 / 368 / 211 chars removed.
    // .relatedlink is NOT redundant with .av_promobox — /content/WhoIsHe/whichdenom/
    // carries it unwrapped.
    for (const sel of [
      ".av_promobox",
      ".relatedlink",
      ".heateor_sss_sharing_container",
      ".bottomlink",
    ]) {
      expect(strip).toContain(sel)
    }
    // Measured removing 0 chars on 0 pages — never ship unmeasured strip config.
    for (const dead of [
      ".heateorSssClear",
      ".avia-post-nav",
      ".av_toc_container",
    ]) {
      expect(strip).not.toContain(dead)
    }
    // Shared-template chrome: 0 occurrences on this host.
    for (const dead of ["sitelevel_noindex", ".fccell", ".relatedbottom"]) {
      expect(strip).not.toContain(dead)
    }
  })

  it("keeps the mixed-case article URLs and drops the tract, nav and index pages", () => {
    const entry = tw()
    const u = (p: string) => `https://everystudent.com.tw${p}`
    // discover.ts compiles patterns with `new RegExp(p)` — NO `i` flag — and
    // the live sitemap mixes casings for the SAME section. A literal section
    // allow-list would silently drop the lower-cased half of the corpus.
    for (const p of [
      "/content/WhoIsHe/faith201/",
      "/content/whoishe/bible220/",
      "/content/LifeIssues/Parents540/",
      "/content/lifeissues/facing-anxiety/",
      "/content/Enigmas/Suffering631/",
      "/content/TheExperience/inner-universe/",
    ]) {
      expect(keepUrl(u(p), entry)).toBe(true)
    }
    // ⚠️ Blocked BY URL, never left to minContentLength: these have no
    // .entry-content, so extract.ts falls back to <body> and returns 195-3,238
    // chars of nav — 11 of the 18 such pages clear the 250 floor.
    for (const p of [
      "/knowhimpersonally02/", // the localized gospel tract, 9 paginated steps
      "/knowhimpersonally10/",
      "/knowhimpersonally-video/",
      "/contentknowhimpersonallyindex-2/", // <title> says 「(備份，勿刪)」 — backup
      "/content/KnowHimPersonally2/",
      "/content/knowhimpersonally/index/",
      "/content/knowhimpersonally/index/old", // legacy Four Spiritual Laws duplicate
      "/content/KnowHimPersonally/ReceiveJesus/", // decision follow-up
      "/content/KnowHimPersonally/ReceiveJesus_question/",
      "/content/ContactUs/",
      "/about-us/",
      "/world-language-list/", // the 35+ sibling-language directory
      "/content/whoishe/", // section index — cards live outside .entry-content
      "/content/lifeIssues/",
      "/content/tag/landscape/", // WordPress tag archive
      "/",
    ]) {
      expect(keepUrl(u(p), entry)).toBe(false)
    }
  })

  it("caps the crawl above the measured sitemap size and keeps the sibling floor", () => {
    const crawl = tw().crawl
    // 70 <loc> entries measured 2026-07-29; 46 survive allow ∧ hints ∧ ¬block.
    expect(crawl.maxPages).toBeGreaterThan(70)
    // 0 of the 46 articles fall below 250 (min 646), so the floor drops nothing
    // and stays at the sibling default rather than being tuned for CJK.
    expect(crawl.minContentLength).toBe(250)
    expect(crawl.requestDelayMs).toBe(1000)
    expect(tw().defaultTags).toContain("lang:zh")
    expect(tw().defaultCategory).toBe("article")
  })
})
