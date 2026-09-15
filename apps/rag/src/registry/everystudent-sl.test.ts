/**
 * The `everystudent-sl` registry entry — EveryStudent's Slovenian domain
 * (vsakstudent.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-sq.test.ts` / `everystudent-pl.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - `#contentpadding` is an **ID** on this host, not the estate's
 *     `.contentpadding` class — and none of the ten known generators match at
 *     all, so an inherited selector list would ingest nothing;
 *   - `/a/spoznatiboga2.html` is seeded because it is in NEITHER the XML
 *     sitemap nor the site's own HTML map, and only href-harvesting found it;
 *   - `/janez.html` is the verbatim Gospel of John under a Slovenian Bible
 *     Society copyright — scripture policy plus a rights-misattribution risk;
 *   - `.hidden` is CONTENT here (7,328 chars of evidence tables), not chrome;
 *   - a SEPARATE key from `everystudent`, because one domain = one source.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const sl = (): SourceEntry => getSource("everystudent-sl")!
const HOST = "https://www.vsakstudent.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = sl().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-sl registry entry", () => {
  it("is an UNWALLED, https-pinned DISCOVERY crawl on the www host", () => {
    const entry = sl()
    // The apex 301s to www (the COMMON direction, not the everystudent.sk
    // reverse), so every regex must carry `www.` or all of them miss.
    expect(entry.domain).toBe("www.vsakstudent.com")
    expect(entry.crawl.baseUrl).toBe(HOST)
    expect(entry.languages).toEqual(["sl"])
    // Bare Apache, no Cloudflare layer and no block page on any of 45 probes.
    // Declaring a strategy would bill every page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, not a hand-listed set: /sitemap.xml answers 200 with 30 <loc>.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    // The <loc> values are https, and discover.ts filters the RAW string without
    // normalising — an http URL would be dropped, and vice versa.
    for (const p of [...entry.crawl.allow!, ...entry.crawl.articleHints!]) {
      expect(p).toContain("^https://www\\.vsakstudent\\.com")
    }
  })

  it("binds the measured #contentpadding ID FIRST and lists no 0-char shadow selector", () => {
    const sels = sl().crawl.contentSelectors
    // The load-bearing fact. extractContent scopes to the FIRST selector that
    // MATCHES AN ELEMENT, not the first that yields text, so anything matching
    // at 0 chars ahead of this would skip all 23 articles as `too-thin` on an
    // HTTP 200 — silent, and the failure mode that broke 5 of the 8 pilots.
    // Measured 2026-07-30 over 22 articles: #contentpadding matches 22/22 at
    // 4,023-30,414 chars with ZERO matched-but-empty pages.
    expect(sels[0]).toBe("#contentpadding")
    // This host was redesigned onto its own template and emits NONE of the
    // FreeFind markup: each of these was measured at 0 matches here, and the
    // class-form `.contentpadding` in particular is NOT the ID we bind.
    for (const dead of [
      ".contentpadding",
      ".content4",
      "#content4",
      ".content4b",
      ".entry-content",
      ".post-content",
      ".cb-entry-content",
      ".contentleftpadding",
      ".article-content",
      ".content",
      ".articletitle",
    ]) {
      expect(sels).not.toContain(dead)
    }
    // "html" is safe ONLY as the last entry — it shadows everything after it.
    expect(sels[sels.length - 1]).toBe("html")
    expect(sels.indexOf("html")).toBe(sels.length - 1)
    // Pairing "html" with "head" is what keeps the fallback path from emitting a
    // duplicated <title> (1,484-1,607 chars/page measured there, 0 in scope).
    expect(sl().crawl.stripSelectors).toContain("head")
  })

  it("strips the chrome measured on THIS host and never strips .hidden, which is content", () => {
    const strip = sl().crawl.stripSelectors
    // `script` is the largest real contributor: 44 instances, 652 chars on every
    // page of inline document.write FB-iframe source. The navtree pair is the
    // breadcrumb label printed twice (425 + 449 chars across 22 pages).
    for (const s of ["script", ".navtree", ".navtree1"]) {
      expect(strip).toContain(s)
    }
    // ⚠️ `.hidden` reads like chrome and is NOT. On /a/zakajlahkozaupamo.html it
    // holds 7,328 chars across #question1-3 — the archaeology and manuscript
    // evidence tables, 25% of the site's longest article. Stripping it would
    // trade 140 chars of collapsed menu for that.
    expect(strip).not.toContain(".hidden")
    // The FreeFind chrome is OMITTED because it is 0 INSTANCES here — it cannot
    // bind. Carrying it would be noise that implies a measurement never taken.
    for (const absent of [
      "sitelevel_noindex",
      ".fccell",
      ".fctable",
      ".hr2",
      ".relatedbottom",
      ".shareiconsmenupg",
    ]) {
      expect(strip).not.toContain(absent)
    }
  })

  it("seeds the one article that is in NEITHER the XML sitemap nor the HTML map", () => {
    const entry = sl()
    // /a/spoznatiboga2.html is linked from 11 of the 22 articles, returns 200,
    // and extracts 2,907 chars of genuine post-decision Q&A prose. Discovery
    // cannot reach it — the XML sitemap and /m/zemljevid.html both omit it, and
    // only harvesting hrefs across every fetched page surfaced it.
    expect(entry.crawl.seedPaths).toEqual(["/a/spoznatiboga2.html"])
    expect(seedUrls(entry)).toContain(`${HOST}/a/spoznatiboga2.html`)
    // It shares only 1.4% of its 12-word shingles with the same-titled
    // /a/spoznatiboga.html, so it is a second article, not a duplicate URL.
    expect(keeps(`${HOST}/a/spoznatiboga.html`)).toBe(true)
    // 30 sitemap URLs + 1 seed must fit under the cap with headroom.
    expect(entry.crawl.maxPages).toBeGreaterThan(31)
  })

  it("blocks the Gospel-of-John scripture page but keeps the essay ABOUT the Bible", () => {
    // /janez.html is the verbatim Slovenian text of John with numbered verses
    // and a 21-chapter index (4,951 chars — well over the floor, so only a URL
    // block catches it). It closes "© 1996, 2003 Društvo Svetopisemska družba
    // Slovenije", a third-party copyright this entry's `rights` line would
    // misattribute to Cru. Estate-wide scripture policy, 2026-07-29.
    expect(keeps(`${HOST}/janez.html`)).toBe(false)
    // ⚠️ The distinction is voice + verse numbering + copyright, NOT length:
    // /a/zakajlahkozaupamo.html ("Why we can trust the Bible") is the LONGEST
    // page on the site at 29,741 chars and is apologetics prose. It stays.
    expect(keeps(`${HOST}/a/zakajlahkozaupamo.html`)).toBe(true)
  })

  it("blocks the nav/chrome pages that all clear the 250-char floor", () => {
    // "minContentLength will drop it" is never the argument: when no selector
    // matches, extractContent falls back to <body> ?? root — the whole document.
    // Each of these was fetched and measured above the floor.
    expect(keeps(`${HOST}/`)).toBe(false) // homepage, 569 ch of teasers
    expect(keeps(`${HOST}/pisite.html`)).toBe(false) // contact form, 380 ch
    expect(keeps(`${HOST}/m/zemljevid.html`)).toBe(false) // site plan, 755 ch
    expect(keeps(`${HOST}/m/ostrani.html`)).toBe(false) // about+privacy, 2,696 ch
    // Slugs are lowercase ASCII today, but the hint uses [^/]+ so a future
    // mixed-case slug cannot silently vanish the way [a-z0-9-]+ would drop it.
    expect(keeps(`${HOST}/a/Spoznati-Boga.html`)).toBe(true)
  })

  it("is a SEPARATE source key from everystudent and its South Slavic siblings (ADR-0006)", () => {
    // One domain = one source. vsakstudent.com is its own domain, so Slovenian
    // must not be folded into `everystudent` as a second language — the rule
    // that keeps thelife-fr / thelife-zh separate. And Slovenian is genuinely
    // distinct from its Croatian neighbour, confirmed on word-boundary counts:
    // the dual copula je/sta/so is complete (1,692/44/304) while every Croatian
    // marker scores 0 (što, vrlo, pitanje, tko, gdje, svijet, vrijeme).
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(sl().domain)
    expect(sl().key).toBe("everystudent-sl")
    expect(sl().key).toMatch(/^[a-z0-9-]+$/)
    const hr = getSource("everystudent-hr")
    if (hr) {
      expect(hr.domain).not.toBe(sl().domain)
      expect(hr.languages).not.toEqual(sl().languages)
    }
  })
})
