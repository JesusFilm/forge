/**
 * The `everystudent-id` registry entry — EveryStudent's Indonesian domain
 * (mahasiswakeren.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-pl.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — Cloudflare fronts this host but passes traffic;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the XML sitemap is a strict
 *     superset of the site's own HTML map;
 *   - `contentSelectors: [".contentpadding"]` alone — `.content4` MATCHES on
 *     56/57 pages and extracts 0 chars, so listing it would shadow the real
 *     container and ingest nothing;
 *   - `[^/]+` in the article hint, because 8 slugs carry uppercase letters;
 *   - `/artikel/402mengenal.html` blocked — it matches the hint and only a URL
 *     block excludes it;
 *   - the `/isi/` indexes, contact page and homepage all clear the 250-char
 *     floor, so `minContentLength` could never have excluded them.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const id = (): SourceEntry => getSource("everystudent-id")!
const HOST = "https://www.mahasiswakeren.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = id().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-id registry entry", () => {
  it("resolves everystudent-id as an UNWALLED Indonesian discovery crawl over plain HTTP", () => {
    const entry = id()
    expect(entry.domain).toBe("www.mahasiswakeren.com")
    expect(entry.languages).toEqual(["id"])
    // Verified 2026-07-29: all 67 sitemap URLs returned HTTP/2 200 with real
    // HTML, and 0 of them carried a Cloudflare block-page signature — even
    // though `server: cloudflare` is on every response. The wall test is the
    // signature, not Cloudflare's presence (#114). Declaring firecrawl here
    // would bill every page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, not seeds: /sitemap.xml answered 200 (11,108 bytes, 67 <loc>,
    // all distinct) and is a strict SUPERSET of the site's own /isi/sitemap.html
    // (52 /artikel/ links, all already in the XML), so nothing needs pinning.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    expect(entry.crawl.maxPages).toBeGreaterThan(67) // 67 sitemap URLs
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. mahasiswakeren.com is its own domain, so the
    // Indonesian content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(id().domain)
    expect(id().key).toBe("everystudent-id")
    expect(id().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("keeps /artikel/ articles including the 11 mixed-case slugs", () => {
    expect(keeps(`${HOST}/artikel/101apakah.html`)).toBe(true)
    // ⚠️ 11 of the 57 slugs carry an uppercase letter. A lowercase-only
    // [a-z0-9-]+ hint would have silently dropped every one of them, including
    // the whole six-part Islam series — the exact failure this pins.
    expect(keeps(`${HOST}/artikel/109Tuhan.html`)).toBe(true)
    expect(keeps(`${HOST}/artikel/200Islam6.html`)).toBe(true)
    expect(keeps(`${HOST}/artikel/206Yesus.html`)).toBe(true)
    expect(keeps(`${HOST}/artikel/mengenal-Allah.html`)).toBe(true)
    expect(keeps(`${HOST}/artikel/pertolongan-Tuhan.html`)).toBe(true)
    // This banner localizes its paths: /artikel/ + /isi/, not the siblings'
    // /a/ + /m/. The sibling regexes must not be copied over unchanged.
    expect(keeps(`${HOST}/a/101apakah.html`)).toBe(false)
  })

  it("blocks the signup page that MATCHES the article hint, plus the indexes, contact page and homepage", () => {
    // The only non-redundant block: /artikel/402mengenal.html sits under
    // /artikel/ and matches articleHints, so `block` is the ONLY thing keeping
    // it out. 369 ch — "Memulai Bersama Allah", the post-decision referral to
    // MemulaiBersamaAllah.com, Indonesian twin of the French /aventure.html and
    // Arabic /pack.html. Absent from today's sitemap but linked from 5 articles.
    expect(keeps(`${HOST}/artikel/402mengenal.html`)).toBe(false)
    // ⚠️ Every page below CLEARS minContentLength: 250, so the floor could never
    // have excluded them — 5 of the 8 /isi/ indexes have no .contentpadding and
    // fall back to 674-1,071 ch of teaser links; /isi/sitemap.html is the site
    // plan at 2,254 ch; /hubungi.html is the contact page at 381 ch; and the
    // homepage extracts 803 ch, NOT 0.
    expect(keeps(`${HOST}/isi/keberadaan.html`)).toBe(false)
    expect(keeps(`${HOST}/isi/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/isi/intl.html`)).toBe(false)
    expect(keeps(`${HOST}/hubungi.html`)).toBe(false)
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(id().crawl.minContentLength).toBe(250)
  })

  it("scopes to .contentpadding alone and never lets the empty .content4 shadow it", () => {
    const { contentSelectors } = id().crawl
    // Measured 2026-07-29 with the repo's own extractContent over all 57
    // articles: `.contentpadding` matches 56/57 and extracts 1,545-30,713 chars
    // with 0 empty pages, while `.content4` matches 56/57 and extracts 0 chars
    // on EVERY one of them. Because extractContent scopes to the first selector
    // that MATCHES AN ELEMENT rather than the first that yields text, adding
    // `.content4` would win and return "" — all 56 articles skipping `too-thin`
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
    // `body` matches 0/57 pages here — the parse tree is flattened, so the
    // extractContent fallback is the document root (whole page, incl. a literal
    // "<!DOCTYPE html>"). That is why the pages above are blocked by URL.
    expect(contentSelectors).not.toContain("body")
  })

  it("strips the share/CTA chrome, and pins the two selectors whose roles are counter-intuitive", () => {
    const strip = id().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 2 instances on 56/56 pages: the "BAGIKAN DENGAN YANG LAIN" share row and
    // the "Pertanyaan? / ► Peta situs / ► Tentang situs ini" block. 100 chars
    // standalone. The missing leading "." is correct, not a typo.
    expect(strip).toContain("sitelevel_noindex")
    // Both the CTA table and its cells: whichever runs first does the work, but
    // one page has .fccell with no .fctable (marginal 107 ch there), and
    // stripping only the cells would leave the table shell. Neither is redundant.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // Load-bearing ONLY for /artikel/coronavirus.html, the one article where
    // .contentpadding is null and extraction falls back to `root`: it removes
    // the duplicated <title> (13,356 -> 13,301). 0 chars on the other 56. Safe
    // only because extract.ts reads the title from `root` BEFORE the strip loop.
    expect(strip).toContain("head")
  })
})
