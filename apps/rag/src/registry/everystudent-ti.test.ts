/**
 * The `everystudent-ti` registry entry — EveryStudent's Tigrinya domain
 * (everytemhari.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-bg.test.ts` / `everystudent-am.test.ts`.
 *
 * Each guard below encodes a decision that cost real recon to reach, so a future
 * edit cannot quietly undo it:
 *   - SEED mode, because this host has NO XML sitemap at all;
 *   - `.contentpadding` binding FIRST, because `.content4` matches at 0 chars
 *     here and would silently skip all 14 articles;
 *   - the two `/a/` files that exist on disk and are deliberately NOT seeded;
 *   - the case-sensitive `isGodgood` slug;
 *   - a SEPARATE key from `everystudent-am`, its Ge'ez-script sibling.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { everystudentTi } from "./everystudent-ti.js"
import { resolveFetchStrategy, SOURCES, seedUrls } from "./index.js"

describe("everystudent-ti registry entry", () => {
  it("is its own source keyed to its own domain, distinct from the Amharic sibling (ADR-0006)", () => {
    expect(everystudentTi.key).toBe("everystudent-ti")
    expect(everystudentTi.key).toMatch(/^[a-z0-9-]+$/)
    expect(everystudentTi.domain).toBe("www.everytemhari.com")
    expect(everystudentTi.languages).toEqual(["ti"])
    // habeshastudent.com and everytemhari.com are BOTH Ge'ez-script Cru hosts
    // with identical /a/ slugs. Measured 2026-07-30: 0.0% 12-word shingle
    // overlap on 5 same-slug articles, so they are independent translations and
    // must stay two keys, never one source with two languages.
    const am = SOURCES.find((s) => s.key === "everystudent-am")
    expect(am?.domain).not.toBe(everystudentTi.domain)
    expect(am?.languages).toEqual(["am"])
    expect(SOURCES.map((s) => s.key)).toContain("everystudent-ti")
  })

  it("is SEED mode with NO discovery — this host has no XML sitemap", () => {
    // Verified 2026-07-30: /sitemap.xml, /sitemap_index.xml, /sitemap.xml.gz,
    // /wp-sitemap.xml and 8 further variants all 404, and robots.txt (200, 22
    // bytes, "User-agent: * Allow: /") carries no `Sitemap:` line. Adding a
    // `sitemaps` entry would make discovery fetch a 404 and yield nothing.
    expect(everystudentTi.crawl.sitemaps).toBeUndefined()
    // With no discovery there is nothing to filter: the seed list IS the filter
    // (the everystudent-ar / everystudent-bg precedent).
    expect(everystudentTi.crawl.allow).toBeUndefined()
    expect(everystudentTi.crawl.block).toBeUndefined()
    expect(everystudentTi.crawl.articleHints).toBeUndefined()
    // 14 is the COMPLETE corpus, not a sample: confirmed by /sitemap.html, the
    // site's own search index, and the open Apache directory index at /a/.
    expect(everystudentTi.crawl.seedPaths).toHaveLength(14)
    expect(resolveFetchStrategy(everystudentTi)).toBe("plain-http")
  })

  it("binds .contentpadding FIRST and never the zero-char or headline selectors", () => {
    const sel = everystudentTi.crawl.contentSelectors
    // Measured 2026-07-30 with node-html-parser as extract.ts uses it:
    // .contentpadding binds 14/14 at 1,063-13,457 chars post-strip, 0 empties.
    expect(sel[0]).toBe(".contentpadding")
    // ⚠️ .content4 MATCHES all 14 articles and extracts 0 chars on every one.
    // extract.ts binds the first selector matching an ELEMENT and stops, so
    // listing it anywhere would skip the entire corpus as `too-thin` on a 200.
    expect(sel).not.toContain(".content4")
    // .articletitle binds 14/14 at 12-59 chars — the <h1>, not the body.
    expect(sel).not.toContain(".articletitle")
    // `html` is safe ONLY as the last entry: it cannot shadow anything, and it
    // is paired with "head" so the fallback path drops the duplicated <title>.
    expect(sel[sel.length - 1]).toBe("html")
    expect(everystudentTi.crawl.stripSelectors).toContain("head")
  })

  it("strips the chrome that measured non-zero and omits what can never bind", () => {
    const strip = everystudentTi.crawl.stripSelectors
    // The only site-specific selector doing irreplaceable work: 2 instances on
    // 14/14, 26 chars marginal. Custom ELEMENT tag, hence no leading dot.
    expect(strip).toContain("sitelevel_noindex")
    // Both are required: on /a/personally.html there are 0 .fctable instances,
    // so .fccell alone removes its 123-char CTA block.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // 0 instances across all 24 pages measured — they could never bind here, so
    // carrying them for sibling parity would be dead config.
    expect(strip).not.toContain(".relatedbottom")
    expect(strip).not.toContain(".likesharediv")
  })

  it("excludes the two /a/ files that exist on disk but must not be ingested", () => {
    const seeds = everystudentTi.crawl.seedPaths ?? []
    // The open Apache index at /a/ lists 16 .html files. Both of these return
    // HTTP 200, so nothing but omission keeps them out.
    //
    // A stray editor duplicate: 96.0% 12-word shingle overlap with
    // /a/peace.html. The document-level content hash cannot collapse two
    // near-duplicates sitting at different URLs.
    expect(seeds).not.toContain("/a/peace%20copy.html")
    expect(seeds).not.toContain("/a/peace copy.html")
    // The post-decision follow-up page — the ONLY page on the whole host with
    // <meta name="robots" content="noindex">, and the one page where
    // .contentpadding is absent (it would arrive via the html fallback).
    expect(seeds).not.toContain("/a/fol.html")
    // The homepage and nav pages all extract ABOVE the 250 floor, so the length
    // floor could never have caught them either.
    expect(seeds).not.toContain("/")
    expect(seeds).not.toContain("/sitemap.html")
    expect(seeds.filter((p) => p.startsWith("/m/"))).toEqual([])
    // After those drops the seed set is exactly the article namespace.
    expect(seeds.filter((p) => /^\/a\/[^/]+\.html$/.test(p))).toHaveLength(14)
  })

  it("preserves the case-sensitive isGodgood slug and resolves every seed under the www host", () => {
    const seeds = everystudentTi.crawl.seedPaths ?? []
    // ⚠️ The server is case-sensitive and this slug carries a capital G;
    // lowercasing it 404s. seedUrls passes the path through verbatim.
    expect(seeds).toContain("/a/isGodgood.html")
    expect(new Set(seeds).size).toBe(seeds.length)
    // The bare apex 301s to www on both http and https (checked both ways —
    // everystudent.sk runs the redirect the other direction).
    expect(everystudentTi.crawl.baseUrl).toBe("https://www.everytemhari.com")
    const urls = seedUrls(everystudentTi)
    expect(urls).toHaveLength(14)
    expect(urls).toContain("https://www.everytemhari.com/a/isGodgood.html")
    for (const u of urls) {
      expect(u.startsWith("https://www.everytemhari.com/a/")).toBe(true)
    }
  })
})
