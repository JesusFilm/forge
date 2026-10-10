/**
 * The `everystudent-lt` registry entry — EveryStudent's Lithuanian domain
 * (kiekvienamstudentui.lt). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following the sibling `everystudent-*.test.ts` files.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled, and adding a
 *     strategy would bill every page for a wall that isn't there;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery, not hand-listed seeds, because the sitemap is reachable and
 *     is a superset of the site's own HTML map;
 *   - `["html"]` alone, because `.content4` and `.content4b` both MATCH on this
 *     host and both extract 0 chars, which would silently skip every page;
 *   - the robots.txt block, which is the ONLY thing enforcing that rule;
 *   - the nav/chrome blocks, none of which minContentLength can catch.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const lt = (): SourceEntry => getSource("everystudent-lt")!
const HOST = "https://www.kiekvienamstudentui.lt"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = lt().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-lt registry entry", () => {
  it("resolves as an UNWALLED Lithuanian source crawled over plain HTTP", () => {
    const entry = lt()
    expect(entry.domain).toBe("www.kiekvienamstudentui.lt")
    expect(entry.languages).toEqual(["lt"])
    // The load-bearing fact: probed 2026-07-29, all 60 sitemap URLs plus
    // robots.txt, /sitemap.xml and both HTML map pages returned HTTP/2 200 from
    // `server: Apache` with no Cloudflare block page anywhere. Declaring a
    // strategy would bill Firecrawl credits for a wall that does not exist.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, not a hand-listed seed set", () => {
    const entry = lt()
    // /sitemap.xml answered 200 (9,780 bytes, 60 <loc>, 60 distinct, 48 of them
    // articles). The site's own /m/sitemap.html lists 47 /a/ URLs, ALL already
    // in the XML, and a full href harvest across all 60 pages surfaced no
    // missing article — only a robots-disallowed page, two 404s and one /m/
    // redirect. So there is nothing to pin. Precedent for the shape: thelife-fr.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(seedUrls(entry)).toEqual([])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    expect(entry.crawl.maxPages).toBeGreaterThan(60) // 60 distinct sitemap URLs
    expect(entry.crawl.minContentLength).toBe(250)
    // Real /a/ slugs from the sitemap must survive the filters.
    expect(keeps(`${HOST}/a/malda.html`)).toBe(true)
    expect(keeps(`${HOST}/a/biblija.html`)).toBe(true)
    expect(keeps(`${HOST}/a/rysys.html`)).toBe(true)
    expect(keeps(`${HOST}/a/kritikus2.html`)).toBe(true)
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. kiekvienamstudentui.lt is its own domain, so the
    // Lithuanian content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(lt().domain)
    expect(lt().key).toBe("everystudent-lt")
    const keys = ["everystudent", "everystudent-pl", "everystudent-lt"]
    expect(new Set(keys.map((k) => getSource(k)!.domain)).size).toBe(3)
  })

  it("honours the one robots.txt Disallow, which nothing else would enforce", () => {
    // robots.txt (43 bytes, fetched 2026-07-29) is exactly `User-agent: *` and
    // `Disallow: /a/rysysfollow.html`. The acquire path does NOT enforce
    // robots.txt, so this block IS the enforcement. The URL sits under /a/ and
    // therefore MATCHES articleHints, and it is linked from 13 articles' CTA
    // cells — deleting this line readmits a page we are told not to fetch.
    expect(keeps(`${HOST}/a/rysysfollow.html`)).toBe(false)
    // ...and the block must not overreach onto the real article next to it.
    expect(keeps(`${HOST}/a/rysys.html`)).toBe(true)
  })

  it("blocks the nav and chrome pages minContentLength cannot catch", () => {
    // Measured post-strip 2026-07-29 with the shipped config — every one of
    // these CLEARS the 250-char floor, so only a URL block excludes them.
    // `html` matches on all of them exactly as it does on an article, so none
    // of them extracts to nothing.
    expect(keeps(`${HOST}/`)).toBe(false) // 748 ch of homepage teasers
    expect(keeps(`${HOST}/kontaktai.html`)).toBe(false) // 538 ch contact page
    expect(keeps(`${HOST}/m/egzistavimas.html`)).toBe(false) // 735 ch index
    expect(keeps(`${HOST}/m/privatumo.html`)).toBe(false) // 22,954 ch GDPR policy
    expect(keeps(`${HOST}/m/sitemap.html`)).toBe(false) // 1,745 ch site plan
    expect(keeps(`${HOST}/m/tinklalapi.html`)).toBe(false) // 1,137 ch about page
    // /m/istorija.html is the ONE exception to the /m/ block (orchestrator,
    // 2026-07-29): 20,148 ch of genuine testimony, not navigation. A probe of the
    // /m/ namespace on -ru, -pl, -hu and -tr found nothing above 3,589 ch, so it
    // is a one-off rather than content the blanket block has been eating. The
    // negative lookahead in `block` plus the articleHints entry keep it.
    expect(keeps(`${HOST}/m/istorija.html`)).toBe(true)
  })

  it("scopes to `html` alone and never lets an empty .content4/.content4b shadow it", () => {
    const { contentSelectors, stripSelectors } = lt().crawl
    // Measured 2026-07-29 over all 48 articles with the repo's own
    // extractContent: `.content4` MATCHES on 46/48 and extracts 0 chars on
    // every one; `.content4b` MATCHES on the 2 remaining pages and extracts 0
    // chars there too. extractContent binds the first selector that MATCHES
    // rather than the first that yields text, so adding either would skip every
    // page as `too-thin` on an HTTP 200 (#128). `.contentpadding` works on
    // 46/48 and is byte-identical to `html` after the strips, but misses the 2
    // malformed pages and falls back to the document root, prefixing them with
    // a literal "<!DOCTYPE html>". Not a fallback chain: exactly one selector.
    expect(contentSelectors).toEqual(["html"])
    // Because the container is <html>, `head` MUST be stripped or every
    // document opens with a duplicate of its own <title>.
    expect(stripSelectors).toContain("head")
    // A custom ELEMENT tag, not a class — the missing "." is correct. 4
    // instances per page carrying cookie bar, nav, share heading, related links
    // and footer: 841 ch alone, the single largest contributor.
    expect(stripSelectors).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA sits OUTSIDE sitelevel_noindex on this host, so
    // .fctable still removes 59-151 ch on 47/48 pages after it. .fccell is the
    // only thing that catches the CTA on the malformed /a/rysys.html (69 ch).
    expect(stripSelectors).toContain(".fctable")
    expect(stripSelectors).toContain(".fccell")
    // Without the generic strips the chrome leak is 900-992 ch/page: with
    // `html` as the container the strip list, not the DOM, is what keeps nav
    // out. Do not thin it.
    for (const s of ["script", "style", "nav", "header", "footer", "form"]) {
      expect(stripSelectors).toContain(s)
    }
  })
})
