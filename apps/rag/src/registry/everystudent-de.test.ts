/**
 * The `everystudent-de` registry entry — EveryStudent's German domain
 * (duentscheidest.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent.test.ts` / `everystudent-ar.test.ts` /
 * `everystudent-fr.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is the one that is not walled,
 *     and adding a strategy here would bill every page for nothing;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the sitemap is reachable;
 *   - `/artikel/` only — `/audio/` reprints the same articles as transcripts;
 *   - the CTA/share chrome strip, including the site-specific "TEILEN:" widget.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const de = (): SourceEntry => getSource("everystudent-de")!

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = de().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-de registry entry", () => {
  it("resolves everystudent-de as an UNWALLED German source crawled over plain HTTP", () => {
    const entry = de()
    expect(entry.domain).toBe("www.duentscheidest.com")
    expect(entry.languages).toEqual(["de"])
    // The load-bearing fact: probed 2026-07-28, 11 pages (robots.txt,
    // /sitemap.xml, 6 articles, /audio/, /p_andy.html, /menu/Gott.html) all
    // returned HTTP 200 with real content and no Cloudflare block page. This is
    // the one EveryStudent banner that does NOT need Firecrawl — declaring a
    // strategy here would bill every page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, not a hand-listed seed set", () => {
    const entry = de()
    // /sitemap.xml answered 200 (6,054 bytes, 72 <loc>, 70 distinct), so there
    // is no reason to hand-list. The three walled siblings had to; this one
    // doesn't. Precedent for the shape: thelife-fr.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    // Discovery needs the filter trio to be meaningful, not just present.
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.block?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(70) // 70 distinct sitemap URLs
  })

  it("is a SEPARATE source key per domain, alongside the other three banners (ADR-0006)", () => {
    // One domain = one source. duentscheidest.com is its own domain, so the
    // German content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(de().domain)
    expect(de().key).toBe("everystudent-de")
    const keys = [
      "everystudent",
      "everystudent-ar",
      "everystudent-fr",
      "everystudent-de",
    ]
    const domains = keys.map((k) => getSource(k)!.domain)
    expect(new Set(domains).size).toBe(4)
  })

  it("keeps /artikel/ pages and drops the audio transcripts, menus, signup and contact stubs", () => {
    const host = "https://www.duentscheidest.com"
    expect(keeps(`${host}/artikel/gibtes.html`)).toBe(true)
    expect(keeps(`${host}/artikel/Gottes-Hilfe-video.html`)).toBe(true)
    // /audio/* reprints the whole article as a "Video-Transkription": all 11
    // slugs have an /artikel/ twin, and /audio/gibtes.html shares 73.3% of its
    // 12-word shingles with /artikel/gibtes.html. The document-level content
    // hash cannot collapse duplicates living at different URLs.
    expect(keeps(`${host}/audio/gibtes.html`)).toBe(false)
    // Section indexes — teaser link lists, incl. the site plan and imprint.
    expect(keeps(`${host}/menu/Gott.html`)).toBe(false)
    expect(keeps(`${host}/menu/sitemap.html`)).toBe(false)
    // 14-char contact stubs ("Kontakt - Andy").
    expect(keeps(`${host}/p_andy.html`)).toBe(false)
    expect(keeps(`${host}/`)).toBe(false)
  })

  it("drops the email-signup landing page that minContentLength could never catch", () => {
    // /abenteuerreise.html is the signup form for the free 7-email series "Die
    // geistliche Abenteuerreise" — the German twin of the French /aventure.html
    // and Arabic /pack.html. It extracts 1,539 chars, so it CLEARS the 250-char
    // floor comfortably: length is not aboutness. Slice #10 paid to learn this
    // by seeding its twin, fetching it, then deleting the rows.
    expect(keeps("https://www.duentscheidest.com/abenteuerreise.html")).toBe(
      false,
    )
    expect(de().crawl.minContentLength).toBe(250)
  })

  it("scopes to .contentpadding and never lets the empty .content4 spacer shadow it", () => {
    const { contentSelectors } = de().crawl
    // Measured 2026-07-28 with the repo's own extractContent against live
    // pages: .contentpadding is the ONLY element on this host that extracts the
    // article (19,471 ch raw on /artikel/gibtes.html, 3,771 on
    // /artikel/ichkann.html). .content4 exists but is an empty spacer div — 0
    // chars — and .content4b is absent. Every token is ALSO declared in the
    // inline <style>, so a grep proves nothing. extractContent scopes to the
    // first selector that MATCHES AN ELEMENT, not the first that yields text,
    // so either listed ahead of .contentpadding silently extracts nothing and
    // every page skips `too-thin` on a 200. This is the guard against that.
    expect(contentSelectors).toEqual([".contentpadding"])
  })

  it("strips the share/CTA chrome, including the site-specific TEILEN widget", () => {
    const strip = de().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // Measured 2 instances / 109 ch inside .contentpadding. The missing leading
    // "." is correct, not a typo.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA: the table shell as well as its cells, or the
    // emptied shell survives. Measured 204 ch on gibtes, 54 on ichkann.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // Site-specific: the "TEILEN:" AddToAny widget, 9 ch. Its wrapping
    // <sitelevel_noindex> is malformed — it opens inside .contentpadding and
    // closes only after .contentpadding does, so the parser pops it early and
    // it never encloses the widget (#128). Without this selector "TEILEN:"
    // trails every extraction.
    expect(strip).toContain(".shareiconsmenupg")
  })
})
