/**
 * The `everystudent-ka` registry entry — EveryStudent's Georgian domain
 * (kovelistudenti.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-it.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds — the XML sitemap is an 8-year-old file
 *     that nevertheless matches the site's own HTML map exactly;
 *   - `contentSelectors: [".contentpadding", "html"]`. `.content4` is an ID on
 *     this host (`#content4`), which is the single character that made #111
 *     flag it as having no shared-template selectors — and `.articletitle`
 *     MATCHES here while yielding only the 5-62-char `<h1>`, so adding it would
 *     shadow the real container;
 *   - the robots.txt Disallow on `/a/fol.html`, which the acquire path does not
 *     enforce for us;
 *   - the block on `/a/omi216.html`, a 301 to the homepage.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const ka = (): SourceEntry => getSource("everystudent-ka")!
const HOST = "https://www.kovelistudenti.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = ka().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-ka registry entry", () => {
  it("resolves everystudent-ka as an UNWALLED Georgian source on the www host", () => {
    const entry = ka()
    // The apex 301s to www (measured 2026-07-30) and every sitemap <loc> emits
    // www, so domain/baseUrl/every regex must be pinned to www or all filters
    // miss. `everystudent.sk` redirects the other way — this one does not.
    expect(entry.domain).toBe("www.kovelistudenti.com")
    expect(entry.crawl.baseUrl).toBe(HOST)
    expect(entry.languages).toEqual(["ka"])
    // Verified 2026-07-30: robots.txt, /sitemap.xml, /m/sitemap.html and all 25
    // sitemap URLs returned HTTP/2 200 to plain curl against bare Apache — no
    // cf-ray header on any response, no block-page signature on any page.
    // Declaring a strategy would bill every page through Firecrawl for a wall
    // that is not there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. kovelistudenti.com is its own domain, so the
    // Georgian content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(ka().domain)
    expect(ka().key).toBe("everystudent-ka")
    expect(ka().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("is a DISCOVERY crawl off the live sitemap, with nothing pinned as seeds", () => {
    const entry = ka()
    // /sitemap.xml answered 200 (2,262 bytes, 25 <loc>, all distinct);
    // /sitemap_index.xml is 404, so there is no larger index hiding behind it.
    // Its Last-Modified is 2017-10-03 — a fossil, the shape of hazard that made
    // everystudent.sk's "44 URLs" wrong — so it was cross-checked: the site's
    // own /m/sitemap.html lists the same 16 articles, and harvesting every
    // internal href across all 25 pages found only /a/fol.html (robots-blocked)
    // and /a/omi216.html (a 301). Nothing to pin.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    expect(entry.crawl.maxPages).toBeGreaterThan(25) // 25 sitemap URLs
  })

  it("binds the measured container FIRST and refuses the selector that shadows it", () => {
    const selectors = ka().crawl.contentSelectors
    // The load-bearing fact. Measured 2026-07-30 with the repo's own
    // extractContent over all 24 fetched pages: `.contentpadding` matches 18/24
    // (all 16 articles) at 346-29,305 chars, with ZERO matched-but-empty pages
    // — so `html` can be appended as a real last resort. Order matters:
    // extractContent binds the FIRST selector that MATCHES an element, not the
    // first that yields text.
    expect(selectors[0]).toBe(".contentpadding")
    expect(selectors.at(-1)).toBe("html")
    expect(selectors).toHaveLength(2)
    // ⚠️ `.articletitle` MATCHES on 18/24 pages here and yields 5-62 chars (the
    // <h1> alone). It sits ahead of `.contentpadding` in the sibling selector
    // list, so pasting that list in would stage 16 documents of ~20 chars each.
    expect(selectors).not.toContain(".articletitle")
    // `.content4` is an ID on this host (`#content4`), so the CLASS form matches
    // 0/24 — the single character behind #111's false "no shared-template
    // selectors" flag. These all measured 0 matches; none belongs here.
    for (const dead of [
      ".content4",
      ".content4b",
      ".post-content",
      ".entry-content",
      ".cb-entry-content",
      ".contentleftpadding",
      ".article-content",
      ".content",
    ]) {
      expect(selectors).not.toContain(dead)
    }
  })

  it("strips this host's measured chrome plus the head the html fallback needs", () => {
    const strip = ka().crawl.stripSelectors
    // Measured inside .contentpadding across the 16 articles, 2026-07-30:
    // .hiddencontact 16 inst / 272 ch (the duplicated "do you have a question?"
    // card), .a2a_dd 48 inst / 368 ch (the AddToAny "share this page" link).
    expect(strip).toContain(".hiddencontact")
    expect(strip).toContain(".a2a_dd")
    // Required by the `html` fallback: without it the fallback path emits the
    // <title> twice. 0 chars on healthy pages. extract.ts reads the title from
    // `root` BEFORE the strip loop, so this is safe.
    expect(strip).toContain("head")
    // ZERO occurrences of each token in this host's raw HTML — not zero
    // extracted chars, zero markup. Carrying them would be sibling theatre.
    for (const absent of [
      "sitelevel_noindex",
      ".fccell",
      ".fctable",
      ".relatedbottom",
      ".shareiconsmenupg",
      ".sectionlink",
    ]) {
      expect(strip).not.toContain(absent)
    }
  })

  it("keeps the 16 /a/ articles and drops the robots-disallowed, dead and nav URLs", () => {
    // Real sitemap URLs. The two uppercase ones are the reason articleHints uses
    // `[^/]+` — an `[a-z0-9-]+` hint would silently drop 2 of the 16.
    expect(keeps(`${HOST}/a/Ghmerti101.html`)).toBe(true)
    expect(keeps(`${HOST}/a/Ghmerti109.html`)).toBe(true)
    expect(keeps(`${HOST}/a/khangrdzlivi502.html`)).toBe(true)
    // 29,243 chars, "Why you can believe the Bible" — an apologetics essay
    // ABOUT the Bible (archaeology, transmission, footnoted citations), NOT
    // Scripture. Kept deliberately under the 2026-07-29 scripture policy.
    expect(keeps(`${HOST}/a/bibliisa215.html`)).toBe(true)

    // robots.txt: `Disallow: a/fol.html`. The acquire path does NOT enforce
    // robots.txt, so this block IS the enforcement. The page returns 200 and
    // extracts 381 chars, so the 250 floor would never have caught it.
    expect(keeps(`${HOST}/a/fol.html`)).toBe(false)
    // 301 to the homepage. Linked from /m/daieso200.html and this sitemap is
    // regenerated by a link-following crawler, so a regeneration would admit it
    // — and following the redirect stages the homepage under an article URL.
    expect(keeps(`${HOST}/a/omi216.html`)).toBe(false)
    // The homepage is in the sitemap TWICE, as / and as /index.html. Both fall
    // through to the `html` fallback at 1,077 chars, so only a URL block stops
    // two byte-identical documents being staged.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(keeps(`${HOST}/index.html`)).toBe(false)
    // Section indexes (825-1,169 ch), the about page (1,059 ch), the HTML site
    // map (641 ch) and the contact form (329 ch) — all clear the 250 floor.
    expect(keeps(`${HOST}/m/arseboba100.html`)).toBe(false)
    expect(keeps(`${HOST}/m/shesaxeb803.html`)).toBe(false)
    expect(keeps(`${HOST}/m/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/kontakt801.html`)).toBe(false)
  })
})
