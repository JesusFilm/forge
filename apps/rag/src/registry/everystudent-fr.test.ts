/**
 * The `everystudent-fr` registry entry — EveryStudent's French domain
 * (questions2vie.com), slice #10. Split out of `registry.test.ts` (the §5.5
 * 300-line cap), following `everystudent.test.ts` / `everystudent-ar.test.ts`.
 *
 * Each guard below encodes a decision that cost real money or real corpus
 * quality to reach, so a future edit cannot quietly undo it:
 *   - the Firecrawl strategy (without it every page is a Cloudflare 403);
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - seed-only, because discovery was already paid for (#114);
 *   - no `/m/` menu indexes, no `plan.html`, and no `.php` extension twins;
 *   - the CTA/share chrome strip that keeps citations clean.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const fr = (): SourceEntry => getSource("everystudent-fr")!

describe("everystudent-fr registry entry", () => {
  it("resolves everystudent-fr as a WALLED, seed-only French source fetched through Firecrawl", () => {
    const entry = fr()
    expect(entry.domain).toBe("www.questions2vie.com")
    expect(entry.languages).toEqual(["fr"])
    // The load-bearing fact: probed 2026-07-27, the homepage, /a/102rien.html
    // and /sitemap.xml all 403 with the Cloudflare block-page signature.
    // Without this every page comes back as a 403.
    expect(resolveFetchStrategy(entry)).toBe("firecrawl")
    // Seed-only BY DESIGN — /v2/map already enumerated this domain (#114), and
    // /sitemap.xml is 403 to plain HTTP anyway. A `sitemaps` entry would re-pay
    // per scrape for URLs we already hold.
    expect(entry.crawl.sitemaps).toBeUndefined()
    expect(entry.crawl.seedPaths).toHaveLength(67)
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. questions2vie.com is its own domain, so the
    // French content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(fr().domain)
    expect(fr().key).toBe("everystudent-fr")
  })

  it("completes the three walled EveryStudent domains as three distinct keys", () => {
    const domains = ["everystudent", "everystudent-ar", "everystudent-fr"].map(
      (k) => getSource(k)!.domain,
    )
    expect(new Set(domains).size).toBe(3)
    // All three sit behind the same Cloudflare wall and share one fetch strategy.
    for (const k of ["everystudent", "everystudent-ar", "everystudent-fr"]) {
      expect(resolveFetchStrategy(getSource(k)!)).toBe("firecrawl")
    }
  })

  it("seeds exclude the /m/ menu indexes, the site-plan page, contact chrome and the homepage", () => {
    const paths = fr().crawl.seedPaths!
    // /m/* are the mobile/menu section indexes — navigation, not articles.
    // /m/intl.html is also the page linking out to the sibling language domains.
    expect(paths.filter((p) => p.startsWith("/m/"))).toEqual([])
    // The French twin of the /sitemap.html the English entry drops.
    expect(paths).not.toContain("/plan.html")
    expect(paths).not.toContain("/contact1.html")
    expect(paths).not.toContain("/")
  })

  it("drops the .php extension twins of pages already seeded as .html", () => {
    const paths = fr().crawl.seedPaths!
    // A legacy site serving one page at two extensions: the document-level
    // content hash cannot collapse duplicates sitting at different URLs, so
    // seeding both would pay a credit to add a near-duplicate document.
    expect(paths.filter((p) => p.endsWith(".php"))).toEqual([])
  })

  it("drops the email-signup landing pages measured at Stage 1", () => {
    const paths = fr().crawl.seedPaths!
    // Seeded provisionally, fetched, then dropped on evidence: /jean.html and
    // /jeanFR.html share 87.9% of their 12-word shingles (the same sign-up page
    // reordered), and all three end in an identical 850-char GDPR privacy
    // notice worth 35-44% of their bodies. They clear minContentLength easily —
    // length is not aboutness, so the floor could never have caught them.
    expect(paths).not.toContain("/jean.html")
    expect(paths).not.toContain("/jeanFR.html")
    expect(paths).not.toContain("/aventure.html")
  })

  it("is exactly the French article body — every seed is an /a/ page", () => {
    const paths = fr().crawl.seedPaths!
    // /a/* is the article corpus, and after the Stage-1 drops it is the WHOLE
    // seed set: this source ingests articles and nothing else.
    expect(paths.filter((p) => p.startsWith("/a/"))).toHaveLength(67)
    expect(paths).toHaveLength(67)
  })

  it("every seed is a distinct, root-relative path under the French domain", () => {
    const paths = fr().crawl.seedPaths!
    expect(new Set(paths).size).toBe(paths.length)
    for (const p of paths) expect(p.startsWith("/")).toBe(true)
    expect(fr().crawl.baseUrl).toBe("https://www.questions2vie.com")
  })

  it("strips the share/CTA chrome so citations stay clean", () => {
    const strip = fr().crawl.stripSelectors
    // Measured on the English sibling: together these removed ~275-360 chars of
    // pure chrome per page and left articles ending on their own last line.
    expect(strip).toContain("sitelevel_noindex")
    expect(strip).toContain(".fccell")
    expect(fr().crawl.contentSelectors).toContain(".content4")
  })
})
