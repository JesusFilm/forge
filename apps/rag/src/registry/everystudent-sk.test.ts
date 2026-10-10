/**
 * The `everystudent-sk` registry entry — EveryStudent's Slovak domain
 * (everystudent.sk). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following the sibling `everystudent-*.test.ts` files.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - the BARE apex host, because `www.` 301s away and every regex would miss;
 *   - `.entry-content` alone — this is WordPress + Elementor, so neither the
 *     `.content4`/`.contentpadding` family NOR the Czech host's `.content`
 *     exists here, and any of them added as a "fallback" would shadow the real
 *     container at 0 chars;
 *   - the LIVE Yoast index rather than the 2014 `/sitemap.xml` fossil;
 *   - the 3 pinned seeds, without which a 4-part series lands 3 parts short;
 *   - the URL blocks, which are the ONLY discrimination available because
 *     articles, categories and pages all share one bare-slug URL shape.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const sk = (): SourceEntry => getSource("everystudent-sk")!
const HOST = "https://everystudent.sk"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = sk().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-sk registry entry", () => {
  it("resolves as an UNWALLED Slovak source pinned to the BARE apex host", () => {
    const entry = sk()
    // ⚠️ The reverse of every sibling: measured 2026-07-29,
    // https://www.everystudent.sk/ 301s to https://everystudent.sk/, and every
    // Yoast <loc> is emitted bare. A "www." here would make every regex miss.
    expect(entry.domain).toBe("everystudent.sk")
    expect(entry.crawl.baseUrl).toBe(HOST)
    expect(entry.languages).toEqual(["sk"])
    // ~140 plain-HTTP GETs returned 100 x 200 / 3 x 301, zero 403s, no
    // Cloudflare block page (`server: openresty`). Declaring a strategy would
    // bill Firecrawl credits for a wall that does not exist.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("discovers from the LIVE Yoast index, never the 2014 /sitemap.xml fossil", () => {
    const entry = sk()
    // Two sitemaps exist. /sitemap_index.xml is current (Yoast, lastmod
    // 2026-06-03, 3 children = 103 URLs) and auto-recurses. /sitemap.xml is a
    // google-sitemap-generator dump stamped "July 21, 2014" whose 27 unique
    // slugs are 23 redirects onto documents already held plus 4 hard 404s —
    // listing it would stage duplicates at old URLs no content hash collapses.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap_index.xml"])
    expect(entry.crawl.sitemaps).not.toContain("/sitemap.xml")
    expect(entry.crawl.maxPages).toBeGreaterThan(103) // 103 live sitemap URLs
    expect(entry.crawl.minContentLength).toBe(250)
  })

  it("pins the 3 series parts the sitemap omits, or the series lands incomplete", () => {
    // /vznik-vesmiru-1/ is in the sitemap; parts II-IV are NOT, and were found
    // only by an href harvest across all 100 fetched pages. Measured
    // 2026-07-29: 8,587 / 6,802 / 7,393 ch, all Slovak, all binding
    // .entry-content once. Dropping these seeds silently truncates a 4-part
    // argument to its first part.
    expect(sk().crawl.seedPaths).toEqual([
      "/vznik-vesmiru-2/",
      "/vznik-vesmiru-3/",
      "/vznik-vesmiru-4/",
    ])
    expect(seedUrls(sk())).toEqual([
      `${HOST}/vznik-vesmiru-2/`,
      `${HOST}/vznik-vesmiru-3/`,
      `${HOST}/vznik-vesmiru-4/`,
    ])
  })

  it("is a SEPARATE source key per domain and NOT folded into the Czech sibling (ADR-0006)", () => {
    // One domain = one source. everystudent.sk and everystudent.cz are distinct
    // domains, distinct languages AND distinct applications (WordPress+Elementor
    // vs a bespoke Yii PHP app). Measured cross-estate 8-gram overlap between
    // real Czech articles and all 94 Slovak bodies: 0.00%.
    const cs = getSource("everystudent-cs")!
    expect(cs.languages).toEqual(["cs"])
    expect(sk().key).toBe("everystudent-sk")
    expect(sk().domain).not.toBe(cs.domain)
    const keys = ["everystudent", "everystudent-cs", "everystudent-sk"]
    expect(new Set(keys.map((k) => getSource(k)!.domain)).size).toBe(3)
  })

  it("scopes to .entry-content alone — the sibling and Czech selectors are absent here", () => {
    const { contentSelectors, stripSelectors } = sk().crawl
    // Measured 2026-07-29 with the repo's own extractContent over all 100
    // fetched pages: .entry-content matches 100/100 (478-31,789 ch, 1 instance
    // per article). .contentpadding, .content4, .content4b, .articletitle and
    // everystudent.cz's .content ALL match 0 of 100. extractContent binds the
    // first selector that MATCHES rather than the first that yields text, so
    // adding any of them "as a fallback" risks a 0-char shadow. Exactly one.
    expect(contentSelectors).toEqual([".entry-content"])
    for (const dead of [
      ".contentpadding",
      ".content4",
      ".content4b",
      ".content",
      ".articletitle",
    ]) {
      expect(contentSelectors).not.toContain(dead)
    }
    // The only site-specific chrome that binds: Elementor CTA buttons, 78/94
    // pages / 4,341 ch. The legacy FreeFind selectors are 0 instances here and
    // are deliberately omitted rather than carried as dead config.
    expect(stripSelectors).toContain(".elementor-widget-button")
    for (const noop of ["sitelevel_noindex", ".fccell", ".shareiconsmenupg"]) {
      expect(stripSelectors).not.toContain(noop)
    }
    // ⚠️ These CONTAIN the article body (493,669 / 479,774 ch corpus-wide) and
    // .elementor-widget-heading wraps a real section heading on one article.
    for (const keep of [
      ".elementor-widget-text-editor",
      ".e-con",
      ".elementor-widget-heading",
    ]) {
      expect(stripSelectors).not.toContain(keep)
    }
  })

  it("blocks the non-articles that minContentLength cannot catch, and keeps the real ones", () => {
    // Articles, categories and pages ALL share the bare `/<slug>/` shape here,
    // so articleHints cannot separate them — `block` does all the work.
    // Every figure below is post-strip, measured 2026-07-29.
    expect(keeps(`${HOST}/`)).toBe(false) // homepage, 581 ch
    expect(keeps(`${HOST}/existencia/`)).toBe(false) // category, 0 ch (shadow)
    expect(keeps(`${HOST}/uncathegorized/`)).toBe(false)
    expect(keeps(`${HOST}/otazky-a-odpovede/`)).toBe(false) // 1,224 ch link index
    expect(keeps(`${HOST}/o-nas/`)).toBe(false) // 1,125 ch about
    expect(keeps(`${HOST}/posli-modlitebnu-prosbu/`)).toBe(false) // 393 ch form
    // Email-series signups, 1,737-2,600 ch — the Slovak twins of the French
    // /jean.html + /aventure.html. All clear the floor; only a URL block works.
    expect(keeps(`${HOST}/studium-janovho-evanjelia/`)).toBe(false)
    expect(keeps(`${HOST}/emailove-balicky/`)).toBe(false)
    expect(keeps(`${HOST}/hladanie-pravdy/`)).toBe(false)
    expect(keeps(`${HOST}/startovaci-balicek/`)).toBe(false)
    // ⚠️ These 3 are LIVE sitemap URLs that 301 to the homepage (expired event
    // stubs). Unblocked they stage 3 byte-identical copies of the 581-ch
    // homepage — the exact failure a sibling shipped 25 of.
    expect(keeps(`${HOST}/dusickova-sutaz/`)).toBe(false)
    expect(keeps(`${HOST}/predvianocna-skupinka/`)).toBe(false)
    expect(keeps(`${HOST}/velkonocna-sutaz/`)).toBe(false)
    // robots.txt Disallow rules, mirrored by hand because acquire does not
    // enforce robots.txt. /wp-login.php is genuinely linked from live pages.
    expect(keeps(`${HOST}/wp-login.php`)).toBe(false)
    expect(keeps(`${HOST}/wp-admin/`)).toBe(false)
    expect(keeps(`${HOST}/prihl/`)).toBe(false)
    expect(keeps(`${HOST}/?s=boh`)).toBe(false)
    // ...and the articles must survive: apologetics, the long Bible-reliability
    // essay (31,734 ch of prose ABOUT the Bible, not Bible text), a
    // person-named testimony, and the real love-languages article whose
    // 546-ch quiz teaser twin IS blocked.
    expect(keeps(`${HOST}/existuje-boh/`)).toBe(true)
    expect(keeps(`${HOST}/je-biblia-pravdiva/`)).toBe(true)
    expect(keeps(`${HOST}/gabika/`)).toBe(true)
    expect(keeps(`${HOST}/5-jazykov-lasky/`)).toBe(true)
    expect(keeps(`${HOST}/5-jazykov-lasky-test/`)).toBe(false)
    expect(keeps(`${HOST}/vznik-vesmiru-1/`)).toBe(true)
  })
})
