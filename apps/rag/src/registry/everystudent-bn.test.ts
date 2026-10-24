/**
 * The `everystudent-bn` registry entry — EveryStudent's Bengali domain
 * (everybengalistudent.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-pl.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the sitemap is reachable and is
 *     a strict superset of the site's own HTML map;
 *   - `contentSelectors: [".contentpadding"]` alone — `.content4` MATCHES on
 *     55 of 57 pages and extracts 0 chars, so listing it would shadow the real
 *     container and ingest nothing;
 *   - `/a/whowas.html` blocked as the complete Gospel of John, carrying a
 *     third-party Tyndale/NLT licence;
 *   - `/a/` only — the `/m/` indexes, the site map, the contact form and the
 *     homepage all clear the 250-char floor, so `minContentLength` could never
 *     have excluded them.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const bn = (): SourceEntry => getSource("everystudent-bn")!
const HOST = "https://www.everybengalistudent.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = bn().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-bn registry entry", () => {
  it("resolves everystudent-bn as an UNWALLED Bengali source crawled over plain HTTP", () => {
    const entry = bn()
    expect(entry.domain).toBe("www.everybengalistudent.com")
    expect(entry.languages).toEqual(["bn"])
    // Verified 2026-07-29: /sitemap.xml and all 57 sitemap URLs returned HTTP/2
    // 200 to plain curl against bare Apache — no Cloudflare layer, no block
    // page. Declaring a strategy here would bill every page for a wall that
    // isn't there. (There is also no robots.txt at all: /robots.txt is a 404.)
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, not a hand-listed seed set", () => {
    const entry = bn()
    // /sitemap.xml answered 200 (9,373 bytes, 57 <loc>, all distinct). The
    // site's own HTML map (/sitemap.html) lists only 47 /a/ links, all already
    // in the XML, so the XML is the superset and nothing needs pinning.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    // ONE pinned seed (orchestrator, 2026-07-29): /a/followup.html is a genuine
    // 3,335-ch post-decision Q&A that BOTH sitemaps omit, so discovery cannot
    // reach it. Everything else on this host comes from the XML sitemap.
    expect(entry.crawl.seedPaths).toEqual(["/a/followup.html"])
    expect(seedUrls(entry)).toEqual([`${HOST}/a/followup.html`])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(57) // 57 sitemap URLs
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. everybengalistudent.com is its own domain, so the
    // Bengali content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(bn().domain)
    expect(bn().key).toBe("everystudent-bn")
    expect(bn().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("blocks the complete Gospel of John, which matches articleHints and clears the floor", () => {
    // /a/whowas.html ("যীশু কে ছিলেন?") extracts 22,236 chars of verbatim John —
    // its own standfirst says "direct quotations from the Gospel of John, no
    // commentary". Estate-wide scripture policy (2026-07-29). It is ALSO the one
    // page on the domain carrying a third-party licence, "New Living
    // Translation, © Tyndale House Foundation". It sits under /a/ and is 89×
    // the 250-char floor, so ONLY this URL block excludes it.
    expect(keeps(`${HOST}/a/whowas.html`)).toBe(false)
    // Its neighbours must survive — the block must not be broadened by accident.
    expect(keeps(`${HOST}/a/whodoyousay.html`)).toBe(true)
    expect(keeps(`${HOST}/a/why.html`)).toBe(true)
  })

  it("keeps /a/ articles and drops the indexes, site map, contact form and homepage", () => {
    expect(keeps(`${HOST}/a/isthere.html`)).toBe(true)
    expect(keeps(`${HOST}/a/gay-lesbian.html`)).toBe(true)
    // Slugs are lowercase ASCII today, but the hint uses [^/]+ so a future
    // mixed-case slug is not silently dropped the way -es and -pl nearly were.
    expect(keeps(`${HOST}/a/Isthere.html`)).toBe(true)
    // The 6 section indexes plus /m/intl.html (the "other languages" page) —
    // 17-1,635 chars of headline+teaser link list, so all but one CLEAR the 250
    // floor and the floor cannot catch them.
    expect(keeps(`${HOST}/m/knowing.html`)).toBe(false)
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false)
    // The HTML site map (1,649 ch of link list) and the question form (309 ch).
    expect(keeps(`${HOST}/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/contact.html`)).toBe(false)
    // The homepage has no .contentpadding, so the fallback returns 745 chars of
    // teaser list — NOT 0. Only a URL block excludes it.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(bn().crawl.minContentLength).toBe(250)
  })

  it("blocks the off-sitemap and dead /a/ paths that would otherwise match the hints", () => {
    // Live (200, 3,335 ch) but absent from BOTH sitemaps, and it has no
    // /a/followup.html is NOT blocked (orchestrator, 2026-07-29) — it is pinned
    // in seedPaths instead. Its original block cited a DOCTYPE-leaking root
    // extraction, but this entry keeps /a/jesusislam.html which has the identical
    // defect, so the two calls contradicted each other. The "html" fallback in
    // contentSelectors plus "head" in stripSelectors resolves both cleanly.
    expect(keeps(`${HOST}/a/followup.html`)).toBe(true)
    // HTTP 404 on 2026-07-29 — a dead link in the site's own navigation.
    expect(keeps(`${HOST}/a/connecting.html`)).toBe(false)
    // Both 404 today but still linked from every article's CTA: the estate's
    // "spiritual adventure" email series and a root-level signup twin. There is
    // no Gospel-of-John signup page on this host at all (/john.html is a 404).
    expect(keeps(`${HOST}/pack.html`)).toBe(false)
    expect(keeps(`${HOST}/personally.html`)).toBe(false)
    // …but the ARTICLE of the same slug under /a/ is real and must survive.
    expect(keeps(`${HOST}/a/personally.html`)).toBe(true)
  })

  it("scopes to .contentpadding and never lets the empty .content4 template shadow it", () => {
    const { contentSelectors } = bn().crawl
    // Measured 2026-07-29 with the repo's own extractContent over all 57 fetched
    // pages: `.contentpadding` matches 50/57 with 354-24,007 chars and NEVER
    // extracts 0; `.content4` matches 55/57 and extracts 0 chars on 50 of them.
    // Because extractContent scopes to the first selector that MATCHES AN
    // ELEMENT rather than the first that yields text, adding `.content4` would
    // win on every article and return "" — the whole corpus skipping `too-thin`
    // on an HTTP 200, invisible to these tests. That is the batch-1 failure.
    // The `"html"` fallback is a deliberate LAST entry (orchestrator, 2026-07-29):
    // it is only ever consulted when the primary misses, so it cannot shadow
    // anything, and it beats extract.ts's implicit `?? root` because <html> is a
    // real element and so carries no literal "<!DOCTYPE html>" text node. What
    // must never change is the FIRST entry, and the absence of `.content4`.
    expect(contentSelectors).toEqual([".contentpadding", "html"])
    expect(contentSelectors[0]).toBe(".contentpadding")
    expect(contentSelectors).not.toContain(".content4")
    expect(contentSelectors).not.toContain(".content4")
    expect(contentSelectors).not.toContain(".content4b")
  })

  it("strips the site chrome, including the custom sitelevel_noindex element", () => {
    const strip = bn().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 98 instances (2/page), removing 70-814 chars on 48/48 articles: the nav +
    // cookie bar, and the share + related-links block. The missing leading "."
    // is correct, not a typo. This is the only selector doing large work here.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA table and its cells — both listed so that
    // stripping only the cells cannot leave the table shell behind.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // Binds on exactly 1 of 48 articles (/a/jesusislam.html, whose collapsed
    // markup makes the container the document root) and removes that page's
    // duplicated <title>. Safe ONLY because extract.ts reads the title from
    // `root` before the strip loop runs — keep those two steps in that order.
    expect(strip).toContain("head")
  })
})
