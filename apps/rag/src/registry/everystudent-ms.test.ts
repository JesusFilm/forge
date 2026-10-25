/**
 * The `everystudent-ms` registry entry — EveryStudent's Malay domain
 * (persoalanhidup.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following the sibling `everystudent-*.test.ts` files.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent` AND from the Indonesian banner,
 *     because one domain = one source (ADR-0006);
 *   - discovery off the live sitemap, plus the ONE seed both sitemaps miss;
 *   - `.contentpadding` alone, because the empty `.content4` spacer matches on
 *     all 52 articles and would shadow it into extracting 0 chars;
 *   - the scripture block, which `articleHints` cannot express;
 *   - an `articleHints` regex that survives the mixed-case slugs.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const ms = (): SourceEntry => getSource("everystudent-ms")!
const HOST = "https://www.persoalanhidup.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = ms().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-ms registry entry", () => {
  it("resolves everystudent-ms as an UNWALLED Malay source crawled over plain HTTP", () => {
    const entry = ms()
    expect(entry.domain).toBe("www.persoalanhidup.com")
    // ⚠️ The host declares <html lang="id"> on every page and that attribute is
    // WRONG. Counted over all 52 extracted bodies across 18 discriminating word
    // pairs: 1,319 Malay forms vs 163 Indonesian (8:1), Malay ahead on every
    // pair — bahawa 448/bahwa 57, kerana 284/karena 26, perkahwinan 75/
    // pernikahan 1, kanser 21/kanker 0. This is the Malay banner, and it is a
    // different domain from the Indonesian one.
    expect(entry.languages).toEqual(["ms"])
    // Probed 2026-07-29: all 61 sitemap URLs returned HTTP 200 with no redirect
    // from bare Apache, no Cloudflare block page anywhere. Declaring a strategy
    // would bill Firecrawl credits for a wall that does not exist.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl that also pins the one article BOTH sitemaps miss", () => {
    const entry = ms()
    // /sitemap.xml answered 200 (9,543 bytes, 61 <loc>, 61 distinct) and the
    // site's own /m/sitemap.html lists the SAME 52 /a/ URLs — zero delta.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(61) // 61 distinct sitemap URLs
    expect(entry.crawl.minContentLength).toBe(250)
    // But a 64-link href harvest found /a/fol.html — HTTP 200, a real 3,100-char
    // article ("Permulaan dengan Tuhan") linked from three others, yet absent
    // from the XML sitemap AND from /m/sitemap.html. Discovery cannot reach it;
    // acquire.ts unions seeds with discovered URLs, so it is pinned here.
    // Dropping this seed silently loses a genuine document.
    expect(seedUrls(entry)).toEqual([`${HOST}/a/fol.html`])
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. persoalanhidup.com is its own domain, so the
    // Malay content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(ms().domain)
    expect(ms().key).toBe("everystudent-ms")
    const keys = ["everystudent", "everystudent-pl", "everystudent-ms"]
    expect(new Set(keys.map((k) => getSource(k)!.domain)).size).toBe(3)
  })

  it("keeps every /a/ article INCLUDING the mixed-case slugs a lowercase-only hint would drop", () => {
    // Five of the 52 slugs carry an uppercase letter. A `[a-z0-9-]+` hint would
    // silently lose all five; `[^/]+` keeps them.
    expect(keeps(`${HOST}/a/109Tuhan.html`)).toBe(true)
    expect(keeps(`${HOST}/a/202Yesus.html`)).toBe(true)
    expect(keeps(`${HOST}/a/708RohKudus.html`)).toBe(true)
    expect(keeps(`${HOST}/a/mengenali-Tuhan.html`)).toBe(true)
    expect(keeps(`${HOST}/a/502perkahwinan.html`)).toBe(true)
  })

  it("blocks the full-Scripture article that articleHints alone would admit", () => {
    // /a/300siapakah.html sits under /a/ and MATCHES articleHints, so `block` is
    // the only thing keeping it out — deleting this line silently readmits it.
    // "Siapakah Yesus?", 28,213 chars, and by its own standfirst "kutipan
    // langsung dari Injil Yohanes … Tanpa tambahan ulasan": 16 chapters of the
    // Gospel of John verbatim, no commentary. Estate-wide scripture policy
    // (2026-07-29) — public-domain Scripture rather than ministry writing.
    // At 113× the 250-char floor, minContentLength could never catch it.
    expect(keeps(`${HOST}/a/300siapakah.html`)).toBe(false)
    // It is the ONLY such page: a chapter-heading sweep of the other 51
    // articles returned 0 on every one, so nothing else needs blocking.
    expect(keeps(`${HOST}/a/215alkitab.html`)).toBe(true) // about the Bible, not Scripture
  })

  it("blocks the nav pages, contact form and homepage that minContentLength cannot catch", () => {
    // Measured post-strip 2026-07-29 — every one of these CLEARS the 250-char
    // floor, so only a URL block excludes them. The homepage and five of the
    // seven /m/ indexes have no .contentpadding at all, which means
    // extractContent falls through <body> (ABSENT on this host) to `root` and
    // returns the WHOLE DOCUMENT, not nothing.
    expect(keeps(`${HOST}/`)).toBe(false) // 720 ch of teaser list
    expect(keeps(`${HOST}/m/sitemap.html`)).toBe(false) // 2,022 ch site plan
    expect(keeps(`${HOST}/m/tentang.html`)).toBe(false) // 996 ch about + privacy
    expect(keeps(`${HOST}/m/kewujudan.html`)).toBe(false) // 1,205 ch section index
    expect(keeps(`${HOST}/hubungi.html`)).toBe(false) // 418 ch contact form
  })

  it("scopes to .contentpadding alone and never lets the empty .content4 spacer shadow it", () => {
    const { contentSelectors, stripSelectors } = ms().crawl
    // Measured 2026-07-29 with the repo's own extractContent over all 52
    // articles: .contentpadding is the only element that extracts the article
    // (2,472-28,368 ch raw; 2,317-28,213 ch stripped, median 9,915, none below
    // the floor). .content4 MATCHES on 52/52 and extracts 0 chars on every one,
    // and extractContent binds the first selector that MATCHES rather than the
    // first that yields text — so listing it would skip every article as
    // `too-thin` on an HTTP 200 (#128). Not a fallback chain: exactly one.
    expect(contentSelectors).toEqual([".contentpadding"])
    expect(contentSelectors).not.toContain(".content4")
    // A custom ELEMENT tag, not a class — the missing "." is correct.
    // 104 instances (2/page) on 52/52, removing exactly 77 ch every page.
    expect(stripSelectors).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA: the cells (78-232 ch/page, the biggest
    // contributor) and the table shell, or the emptied shell survives.
    expect(stripSelectors).toContain(".fccell")
    expect(stripSelectors).toContain(".fctable")
    // A 0-char no-op on THIS host — it nests inside the well-formed
    // sitelevel_noindex above. Kept as a guard against that markup drifting.
    expect(stripSelectors).toContain(".shareiconsmenupg")
  })
})
