/**
 * The `everystudent-hy` registry entry — EveryStudent's Armenian domain
 * (1patasxan.com). Each guard below encodes a decision that was MEASURED on
 * 2026-07-30 and would silently destroy or degrade the source if undone:
 *   - seed mode, because this host publishes no XML sitemap at all;
 *   - `["html"]` as the sole container, because `.content4` matches on every
 *     page and extracts 0 characters — listing it stages nothing, silently;
 *   - `head` in the strip list, which only matters because the container is
 *     `<html>`;
 *   - the two "fol" pages, which clear the 250-char floor and so can only be
 *     excluded by omission.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { everystudentHy } from "./everystudent-hy.js"
import { SOURCES } from "./index.js"

describe("everystudent-hy registry entry", () => {
  it("is its own source keyed to its own digit-initial domain (ADR-0006)", () => {
    expect(everystudentHy.key).toBe("everystudent-hy")
    expect(everystudentHy.key).toMatch(/^[a-z0-9-]+$/)
    // The host starts with a DIGIT — pinned to `www.` because the apex 301s to
    // it (measured on / and /robots.txt). Nothing here may assume a
    // letter-initial hostname.
    expect(everystudentHy.domain).toBe("www.1patasxan.com")
    expect(everystudentHy.crawl.baseUrl).toBe("https://www.1patasxan.com")
    // Never folded into the English banner as a language variant.
    const keys = SOURCES.map((s) => s.key)
    expect(keys).toContain("everystudent-hy")
    expect(keys).toContain("everystudent")
  })

  it("is SEED mode with no discovery — the host serves no XML sitemap", () => {
    // /sitemap.xml, /sitemap_index.xml, /sitemap.xml.gz, /wp-sitemap.xml and
    // /sitemap.txt all returned 404, and robots.txt is 404 too (so no
    // `Sitemap:` line). There is nothing to discover from: the seed list IS the
    // filter, which is why allow/block/articleHints are all absent.
    expect(everystudentHy.crawl.sitemaps).toBeUndefined()
    expect(everystudentHy.crawl.allow).toBeUndefined()
    expect(everystudentHy.crawl.articleHints).toBeUndefined()
    expect(everystudentHy.crawl.block).toBeUndefined()
    // 33, not 34: /a/whowas.html was removed 2026-08-06 under the estate-wide
    // scripture policy — 20,922 chars of Gospel-of-John excerpts that say so
    // themselves («Ոչ մի մեկնաբանություն ավելացված չէ» — no commentary added).
    // It was the one seed the entry's original "no Scripture pages" audit
    // missed, because that audit measured citation DENSITY and this page is
    // continuous narrative. Campaign #111 §0.13.
    expect(everystudentHy.crawl.seedPaths).toHaveLength(33)
    expect(everystudentHy.crawl.seedPaths).not.toContain("/a/whowas.html")
    // Bare Apache, no Cloudflare layer anywhere — plain HTTP, not Firecrawl.
    expect(everystudentHy.crawl.fetchStrategy).toBeUndefined()
    expect(everystudentHy.languages).toEqual(["hy"])
  })

  it("binds <html> alone — every FreeFind container matches at 0 chars here", () => {
    const selectors = everystudentHy.crawl.contentSelectors
    // Measured over all 35 /a/ pages: .content4 matches 35/35 and extracts 0
    // chars on the 34 seeded ones; .container2 matches 35/35 at 0 chars;
    // .contentpadding matches only on the excluded /a/fol.html; #content4 and
    // #contentpadding are 0 matches; <body> is absent from the parsed tree.
    // extractContent binds the FIRST selector that MATCHES AN ELEMENT, so any
    // of these listed ahead of "html" would win and yield "".
    expect(selectors[0]).toBe("html")
    expect(selectors).toEqual(["html"])
    for (const shadow of [
      ".content4",
      ".content4b",
      ".contentpadding",
      "#contentpadding",
      "#content4",
      ".container2",
      ".articletitle", // 12-58 chars: the <h1>, a plausible-looking non-answer
    ]) {
      expect(selectors).not.toContain(shadow)
    }
    // Coupled invariant: an <html> container duplicates the page <title> into
    // the body unless <head> is stripped. Safe only because extract.ts reads the
    // title from `root` BEFORE the strip loop.
    expect(everystudentHy.crawl.stripSelectors).toContain("head")
  })

  it("strips the chrome measured on THIS host and no dead config", () => {
    const strip = everystudentHy.crawl.stripSelectors
    // sitelevel_noindex is a custom ELEMENT tag (no leading dot): 2 instances on
    // 35/35 pages, removing exactly 1,819 chars every time — the single largest
    // contributor. .fccell is the CTA block (158 instances, 0-250 chars).
    expect(strip).toContain("sitelevel_noindex")
    expect(strip).toContain(".fccell")
    expect(strip).toContain(".likesharediv")
    // 0 instances measured here, so they could never bind: carrying them would
    // be dead config that misreports what this host actually needs.
    for (const dead of [".fctable", ".shareiconsmenupg", ".relatedbottom"]) {
      expect(strip).not.toContain(dead)
    }
  })

  it("omits the follow-up stubs, the homepage, the nav indexes and contact", () => {
    const seeds = everystudentHy.crawl.seedPaths ?? []
    // /a/fol.html is a 291-char post-decision referral stub and /a/fol copy.html
    // is a 2,636-char unlinked editor leftover found only via Apache autoindex.
    // Both clear minContentLength: 250, so omission is the ONLY filter.
    expect(seeds).not.toContain("/a/fol.html")
    expect(seeds).not.toContain("/a/fol copy.html")
    expect(seeds).not.toContain("/a/fol%20copy.html")
    // The homepage (1,384 ch), the 9 /m/ indexes (12-1,989 ch) and
    // /contact.html (319 ch) do NOT extract to 0 — `html` matches on them too.
    expect(seeds).not.toContain("/")
    expect(seeds).not.toContain("/contact.html")
    expect(seeds.filter((p) => p.startsWith("/m/"))).toEqual([])
    // What remains is exactly the article corpus, each a distinct /a/ page.
    expect(seeds.filter((p) => /^\/a\/[A-Za-z]+\.html$/.test(p))).toHaveLength(
      33,
    )
    expect(new Set(seeds).size).toBe(seeds.length)
  })
})
