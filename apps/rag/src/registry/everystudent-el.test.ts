/**
 * The `everystudent-el` registry entry — EveryStudent's Greek domain
 * (everystudent.gr). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-sq.test.ts` / `everystudent-pl.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - `^https?://` in every filter — this sitemap publishes `http://` URLs, and
 *     the `^https://` pin every sibling uses would discover ZERO pages here;
 *   - `contentSelectors: ["#content4"]` — `content4` is an ID on this host, so
 *     the sibling `.content4` class selector matches nothing at all;
 *   - `.sectionlink`, not `.fccell`, is this host's CTA chrome;
 *   - the robots.txt Disallow, which names an `/a/` article path.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const el = (): SourceEntry => getSource("everystudent-el")!
/** The scheme the sitemap actually publishes. Not a typo — see the entry header. */
const HOST = "http://www.everystudent.gr"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = el().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-el registry entry", () => {
  it("resolves everystudent-el as an UNWALLED Greek source crawled over plain HTTP", () => {
    const entry = el()
    expect(entry.domain).toBe("www.everystudent.gr")
    expect(entry.languages).toEqual(["el"])
    // Verified 2026-07-29: robots.txt, /sitemap.xml and all 43 sitemap URLs
    // returned 200 to plain curl against nginx/Plesk — no Cloudflare layer.
    // Declaring a strategy here would bill every page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl whose filters admit the http:// URLs the sitemap publishes", () => {
    const entry = el()
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    // No seeds: the XML sitemap and the site's own /m/sitemap.shtml list the
    // SAME 32 /a/ URLs, so there is nothing to pin.
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    expect(entry.crawl.maxPages).toBeGreaterThan(43) // 43 sitemap URLs

    // ⚠️ THE load-bearing guard on this entry. Every <loc> in this sitemap is
    // `http://www.everystudent.gr/…`, and discoverUrls matches the raw <loc>
    // string without rewriting the scheme. "Tidying" these regexes to the
    // `^https://` form every sibling uses would keep 0 URLs and ingest nothing,
    // silently and on an HTTP 200.
    expect(keeps(`${HOST}/a/isthere.shtml`)).toBe(true)
    // Assert it at the regex level too, the way discoverUrls evaluates them
    // (≥1 pattern in each list must match), so the failure names the culprit.
    const hits = (pats: string[] | undefined): boolean =>
      !!pats?.some((p) => new RegExp(p).test(`${HOST}/a/isthere.shtml`))
    expect(hits(entry.crawl.allow)).toBe(true)
    expect(hits(entry.crawl.articleHints)).toBe(true)
    // https must keep working too: the 43 http URLs 301 to the identical https
    // path, so a regenerated sitemap could switch scheme at any time.
    expect(keeps("https://www.everystudent.gr/a/isthere.shtml")).toBe(true)
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. everystudent.gr is its own domain, so the Greek
    // content must not be folded into `everystudent` as a second language — the
    // same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(el().domain)
    expect(el().key).toBe("everystudent-el")
    expect(el().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("honours the robots.txt Disallow and drops the indexes and both homepage URLs", () => {
    // The `.shtml` extension is this host's, not the siblings' `.html`.
    expect(keeps(`${HOST}/a/trinity.shtml`)).toBe(true)
    expect(keeps(`${HOST}/a/trinity.html`)).toBe(false)
    // robots.txt is exactly `User-agent: * / Disallow: /a/fol.shtml`. That page
    // returns 200 and extracts 3,422 chars, so neither the 250 floor nor the
    // article hint would exclude it — and the acquire path does not enforce
    // robots.txt, so this block IS the enforcement.
    expect(keeps(`${HOST}/a/fol.shtml`)).toBe(false)
    // The 9 section indexes extract 94-1,281 chars; 7 of the 9 clear the floor.
    expect(keeps(`${HOST}/m/existence.shtml`)).toBe(false)
    expect(keeps(`${HOST}/m/sitemap.shtml`)).toBe(false)
    // The homepage is published under BOTH URLs and extracts 559 chars each —
    // it does NOT extract to 0, so leaving them stages two identical documents.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(keeps(`${HOST}/index.shtml`)).toBe(false)
    // Dead 404, and a retired Gospel-of-John reader by its path shape. Blocked
    // as a forward guard under the estate-wide scripture policy.
    expect(keeps(`${HOST}/en/word/john11.shtml`)).toBe(false)
    expect(el().crawl.minContentLength).toBe(250)
  })

  it("scopes to the #content4 ID, and never lets the empty #content_box shadow it", () => {
    const { contentSelectors } = el().crawl
    // Measured 2026-07-29 with the repo's own extractContent over all 32
    // articles: `content4` is an ID here (`<div id="content4">`) and there is no
    // class="content4" anywhere, so the sibling `.content4` — and
    // `.contentpadding`, `.content4b`, `.articletitle`, `article`, `main` — all
    // match 0 elements. #content4 matches 31/32 with 2,099-30,998 raw chars.
    // The `"html"` fallback is a deliberate LAST entry (orchestrator, 2026-07-29):
    // it is only ever consulted when the primary misses, so it cannot shadow
    // anything, and it beats extract.ts's implicit `?? root` because <html> is a
    // real element and so carries no literal "<!DOCTYPE html>" text node. What
    // must never change is the FIRST entry, and the absence of `.content4`.
    expect(contentSelectors).toEqual(["#content4", "html"])
    expect(contentSelectors[0]).toBe("#content4")
    expect(contentSelectors).not.toContain("#content_box")
    expect(contentSelectors).not.toContain(".content4")
    // #content_box is NOT a fallback: extractContent scopes to the first
    // selector that MATCHES AN ELEMENT rather than the first that yields text,
    // and on /a/personally.shtml #content_box matches while holding 0 chars.
    // Adding it would turn that page into a silent `too-thin` skip on a 200.
    expect(contentSelectors).not.toContain("#content_box")
  })

  it("strips this host's real chrome and none of the sibling selectors that are absent here", () => {
    const strip = el().crawl.stripSelectors
    // The CTA action links appended to every article ("Πώς να αρχίσω μια σχέση
    // με τον Θεό", "Έχω μια ερώτηση…") — 75 instances, 54-213 chars per page.
    // This host's equivalent of the siblings' .fccell "FEATURE CLOSE" block.
    expect(strip).toContain(".sectionlink")
    // The section breadcrumb above the headline — 31 instances, 9-24 chars.
    expect(strip).toContain(".navtree1")
    // 0-char no-ops on all 31 healthy articles (they sit outside #content4), but
    // they are what makes /a/personally.shtml usable: stray </p> tags collapse
    // its container tree, extractContent falls back to the document root, and
    // these turn 6,804 chars of nav dump into 6,072 chars of clean article.
    const pageChrome = [
      "head",
      "#cookie-notice",
      "#head_container",
      "#sidebar",
      "#footer",
    ]
    for (const sel of pageChrome) expect(strip).toContain(sel)
    // Measured 0 INSTANCES on this host — it carries no FreeFind markers and no
    // .fccell CTA table at all. Listed as absent so nobody re-adds them from a
    // sibling entry believing they bind.
    for (const sel of [
      "sitelevel_noindex",
      ".fccell",
      ".fctable",
      ".hr2",
      ".relatedbottom",
      ".shareiconsmenupg",
    ]) {
      expect(strip).not.toContain(sel)
    }
  })
})
