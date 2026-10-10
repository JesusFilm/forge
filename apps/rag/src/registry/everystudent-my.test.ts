/**
 * The `everystudent-my` registry entry — EveryStudent's Burmese domain
 * (everymyanmarstudent.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-sq.test.ts` / `everystudent-pl.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the sitemap is reachable and the
 *     site's own HTML map is an exact match for it;
 *   - `.contentpadding` FIRST with `.content4` absent — `.content4` matches 30
 *     of the 31 articles and extracts 0 chars on all 30, so listing it would
 *     shadow the real container and ingest nothing;
 *   - `"html"` LAST, which is the only thing rescuing `/a/prayers.html`;
 *   - the two robots.txt Disallows, one of which names an `/a/` article path;
 *   - `/m/`, contact, site plan and homepage, all of which clear the 250 floor.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const my = (): SourceEntry => getSource("everystudent-my")!
const HOST = "https://www.everymyanmarstudent.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = my().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-my registry entry", () => {
  it("resolves everystudent-my as an UNWALLED Burmese source on the www host", () => {
    const entry = my()
    // The apex 301s to www (measured 2026-07-30, and checked in BOTH directions
    // because everystudent.sk redirects the other way). Every <loc> is www, and
    // the filters match the full absolute URL, so a bare-apex pin misses all 31.
    expect(entry.domain).toBe("www.everymyanmarstudent.com")
    expect(entry.crawl.baseUrl).toBe(HOST)
    expect(entry.languages).toEqual(["my"])
    // Verified 2026-07-30: all 38 sitemap URLs returned HTTP/2 200 to plain curl
    // against bare Apache — no Cloudflare layer, no block page. Declaring a
    // strategy here would bill every page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, not a hand-listed seed set", () => {
    const entry = my()
    // /sitemap.xml answered 200 (3,301 bytes, 38 distinct <loc>, all https), and
    // /sitemap_index.xml 404s so there is no newer index hiding behind it. The
    // site's own HTML map (/sitemap.html) lists exactly the same 31 /a/ URLs,
    // and a sweep of every internal href on all 38 pages found only one further
    // /a/ path — the robots-disallowed one. Nothing needs pinning.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    // The sitemap publishes https, so an ^https:// pin discovers the full set —
    // unlike everystudent.gr, whose http <loc>s a same-shaped pin would miss.
    expect(entry.crawl.allow).toEqual([
      "^https://www\\.everymyanmarstudent\\.com/",
    ])
    expect(entry.crawl.maxPages).toBeGreaterThan(38) // 38 sitemap URLs
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. everymyanmarstudent.com is its own domain, so the
    // Burmese content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(my().domain)
    expect(my().key).toBe("everystudent-my")
    expect(my().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("keeps the 31 /a/ articles and drops the indexes, contact, site plan and homepage", () => {
    expect(keeps(`${HOST}/a/isthere.html`)).toBe(true)
    // One slug is mixed-case. A [a-z0-9-]+ hint was simulated against the live
    // sitemap and keeps only 30 of 31, silently dropping this article.
    expect(keeps(`${HOST}/a/Godreal.html`)).toBe(true)
    // Every exclusion below was fetched and measured 2026-07-30, and every one
    // CLEARS minContentLength — so the floor could not catch a single one and
    // these URL blocks are doing real work.
    expect(keeps(`${HOST}/m/existence.html`)).toBe(false) // 734 ch
    expect(keeps(`${HOST}/m/relationships.html`)).toBe(false) // 321 ch, off-sitemap
    expect(keeps(`${HOST}/sitemap.html`)).toBe(false) // 1,201 ch site plan
    expect(keeps(`${HOST}/contact.html`)).toBe(false) // 364 ch — clears 250
    // The homepage extracts 802 chars via the `html` container, NOT 0.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(my().crawl.minContentLength).toBe(250)
  })

  it("honours both robots.txt Disallows by hand, including the one naming an /a/ article", () => {
    // The acquire path does not enforce robots.txt, so the two rules fetched
    // live 2026-07-30 are blocked here explicitly.
    // /a/followup.html sits under /a/, MATCHES articleHints, returns 200 and
    // extracts 3,499 chars — neither the hints nor the floor would exclude it.
    // It is absent from the sitemap today but linked from every article's CTA,
    // which is exactly how a later widening could quietly readmit it.
    expect(keeps(`${HOST}/a/followup.html`)).toBe(false)
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false)
  })

  it("binds .contentpadding FIRST, never lets the empty .content4 shadow it, and falls back to html", () => {
    const { contentSelectors, stripSelectors } = my().crawl
    // Measured 2026-07-30 with the repo's own extractContent over all 38 pages.
    // `.contentpadding` matches 33 and extracts 0 chars on NONE of them.
    expect(contentSelectors[0]).toBe(".contentpadding")
    // `.content4` matches 30 of the 31 articles and yields 0 chars on all 30.
    // extractContent binds the first selector that MATCHES AN ELEMENT rather
    // than the first that yields text, so listing it would win and return "" —
    // 30 articles skipping `too-thin` on a 200, invisible to these tests. This
    // is the batch-1 failure (#128). `#content4` and `.content4b` don't bind.
    expect(contentSelectors).not.toContain(".content4")
    expect(contentSelectors).not.toContain("#content4")
    // `html` LAST so it can shadow nothing. It fires on exactly one article,
    // /a/prayers.html, whose div stack collapses so `.contentpadding` never
    // forms — a genuine 12,240-char article that would otherwise be lost.
    // <body> is absent from all 31 articles, so the implicit fallback would
    // otherwise be the whole document root.
    expect(contentSelectors[contentSelectors.length - 1]).toBe("html")
    // Load-bearing ONLY because of that fallback: `head` and `script` cost 0
    // chars on the 32 .contentpadding-bound pages but remove 106 and 8,271
    // chars respectively on /a/prayers.html. Safe because extract.ts reads the
    // title from `root` before the strip loop — keep those two steps in order.
    expect(stripSelectors).toContain("head")
    expect(stripSelectors).toContain("script")
  })

  it("strips the FreeFind chrome that actually binds, and nothing that does not", () => {
    const strip = my().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 46/46 pages: 61 chars on the .contentpadding pages, 817 on /a/prayers.html
    // where the html container also exposes the cookie bar and nav. The missing
    // leading "." is correct, not a typo.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA table and its cells remove 67-246 chars as a PAIR;
    // each alone measures 0 marginal because they cover the same text. Both are
    // listed so stripping cells cannot leave the table shell, or vice versa.
    // Unlike everystudent-sq, `.fctable` does bind on this host.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // Measured 0 instances on this host — omitted rather than carried as a
    // parity no-op that can never bind. Do not re-add it expecting it to work.
    expect(strip).not.toContain(".relatedbottom")
  })
})
