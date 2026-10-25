/**
 * The `everystudent-tr` registry entry — EveryStudent's Turkish domain
 * (tanriyitanimak.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-ru.test.ts` / `everystudent-de.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled, and adding a
 *     strategy here would bill 71 pages for a wall that isn't there;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the sitemap is reachable AND
 *     complete (74 /makaleler/ links harvested, 74 in the sitemap, zero delta);
 *   - a case-agnostic article hint — two live slugs carry capitals;
 *   - `.contentpadding` alone, because `.content4` is an empty spacer that
 *     would shadow it and silently extract 0 chars on every page;
 *   - URL blocks for the signup pages and the containerless video pages, all
 *     of which clear the 250-char floor that could never have caught them.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const tr = (): SourceEntry => getSource("everystudent-tr")!
const HOST = "https://www.tanriyitanimak.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = tr().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-tr registry entry", () => {
  it("resolves everystudent-tr as an UNWALLED Turkish source crawled over plain HTTP", () => {
    const entry = tr()
    expect(entry.domain).toBe("www.tanriyitanimak.com")
    expect(entry.languages).toEqual(["tr"])
    // The load-bearing fact: probed 2026-07-29, 187 plain-HTTP requests (all 74
    // articles, all 11 audio pages, all 9 section/legal pages, the homepage and
    // every utility page, plus a HEAD sweep of all 101 sitemap URLs) returned
    // HTTP 200 — 101/101 with zero redirects — and not one carried a Cloudflare
    // block-page signature. Declaring a strategy here would bill every page.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, not a hand-listed seed set", () => {
    const entry = tr()
    // /sitemap.xml answered 200 (16,548 bytes, 101 well-formed <loc>, all
    // distinct), and the HTML sitemap cross-check found zero missing articles —
    // so there is nothing to hand-list and nothing to pin as a seed.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    // Discovery needs the filter trio to be meaningful, not merely present.
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.block?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(101) // 101 sitemap URLs
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. tanriyitanimak.com is its own domain, so the
    // Turkish content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(tr().domain)
    expect(tr().key).toBe("everystudent-tr")
    // `languages` is a declaration about THIS domain only, never a claim of
    // exclusive ownership of the language.
    expect(tr().languages).toEqual(["tr"])
  })

  it("keeps /makaleler/ articles including the mixed-case slugs, and drops the indexes", () => {
    expect(keeps(`${HOST}/makaleler/varmi.html`)).toBe(true)
    // Turkish content, ASCII slugs — but two live articles carry capitals, so
    // the hint must not assume lowercase or it silently drops them.
    expect(keeps(`${HOST}/makaleler/KutsalRuh.html`)).toBe(true)
    expect(keeps(`${HOST}/makaleler/Rabiyimidir.html`)).toBe(true)
    // Section indexes: no .contentpadding, so they body-fall-back to 455-1,467
    // chars of nav. /konular/gizlilik.html is the 9,737-char KVKK privacy page.
    expect(keeps(`${HOST}/konular/varlik.html`)).toBe(false)
    expect(keeps(`${HOST}/konular/gizlilik.html`)).toBe(false)
    // Audio pages reprint their article: 76.3-98.8% 12-word shingle containment
    // against the /makaleler/ twin, so ingesting both double-counts.
    expect(keeps(`${HOST}/ses/isakimdi.html`)).toBe(false)
    // The site plan (3,440 ch), the video index (609 ch) and the homepage
    // (889 ch via <body> fallback — it does NOT extract empty).
    expect(keeps(`${HOST}/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/videolar.html`)).toBe(false)
    expect(keeps(`${HOST}/`)).toBe(false)
  })

  it("blocks by URL the pages minContentLength could never have caught", () => {
    // The Gospel-of-John email study signup (1,761 ch) and the free "Ruhsal
    // Yolculuk Serisi" email series signup (1,266 ch) — twins of the French
    // /jean.html and /aventure.html. Both clear the 250-char floor: length is
    // not aboutness, which slice #10 paid to learn.
    expect(keeps(`${HOST}/yuhanna/`)).toBe(false)
    expect(keeps(`${HOST}/yolculuk/`)).toBe(false)
    // The only two pages on the host with NO working container: .contentpadding
    // is absent and .content4b is an empty spacer, so extraction body-falls-back
    // to 5,518 / 5,681 chars of nav + sidebar. They match the article hint, so
    // nothing but a URL block stops them.
    expect(keeps(`${HOST}/makaleler/Tanriyi-tanimak-video.html`)).toBe(false)
    expect(keeps(`${HOST}/makaleler/yardimini-video.html`)).toBe(false)
    expect(tr().crawl.minContentLength).toBe(250)
  })

  it("scopes to .contentpadding and never lets the empty spacer divs shadow it", () => {
    const { contentSelectors } = tr().crawl
    // Measured 2026-07-29 with extract.ts's own logic against live pages:
    // .contentpadding is the ONLY element on this host that extracts the
    // article (18,724 ch raw on /makaleler/varmi.html; min 126 / median 6,766 /
    // max 23,811 across all 74). .content4 exists but is an empty spacer — 0
    // chars on all 85 pages measured — and .content4b exists on two pages only,
    // also 0 chars. Every one of these tokens is ALSO declared in the page's
    // inline <style>, so a grep proves nothing. extractContent scopes to the
    // first selector that MATCHES AN ELEMENT, not the first that yields text,
    // so either of them listed ahead of .contentpadding silently extracts
    // nothing and every page skips `too-thin` on a 200. This is that guard.
    expect(contentSelectors).toEqual([".contentpadding"])
  })

  it("strips the share/CTA chrome measured inside .contentpadding", () => {
    const strip = tr().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // Measured 2 instances / 154 ch inside .contentpadding: the "BU MAKALEYİ
    // PAYLAŞIN:" share row and the bottom utility nav. The missing leading "."
    // is correct, not a typo.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA: the table shell as well as its cells, or the
    // emptied shell survives. Measured removal 192 / 87 / 174 ch on the three
    // articles sampled.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // Retained for sibling parity even though it is a 0-marginal-char no-op
    // here: on this host the enclosing <sitelevel_noindex> is well-formed, so
    // it already removes the widget. On the German and Russian siblings that
    // tag is malformed and this selector is the only thing that catches the
    // share row (#128) — keep it in case the markup regresses.
    expect(strip).toContain(".shareiconsmenupg")
  })
})
