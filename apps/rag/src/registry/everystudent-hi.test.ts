/**
 * The `everystudent-hi` registry entry — EveryStudent's Hindi domain
 * (everystudent.in). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following the sibling `everystudent-*.test.ts` files.
 *
 * Each guard below pins a decision that took live measurement on 2026-07-30 to
 * reach, so a future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is Cloudflare-fronted but serves
 *     no block page, and declaring a strategy would bill a wall that isn't there;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery PLUS four pinned seeds, because the XML sitemap omits four
 *     articles the site's own /m/map.html lists;
 *   - `.contentpadding` FIRST and `.content4` nowhere, because the empty
 *     `.content4` wrapper matches on all 34 articles at 0 chars and would
 *     shadow every selector after it;
 *   - `/bible.html` blocked as Scripture while `/a/bible.html` is kept as an
 *     essay about the Bible — an anchoring decision one loosened regex undoes.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const hi = (): SourceEntry => getSource("everystudent-hi")!
const HOST = "https://www.everystudent.in"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = hi().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-hi registry entry", () => {
  it("resolves everystudent-hi as an UNWALLED Hindi source crawled over plain HTTP", () => {
    const entry = hi()
    expect(entry.domain).toBe("www.everystudent.in")
    expect(entry.languages).toEqual(["hi"])
    // The load-bearing fact: ~100 plain-HTTP GETs on 2026-07-30 (the sitemap,
    // all 40 sitemap URLs, 7 link-harvested URLs) all returned 200 with real
    // HTML, and none of the 47 documents carried a Cloudflare block-page
    // signature. Every response DOES carry `server: cloudflare` — the CDN is
    // not the wall, so the classification is made on the body, not the header.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Both the apex and the www host 301 to https://www.everystudent.in/, and
    // all 40 sitemap <loc> values use that origin. A bare-apex baseUrl would
    // make every regex below miss.
    expect(entry.crawl.baseUrl).toBe(HOST)
  })

  it("is a DISCOVERY crawl that ALSO pins the four articles the XML sitemap omits", () => {
    const entry = hi()
    // /sitemap.xml answered 200 (3,169 bytes, Last-Modified 2025-12-22, 40
    // <loc>, 40 distinct) and /sitemap_index.xml is 404, so there is no larger
    // index hiding behind it. But the site's own /m/map.html lists 34 /a/ URLs
    // against the XML's 30 — these four are the delta, all fetched and
    // confirmed genuine articles (1,732-21,431 chars). Dropping them loses four
    // documents silently, because discovery cannot reach them.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toEqual([
      "/a/nickv.html",
      "/a/plates.html",
      "/a/sawyer.html",
      "/a/source.html",
    ])
    expect(seedUrls(entry)).toEqual([
      `${HOST}/a/nickv.html`,
      `${HOST}/a/plates.html`,
      `${HOST}/a/sawyer.html`,
      `${HOST}/a/source.html`,
    ])
    // The cap has to clear the 40 discovered + 4 pinned, or work is dropped.
    expect(entry.crawl.maxPages).toBeGreaterThan(44)
    expect(entry.crawl.minContentLength).toBe(250)
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. everystudent.in is its own domain, so the Hindi
    // content must not be folded into `everystudent` as a second language — the
    // same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(hi().domain)
    expect(hi().key).toBe("everystudent-hi")
    const keys = ["everystudent", "everystudent-pl", "everystudent-hi"]
    expect(new Set(keys.map((k) => getSource(k)!.domain)).size).toBe(3)
  })

  it("keeps every /a/ article, including the uppercase slug a lowercase-only hint would drop", () => {
    // Slugs on this host are pure ASCII English even though the bodies are
    // Devanagari (verified: 0 non-ASCII bytes and 0 %XX escapes across all 40
    // <loc> values), but /a/Godreal.html carries an uppercase G — `[a-z0-9-]+`
    // would silently lose it.
    expect(keeps(`${HOST}/a/Godreal.html`)).toBe(true)
    expect(keeps(`${HOST}/a/isthere.html`)).toBe(true)
    expect(keeps(`${HOST}/a/gods-help-video.html`)).toBe(true)
    // All 40 sitemap locs are https://, and discover.ts filters the RAW loc
    // string without normalising — so the scheme pin must match what is served.
    expect(keeps("http://www.everystudent.in/a/isthere.html")).toBe(false)
  })

  it("blocks /bible.html as Scripture WITHOUT taking /a/bible.html, the essay about it, with it", () => {
    // "परमेश्वर के वचन को स्वयं पढ़ें" ("Read God's Word yourself") is the
    // Bible-reading page linked from every article header — public-domain
    // Scripture rather than ministry writing, blocked under the estate-wide
    // policy of 2026-07-29.
    expect(keeps(`${HOST}/bible.html`)).toBe(false)
    // /a/bible.html is a 24,712-char apologetics ESSAY ("History of the Bible –
    // who wrote it – why is it reliable?") closing on a bibliography of
    // secondary sources, with no chapter-and-verse run. Loosening the block
    // above to a bare `bible\.html` would delete this article too.
    expect(keeps(`${HOST}/a/bible.html`)).toBe(true)
    // NOT redundant with articleHints: /a/fol.html sits under /a/ and matches
    // the hint, so `block` is the only thing excluding it. 612 chars of
    // referral copy pointing at EkNayaJeevan.com's "spiritual starter kit" —
    // the Hindi twin of the Polish /a/nowezycie.html, and well clear of the
    // 250-char floor.
    expect(keeps(`${HOST}/a/fol.html`)).toBe(false)
  })

  it("blocks the nav and signup pages minContentLength cannot catch", () => {
    // Measured post-strip 2026-07-30 — every one CLEARS the 250-char floor, so
    // only a URL block excludes them. The homepage and the four section indexes
    // have no .contentpadding at all, so the "html" fallback binds and returns
    // the whole teaser page (961 ch / 386-1,226 ch), not nothing.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(keeps(`${HOST}/m/knowing.html`)).toBe(false)
    expect(keeps(`${HOST}/m/map.html`)).toBe(false) // 1,422 ch site plan
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false) // other-languages index
    expect(keeps(`${HOST}/contact.html`)).toBe(false) // 338 ch contact form
    // The Gospel-of-John email study (1,807 ch) and its thank-you page (315 ch).
    expect(keeps(`${HOST}/john.html`)).toBe(false)
    expect(keeps(`${HOST}/john_thanks.html`)).toBe(false)
  })

  it("scopes to .contentpadding FIRST and never lets the empty .content4 wrapper shadow it", () => {
    const { contentSelectors, stripSelectors } = hi().crawl
    // Measured 2026-07-30 with the repo's own extractContent: .contentpadding
    // matches on 34/34 kept articles and is NEVER matched-but-empty
    // (1,732-25,039 ch post-strip). .content4 also matches on 34/34 and
    // extracts 0 chars every time; extractContent binds the first selector that
    // MATCHES rather than the first that yields text, so listing it anywhere
    // ahead of .contentpadding would skip every article as `too-thin` on an
    // HTTP 200 (#128). "html" is safe only in LAST position.
    expect(contentSelectors).toEqual([".contentpadding", "html"])
    expect(contentSelectors).not.toContain(".content4")
    // A custom ELEMENT tag, not a class — the missing "." is correct. 2
    // instances / exactly 170 chars on all 34 articles: the "read God's Word /
    // share with others" header row and the site-map footer block.
    expect(stripSelectors).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA: the table shell as well as its cells (71-388
    // chars), or the emptied shell survives.
    expect(stripSelectors).toContain(".fctable")
    expect(stripSelectors).toContain(".fccell")
    // Required by the "html" fallback: it drops the duplicated <title>. Safe
    // because extract.ts reads the title from `root` BEFORE the strip loop.
    expect(stripSelectors).toContain("head")
  })
})
