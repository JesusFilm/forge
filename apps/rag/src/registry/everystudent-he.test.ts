/**
 * The `everystudent-he` registry entry — igod.co.il, the Hebrew banner.
 * Split out per the §5.5 300-line cap, following `everystudent-fr.test.ts`.
 *
 * Each guard encodes a measurement from 2026-07-30 that would be expensive to
 * rediscover and silent to undo:
 *   - the article hint must survive HEBREW-SCRIPT slugs (947 of 1,020 URLs);
 *   - the two shadow selectors that would zero out every article must stay out;
 *   - `form` must stay OUT of the strip list (it wraps 38,759 chars of prose);
 *   - the two-segment archive URLs must stay blocked (they match the hint);
 *   - robots.txt's `/wp-admin/` disallow is honoured by URL, not by a crawler.
 * Filters are exercised against real URLs the way `discover.ts` does, never
 * asserted as literals. Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const he = (): SourceEntry => getSource("everystudent-he")!

/** Mirror of discover.ts `keepUrl`: allowed ∧ article-shaped ∧ not blocked. */
function discovers(url: string): boolean {
  const { allow, block, articleHints } = he().crawl
  const any = (pats: string[] | undefined): boolean =>
    (pats ?? []).some((p) => new RegExp(p).test(url))
  return (
    any(allow) &&
    any(articleHints) &&
    !(block ?? []).some((p) => new RegExp(p).test(url))
  )
}

describe("everystudent-he registry entry", () => {
  it("is a plain-HTTP DISCOVERY source on the bare apex, not seed-only", () => {
    const entry = he()
    // www.igod.co.il 301s to the apex, and all 1,182 sitemap <loc>s use it.
    expect(entry.domain).toBe("igod.co.il")
    expect(entry.languages).toEqual(["he"])
    // Cloudflare fronts the host but never blocks: ~150 GETs, no block page.
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // /sitemap.xml is a <sitemapindex> of 5 children holding 1,020 posts — the
    // "~5 articles" recon counted the children. Discovery, and no seeds: the
    // link harvest found ZERO articles the sitemap misses.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(entry.crawl.maxPages).toBeGreaterThan(1020)
  })

  it("discovers HEBREW-SCRIPT article URLs — an ASCII-only hint would find 73 of 1,020", () => {
    // 947 of 1,020 slugs and 668 category segments are literal (unescaped)
    // Hebrew in the <loc>, and discover.ts matches the RAW string.
    expect(discovers("https://igod.co.il/עדויות-רבנים/הרב-דר-מולר/")).toBe(true)
    expect(
      discovers(
        "https://igod.co.il/נבואות-על-המשיח/prophet-daniel-knew-when-messiah-comes/",
      ),
    ).toBe(true)
    expect(discovers("https://igod.co.il/devotionals/great-hope-psalm/")).toBe(
      true,
    )
    // Every <loc> is https:// — an http:// pin would discover nothing.
    expect(discovers("http://igod.co.il/devotionals/great-hope-psalm/")).toBe(
      false,
    )
  })

  it("blocks the two-segment archives that DO match the article shape", () => {
    // These all look exactly like `/<category>/<slug>/`, so the shape hint
    // cannot exclude them — 72 /category/ + 74 /tag/ in the sitemap, 9
    // /author/ found by link harvest, and /page/2/ which returns HTTP 200.
    expect(discovers("https://igod.co.il/category/מדע-אמונה/")).toBe(false)
    expect(discovers("https://igod.co.il/tag/אבולוציה/")).toBe(false)
    expect(discovers("https://igod.co.il/author/william-lane-craig/")).toBe(
      false,
    )
    expect(discovers("https://igod.co.il/page/2/")).toBe(false)
    // robots.txt says `Disallow: /wp-admin/`, and the acquire path does not
    // enforce robots — so this two-segment URL is blocked BY HAND.
    expect(discovers("https://igod.co.il/wp-admin/admin-ajax.php")).toBe(false)
    // The gospel decision/signup form and its confirmation twin.
    expect(discovers("https://igod.co.il/gospel-form/")).toBe(false)
    expect(discovers("https://igod.co.il/gospel-form-confirmation/")).toBe(
      false,
    )
    expect(discovers("https://igod.co.il/")).toBe(false)
  })

  it("binds the ONE measured container first and excludes both shadow selectors", () => {
    const sel = he().crawl.contentSelectors
    // Present on 45 of 45 posts; median 2,652 chars after strips.
    expect(sel[0]).toBe(".elementor-widget-theme-post-content")
    // extractContent binds the first selector that MATCHES AN ELEMENT, not the
    // first that yields text. `.entry-content` is a related-post teaser that
    // extracts a CONSTANT 286 chars on 43 of 51 pages, and
    // `.elementor-widget-container` extracts 0 on 51 of 51 — either one listed
    // ahead would silently reduce every article to a teaser or to nothing.
    expect(sel).not.toContain(".entry-content")
    expect(sel).not.toContain(".elementor-widget-container")
    // The tail may only ever be last: it must not shadow the container.
    expect(sel[sel.length - 1]).toBe("html")
    // <body> never parses on this host (the parser hoists to <html>), so the
    // "head" strip is what keeps the fallback path from duplicating <title>.
    expect(he().crawl.stripSelectors).toContain("head")
  })

  it("does NOT strip <form> — it wraps 38,759 chars of real article prose here", () => {
    const strip = he().crawl.stripSelectors
    // Every sibling entry strips forms. This host must not: measured on
    // /טענות-רבנים.../מה-זה-השילוש-הקדוש.../ a <form> encloses 54% of the body.
    expect(strip).not.toContain("form")
    // The view counter ("צפיות: N") is the only non-prose node in the body.
    expect(strip).toContain(".post-views")
    // This is WordPress + Elementor, not the FreeFind generator: each of these
    // measured 0 instances on every page, so none is carried as a no-op.
    for (const freefind of [
      "sitelevel_noindex",
      ".fccell",
      ".fctable",
      ".hr2",
      ".articledivider",
      ".relatedbottom",
      ".shareiconsmenupg",
    ]) {
      expect(strip).not.toContain(freefind)
    }
  })

  it("is a SEPARATE source key from everystudent, and does not claim Cru's copyright", () => {
    // One domain = one source (ADR-0006) — igod.co.il is its own domain.
    const en = getSource("everystudent")!
    expect(he().key).toBe("everystudent-he")
    expect(he().domain).not.toBe(en.domain)
    expect(en.languages).toEqual(["en"])
    // The footer reads "© 2026 – כל הזכויות שמורות המכללה למקרא" and no page on
    // this host mentions Cru. The siblings' "(Cru)" line would misattribute it.
    expect(he().rights).toContain("המכללה למקרא")
    expect(he().rights).not.toContain("(Cru)")
  })
})
