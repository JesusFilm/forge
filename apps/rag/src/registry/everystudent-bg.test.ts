import { describe, expect, it } from "vitest"
import { everystudentBg } from "./everystudent-bg.js"
import { SOURCES } from "./index.js"

describe("everystudent-bg registry entry", () => {
  it("is its own source keyed to its own domain (ADR-0006)", () => {
    expect(everystudentBg.key).toBe("everystudent-bg")
    expect(everystudentBg.domain).toBe("www.everystudent.bg")
    expect(everystudentBg.key).toMatch(/^[a-z0-9-]+$/)
    // Never folded into the English banner as a language variant.
    const keys = SOURCES.map((s) => s.key)
    expect(keys).toContain("everystudent-bg")
    expect(keys).toContain("everystudent")
  })

  it("declares Bulgarian and is plain HTTP, not Firecrawl", () => {
    expect(everystudentBg.languages).toEqual(["bg"])
    expect(everystudentBg.crawl.fetchStrategy).toBeUndefined()
  })

  it("is SEED mode with no discovery — the sitemap names the staging host", () => {
    // Discovery would stamp `staging.everystudent.bg` into canonical_url for
    // all 84 documents. Turning this into a discovery crawl re-introduces that.
    expect(everystudentBg.crawl.sitemaps).toBeUndefined()
    expect(everystudentBg.crawl.block).toBeUndefined()
    expect(everystudentBg.crawl.seedPaths).toHaveLength(84)
    expect(everystudentBg.crawl.baseUrl).toBe("https://www.everystudent.bg")
    for (const p of everystudentBg.crawl.seedPaths ?? []) {
      expect(p).toMatch(/^\/[^/]+\/[^/]+\.html$/)
    }
  })

  it("binds the measured Angular container, never the legacy template", () => {
    // Measured 2026-07-29: .content4/.content4b/.contentpadding/.articletitle
    // have 0 instances on every page here. A single selector, never a chain —
    // a zero-text match shadows everything after it (rule 1b).
    expect(everystudentBg.crawl.contentSelectors).toEqual([".article-content"])
  })

  it("does not carry the legacy strip list, which measured 0 instances", () => {
    const strip = everystudentBg.crawl.stripSelectors
    for (const dead of [
      "sitelevel_noindex",
      ".fccell",
      ".fctable",
      ".hr2",
      ".articledivider",
      ".relatedbottom",
      ".shareiconsmenupg",
    ]) {
      expect(strip).not.toContain(dead)
    }
  })

  it("omits the homepage, nav pages and both email-signup landers", () => {
    const seeds = everystudentBg.crawl.seedPaths ?? []
    // All measured above the 250 floor, so only omission excludes them.
    const johnSignup =
      "/%D0%B5%D0%B2%D0%B0%D0%BD%D0%B3%D0%B5%D0%BB%D0%B8%D0%B5%D1%82%D0%BE-%D0%BD%D0%B0-%D0%99%D0%BE%D0%B0%D0%BD.html"
    expect(seeds).not.toContain(johnSignup)
    expect(seeds).not.toContain("/")
    // No single-segment root page is seeded — every seed is /section/slug.html.
    expect(seeds.filter((p) => !/^\/[^/]+\/[^/]+\.html$/.test(p))).toEqual([])
  })
})
