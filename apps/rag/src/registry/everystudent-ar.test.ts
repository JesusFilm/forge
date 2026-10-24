/**
 * The `everystudent-ar` registry entry — EveryStudent's Arabic domain
 * (everyarabstudent.com), slice #9. Split out of `registry.test.ts` (the §5.5
 * 300-line cap), following `everystudent.test.ts`.
 *
 * Each guard below encodes a decision that cost real money or real corpus
 * quality to reach, so a future edit cannot quietly undo it:
 *   - the Firecrawl strategy (without it every page is a Cloudflare 403);
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - seed-only, because discovery was already paid for (#114);
 *   - no `/m/` menu indexes and no `/bible/**.pdf`;
 *   - the CTA/share chrome strip that keeps citations clean.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const ar = (): SourceEntry => getSource("everystudent-ar")!

describe("everystudent-ar registry entry", () => {
  it("resolves everystudent-ar as a WALLED, seed-only Arabic source fetched through Firecrawl", () => {
    const entry = ar()
    expect(entry.domain).toBe("www.everyarabstudent.com")
    expect(entry.languages).toEqual(["ar"])
    // The load-bearing fact: re-probed 2026-07-25, the homepage and
    // /sitemap.xml both 403 with the Cloudflare block-page signature. Without
    // this every page comes back as a 403.
    expect(resolveFetchStrategy(entry)).toBe("firecrawl")
    // Seed-only BY DESIGN — /v2/map already enumerated this domain (#114), and
    // /sitemap.xml is 403 to plain HTTP anyway. A `sitemaps` entry would re-pay
    // per scrape for URLs we already hold.
    expect(entry.crawl.sitemaps).toBeUndefined()
    // 67, not 68: /a/whowas.html was removed 2026-08-06 under the same
    // scripture policy this entry already applies to its own /bible/**.pdf —
    // 23,624 chars of Gospel-of-John excerpts "دون إضافة لأي تعليق" (without
    // adding any commentary). Campaign #111 §0.13.
    expect(entry.crawl.seedPaths).toHaveLength(67)
    expect(entry.crawl.seedPaths).not.toContain("/a/whowas.html")
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. everyarabstudent.com is its own domain, so the
    // Arabic content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(ar().domain)
    expect(ar().key).toBe("everystudent-ar")
  })

  it("seeds exclude the /m/ menu indexes, the Bible PDFs and the homepage", () => {
    const paths = ar().crawl.seedPaths!
    // /m/* are the mobile/menu section indexes (about, contact, sitemap, intl,
    // forum + six topic hubs) — navigation, not articles.
    expect(paths.filter((p) => p.startsWith("/m/"))).toEqual([])
    // ingestionMode is html-scrape: a PDF cannot be extracted, and these are
    // public-domain Scripture rather than ministry writing.
    expect(paths.filter((p) => p.endsWith(".pdf"))).toEqual([])
    expect(paths).not.toContain("/")
  })

  it("keeps the Arabic article body and the video testimonies", () => {
    const paths = ar().crawl.seedPaths!
    // /a/* is the article corpus — the substance of this source. 60, not 61:
    // /a/whowas.html left under the scripture policy (2026-08-06).
    expect(paths.filter((p) => p.startsWith("/a/"))).toHaveLength(60)
    // /v/* are testimony transcripts; the English sibling's /videos/ pages were
    // probed and found to be genuine unique prose, not media stubs.
    expect(paths.filter((p) => p.startsWith("/v/"))).toHaveLength(5)
    // Provisional root-level pages — minContentLength drops them at Stage 1 if
    // they turn out to be link-only chrome.
    expect(paths).toContain("/john.html")
    expect(paths).toContain("/pack.html")
  })

  it("every seed is a distinct, root-relative path under the Arabic domain", () => {
    const paths = ar().crawl.seedPaths!
    expect(new Set(paths).size).toBe(paths.length)
    for (const p of paths) expect(p.startsWith("/")).toBe(true)
    expect(ar().crawl.baseUrl).toBe("https://www.everyarabstudent.com")
  })

  it("strips the share/CTA chrome so citations stay clean", () => {
    const strip = ar().crawl.stripSelectors
    // Measured on the English sibling: together these removed ~275-360 chars of
    // pure chrome per page and left articles ending on their own last line.
    expect(strip).toContain("sitelevel_noindex")
    expect(strip).toContain(".fccell")
    expect(ar().crawl.contentSelectors).toContain(".content4")
  })
})
