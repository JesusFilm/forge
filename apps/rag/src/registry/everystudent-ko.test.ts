/**
 * The `everystudent-ko` registry entry — EveryStudent's Korean domain
 * (everykoreanstudent.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent.test.ts` / `everystudent-ar.test.ts` /
 * `everystudent-fr.test.ts` / `everystudent-ja.test.ts`.
 *
 * Each guard below encodes a decision measured against the live host on
 * 2026-07-28, so a future edit cannot quietly undo it:
 *   - NOT walled, so no `fetchStrategy` — unlike the three walled banners;
 *   - discovery mode, because the sitemap is free and reachable here;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - **`contentSelectors: ["html"]` and the ABSENCE of `.content4`** — the
 *     shared template matches but extracts nothing on this host, so re-adding
 *     it would silently reduce every article to the empty string;
 *   - the block list, which does real work the content-length floor cannot.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const ko = (): SourceEntry => getSource("everystudent-ko")!

describe("everystudent-ko registry entry", () => {
  it("resolves everystudent-ko as an UNWALLED Korean source crawled by discovery", () => {
    const entry = ko()
    expect(entry.domain).toBe("www.everykoreanstudent.com")
    expect(entry.languages).toEqual(["ko"])
    // Verified 2026-07-28: robots.txt, /sitemap.xml, the homepage, 13 articles
    // and 4 menu pages all returned 200 to plain HTTP against bare Apache — no
    // Cloudflare layer at all. Declaring firecrawl would bill every page for a
    // wall that does not exist.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, not hand-listed seeds: the sitemap is reachable and free, so
    // there is no frozen inventory to lift (the inverse of the walled siblings).
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. everykoreanstudent.com is its own domain, so the
    // Korean content must not be folded into `everystudent` as a second
    // language — the same rule that keeps everystudent-ar/-fr/-ja separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(ko().domain)
    expect(ko().key).toBe("everystudent-ko")
    expect(ko().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("scopes content to <html> and must NOT use the shared .content4 template", () => {
    const { contentSelectors } = ko().crawl
    // THE load-bearing guard on this entry. Measured 2026-07-28 with the repo's
    // own parser across 13 article pages: `.content4` matches two divs and the
    // FIRST extracts 0 characters, `.content4b`/`.contentpadding` do not match
    // at all, and even <body> is missing from the parsed tree — stray
    // </sitelevel_noindex> end tags close the content divs early and flatten
    // the article into <html>'s direct children.
    //
    // extractContent takes the FIRST querySelector hit, so re-adding `.content4`
    // would make it win and return "" for every article: the source would
    // ingest nothing while still looking correctly configured.
    expect(contentSelectors).toEqual(["html"])
    for (const s of [".content4", ".content4b", ".contentpadding"]) {
      expect(contentSelectors).not.toContain(s)
    }
  })

  it("strips the chrome that scoping to <html> drags in", () => {
    const strip = ko().crawl.stripSelectors
    // Measured contributions on /a/isthere101.html, 2026-07-28.
    // The custom TAG carrying the cookie bar, top nav and bottom share/popular
    // block — 1,311 chars, by far the largest single removal on this host.
    expect(strip).toContain("sitelevel_noindex")
    // Required ONLY because the container is <html>: without it every document
    // would open with a duplicate of its own <title>. extract.ts reads the
    // title from `root` before stripping, so this is safe in that order.
    expect(strip).toContain("head")
    // "FEATURE CLOSE" call-to-action cells (94 chars) and the AddToAny wrapper.
    expect(strip).toContain(".fccell")
    expect(strip).toContain(".likesharediv")
  })

  it("keeps exactly the /a/ article corpus and drops menus, the Flash stub and the homepage", () => {
    const { allow, articleHints, block } = ko().crawl
    const keep = (u: string) =>
      allow!.some((r) => new RegExp(r).test(u)) &&
      articleHints!.some((r) => new RegExp(r).test(u)) &&
      !block!.some((r) => new RegExp(r).test(u))
    const H = "https://www.everykoreanstudent.com"
    // 37 of the sitemap's 48 URLs survive: the 38 /a/*.html pages less the stub.
    expect(keep(`${H}/a/isthere101.html`)).toBe(true)
    expect(keep(`${H}/a/bible215.html`)).toBe(true)
    expect(keep(`${H}/a/Godreal.html`)).toBe(true)
    // The 9 /m/* section indexes extract to 147-735 chars and the homepage to
    // 845 — above the 250 floor, so the floor could never have caught them and
    // this block list is load-bearing, not decoration.
    expect(keep(`${H}/m/map.html`)).toBe(false)
    expect(keep(`${H}/m/existence.html`)).toBe(false)
    expect(keep(`${H}/`)).toBe(false)
    // A Flash-era stub twin of /a/knowing401.html — extracts to 47 chars.
    expect(keep(`${H}/a/knowing401FLASH.html`)).toBe(false)
    expect(keep(`${H}/a/knowing401.html`)).toBe(true)
    // robots.txt, fetched live 2026-07-28: Disallow /features/fol.html and
    // /features/folfl.html. Neither is in the sitemap, so this records the rule
    // rather than enforcing it — but it must stay recorded.
    const blocked = (u: string) => block!.some((r) => new RegExp(r).test(u))
    expect(blocked(`${H}/features/fol.html`)).toBe(true)
    expect(blocked(`${H}/features/folfl.html`)).toBe(true)
  })

  it("declares partner provenance, article defaults and Korean tagging", () => {
    const entry = ko()
    expect(entry.trust).toBe("partner")
    expect(entry.ingestionMode).toBe("html-scrape")
    expect(entry.defaultCategory).toBe("article")
    expect(entry.defaultTags).toEqual([
      "everystudent",
      "cru",
      "topic:seeker",
      "lang:ko",
    ])
    expect(entry.rights).toContain("Cru")
    // 48 sitemap URLs + headroom; polite 1s delay on direct fetches. The 250
    // floor is safe: the shortest sampled article was 1,086 chars (4.3x).
    expect(entry.crawl.maxPages).toBe(80)
    expect(entry.crawl.requestDelayMs).toBe(1000)
    expect(entry.crawl.minContentLength).toBe(250)
  })
})
