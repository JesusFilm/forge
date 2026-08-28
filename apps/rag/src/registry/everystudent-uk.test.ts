/**
 * The `everystudent-uk` registry entry — EveryStudent's Ukrainian domain
 * (svitstudentiv.com). Split out per the §5.5 300-line cap, following
 * `everystudent-bg.test.ts` / `everystudent-fr.test.ts`.
 *
 * Each guard encodes a decision that cost real measurement to reach and would
 * be silent and expensive to undo:
 *   - SEED mode, because this host has no XML sitemap at all;
 *   - a SEPARATE key from `everystudent-ru`, proved on the alphabet, not assumed;
 *   - `html` as the sole container, because the shared `.content4` matches at
 *     0 chars on 47 of 48 pages and would shadow every selector after it;
 *   - the strip list that makes a whole-document container safe;
 *   - the exclusion of `/a/isus.html`, which is 15 chapters of the Gospel of
 *     John in a third-party translation.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { everystudentUk } from "./everystudent-uk.js"
import { getSource } from "./index.js"

const uk = everystudentUk

describe("everystudent-uk registry entry", () => {
  it("is Ukrainian and a SEPARATE source from the Russian sibling (ADR-0006)", () => {
    expect(uk.key).toBe("everystudent-uk")
    expect(uk.key).toMatch(/^[a-z0-9-]+$/)
    expect(uk.domain).toBe("www.svitstudentiv.com")
    expect(uk.languages).toEqual(["uk"])
    // Separated on evidence, not on the banner: 23,851 Ukrainian-only letters
    // (і ї є ґ) and ZERO Russian-only letters (ы э ъ) across 426,367 chars, and
    // 0.00-0.04% 12-word shingle overlap with mirstudentov.com's same-topic
    // articles. Folding these into `everystudent-ru` would mislabel them.
    const ru = getSource("everystudent-ru")
    expect(ru?.languages).toEqual(["ru"])
    expect(ru?.domain).not.toBe(uk.domain)
  })

  it("is SEED mode with no discovery — this host has NO XML sitemap", () => {
    // /sitemap.xml, /sitemap_index.xml, /sitemap.xml.gz, /wp-sitemap.xml and
    // /robots.txt all 404 (2026-07-30). There is nothing to discover from, so
    // the discovery filters must stay absent: they only filter DISCOVERED urls,
    // and the seed list itself is this source's filter.
    expect(uk.crawl.sitemaps).toBeUndefined()
    expect(uk.crawl.allow).toBeUndefined()
    expect(uk.crawl.block).toBeUndefined()
    expect(uk.crawl.articleHints).toBeUndefined()
    expect(uk.crawl.seedPaths).toHaveLength(47)
    // Apex 301s to www; pinning the wrong one would redirect every fetch.
    expect(uk.crawl.baseUrl).toBe("https://www.svitstudentiv.com")
    // Plain HTTP serves every page — no Cloudflare block page anywhere.
    expect(uk.crawl.fetchStrategy).toBeUndefined()
  })

  it("scopes to `html` alone and never to the selectors that extract nothing", () => {
    // Measured on all 48 articles: an interleaved </sitelevel_noindex> closes
    // inside .contentpadding, so the parser destroys #content4/.contentpadding
    // and even <body> is absent from the tree. `html` binds 48/48 at
    // 3,706-25,398 chars.
    expect(uk.crawl.contentSelectors).toEqual(["html"])
    // The shadow trap: .content4 matches 2 elements on every page and the FIRST
    // extracts 0 chars on 47 of 48. extract.ts binds the first selector that
    // matches an ELEMENT, so listing it would skip the whole corpus as
    // `too-thin` on a 200 status with no error anywhere.
    expect(uk.crawl.contentSelectors).not.toContain(".content4")
    expect(uk.crawl.contentSelectors).not.toContain("#content4")
    // .articletitle is the h1 — 4-64 chars, a plausible-looking non-zero that
    // would stage headline-only documents.
    expect(uk.crawl.contentSelectors).not.toContain(".articletitle")
  })

  it("strips the chrome that a whole-document container would otherwise swallow", () => {
    const strip = uk.crawl.stripSelectors
    // ~17.4 KB of inline CSS plus the duplicated <title>. Safe because
    // extract.ts reads the title from `root` before the strip loop.
    expect(strip).toContain("head")
    // Custom ELEMENT tag, not a class: cookie bar + nav + menu, and the footer.
    // 2 instances, 1,682-1,705 chars.
    expect(strip).toContain("sitelevel_noindex")
    // This host's share row. The siblings' .shareiconsmenupg has 0 instances
    // here, so inheriting their list would strip nothing and leave the widget.
    expect(strip).toContain(".likesharediv")
    expect(strip).not.toContain(".shareiconsmenupg")
    // The "FEATURE CLOSE" CTA cells, 4-6 instances, 72-193 chars.
    expect(strip).toContain(".fccell")
  })

  it("excludes /a/isus.html — 15 chapters of the Gospel of John, not ministry writing", () => {
    const paths = uk.crawl.seedPaths ?? []
    // Estate-wide scripture policy. The page states it carries the Gospel of
    // John "без додавання будь-яких коментарів" (without adding any commentary)
    // and credits the Ohiyenko translation — a third-party copyright our
    // `rights` line would misattribute. It is the only page on the host with
    // standalone chapter headings (15) and zero footnote citations; every other
    // article has the opposite profile and is kept. It is live (HTTP 200), so
    // only omission keeps it out.
    expect(paths).not.toContain("/a/isus.html")
    // Probed and confirmed 404 on this host — recorded so a later "add the
    // missing signup pages" edit does not invent them.
    expect(paths).not.toContain("/john.html")
    expect(paths).not.toContain("/pack.html")
  })

  it("seeds exactly the article corpus — no nav indexes, homepage or contact page", () => {
    const paths = uk.crawl.seedPaths ?? []
    expect(new Set(paths).size).toBe(paths.length)
    for (const p of paths) expect(p).toMatch(/^\/a\/[a-z0-9]+\.html$/)
    // The 9 /m/ indexes are headline-and-teaser link lists (13-1,594 chars);
    // /m/intl.html also links out to the sibling language domains.
    expect(paths.filter((p) => p.startsWith("/m/"))).toEqual([])
    // 285 chars of form copy — it clears the 250 floor by 35 characters, so
    // only omission catches it.
    expect(paths).not.toContain("/zvorotniy.html")
    expect(paths).not.toContain("/")
    // Absent from the site's own HTML map, found by href harvest, read and
    // confirmed as a real follow-up article rather than a referral stub.
    expect(paths).toContain("/a/osobysto2.html")
  })
})
