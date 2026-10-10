/**
 * The `everystudent-te` registry entry — EveryStudent's Telugu domain
 * (everytelugustudent.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-bn.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is not walled;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery off the live sitemap, plus ONE pinned seed the maps both omit;
 *   - `contentSelectors: ["html"]` alone — `.content4` MATCHES on 30/30 pages
 *     and extracts 0 chars, so listing it would shadow the only real container
 *     and ingest nothing;
 *   - `/a/whowas.html` blocked as the abridged Gospel of John, carrying a
 *     third-party Tyndale/NLT licence;
 *   - `/a/` only — the `/m/` indexes, the contact form and the homepage all
 *     clear the 250-char floor, so `minContentLength` could never exclude them.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const te = (): SourceEntry => getSource("everystudent-te")!
const HOST = "https://www.everytelugustudent.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = te().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-te registry entry", () => {
  it("resolves everystudent-te as an UNWALLED Telugu source on the www canonical host", () => {
    const entry = te()
    // Checked BOTH ways 2026-07-30: the bare apex 301s to www, and www serves
    // 200. Pinning the apex instead would make every regex below miss, because
    // the sitemap emits www absolute URLs and the filters match the full URL.
    expect(entry.domain).toBe("www.everytelugustudent.com")
    expect(entry.crawl.baseUrl).toBe(HOST)
    expect(entry.languages).toEqual(["te"])
    // Verified 2026-07-30: robots.txt, /sitemap.xml and all 39 sitemap URLs
    // returned 200 to plain curl against bare Apache — no Cloudflare layer and
    // no block page. Declaring a strategy would bill every page for a wall that
    // isn't there. robots.txt is `User-agent: * Allow: /`, with no Disallow at
    // all, so nothing below is blocked on robots grounds.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a DISCOVERY crawl off the live sitemap, plus the one seed both maps omit", () => {
    const entry = te()
    // /sitemap.xml answered 200 (3,342 bytes, 39 <loc>, all distinct, all
    // https). /sitemap_index.xml is a 404 — no larger index is hiding behind it.
    // The site's own HTML map (/m/map.html) lists the same 30 /a/ URLs, so the
    // two agree exactly and there is no stale-map delta to pin.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    // /a/fol.html: a genuine 2,834-ch article ("దేవునితో ఆరంభించుట") absent from
    // BOTH maps and reachable only from each article's CTA cell, so discovery
    // cannot find it. Same call as everystudent-ms; NOT the -th/-am case, whose
    // same-named pages are short signup stubs.
    expect(entry.crawl.seedPaths).toEqual(["/a/fol.html"])
    expect(seedUrls(entry)).toEqual([`${HOST}/a/fol.html`])
    expect(entry.crawl.maxPages).toBeGreaterThan(39) // 39 sitemap URLs
  })

  it("is a SEPARATE source key per domain, not a language of everystudent (ADR-0006)", () => {
    // One domain = one source. everytelugustudent.com is its own domain, so the
    // Telugu content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(te().domain)
    expect(te().key).toBe("everystudent-te")
    expect(te().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("blocks the abridged Gospel of John, which matches articleHints and clears the floor", () => {
    // /a/whowas.html ("యేసు ఎవరు?") extracts 23,429 chars of verbatim John —
    // 16 chapters under their own headings, and its own standfirst says "no
    // commentary whatsoever has been added". Estate-wide scripture policy
    // (2026-07-29). It is ALSO the one page on the domain carrying a
    // third-party licence, "New Living Translation, © Tyndale House
    // Foundation", which this entry's `rights` line would misattribute. It sits
    // under /a/ and is 93× the floor, so ONLY this URL block excludes it.
    expect(keeps(`${HOST}/a/whowas.html`)).toBe(false)
    // An apologetics essay ABOUT the Bible is not scripture and must survive.
    // /a/bible.html argues from history/archaeology about the text (15,081 ch);
    // /a/isthere.html's only "Tyndale" hit is a bibliographic footnote.
    expect(keeps(`${HOST}/a/bible.html`)).toBe(true)
    expect(keeps(`${HOST}/a/isthere.html`)).toBe(true)
    expect(keeps(`${HOST}/a/whodoyousay.html`)).toBe(true)
  })

  it("keeps /a/ articles and drops the indexes, contact form and homepage", () => {
    // Mixed case is real on this host: /a/Godreal.html carries an uppercase G,
    // so the hint uses [^/]+ and a [a-z0-9-]+ class would silently drop it.
    expect(keeps(`${HOST}/a/Godreal.html`)).toBe(true)
    expect(keeps(`${HOST}/a/gaylesbian.html`)).toBe(true)
    // The 7 section indexes — headline+teaser link lists, 274-1,047 chars, so
    // they CLEAR the 250 floor. /m/map.html is this host's site plan (there is
    // no /sitemap.html: it 404s); /m/intl.html links out to the sibling domains.
    expect(keeps(`${HOST}/m/knowing.html`)).toBe(false)
    expect(keeps(`${HOST}/m/map.html`)).toBe(false)
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false)
    // 299 chars — clears the 250 floor by 49. Only a URL block catches it.
    expect(keeps(`${HOST}/contact.html`)).toBe(false)
    // The homepage yields 1,089 chars of teasers, NOT 0: `html` matches on it
    // as readily as on an article.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(te().crawl.minContentLength).toBe(250)
  })

  it("scopes to html and never lets the empty .content4 template shadow it", () => {
    const { contentSelectors } = te().crawl
    // Measured 2026-07-30 with the repo's own extractContent over all 30
    // articles: `.content4` MATCHES on 30/30 and extracts 0 chars (two empty
    // spacer divs), `.contentpadding` / `#content4` / `.content4b` match 0/30,
    // and <body> is absent from the parsed tree — a stray </sitelevel_noindex>
    // closes the content divs early and flattens the article into <html>'s
    // direct children. <html> is the only element that contains it (1,911-23,429
    // chars post-strip, median 9,112, 0 pages under the floor).
    // Because extractContent scopes to the first selector that MATCHES AN
    // ELEMENT rather than the first that yields text, adding `.content4` would
    // win on every page and return "" — the whole corpus skipping `too-thin` on
    // an HTTP 200, invisible to these tests. That is the batch-1 failure. And an
    // appended "html" would NOT rescue it, because `.content4` matches.
    expect(contentSelectors).toEqual(["html"])
    expect(contentSelectors).not.toContain(".content4")
    expect(contentSelectors).not.toContain(".contentpadding")
    expect(contentSelectors).not.toContain("#content4")
  })

  it("strips the chrome that survives on THIS host, and omits the selectors that cannot bind", () => {
    const strip = te().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 60 instances (2/page), removing exactly 2,100 chars on all 30 articles:
    // the top nav and the related-links + footer block. The missing leading "."
    // is correct, not a typo. Largest contributor on this host.
    expect(strip).toContain("sitelevel_noindex")
    // The one piece of chrome that SURVIVES sitelevel_noindex here: the share
    // label "పంచుకోండిి" sits outside that wrapper. Without this, that word
    // prefixes all 30 extractions.
    expect(strip).toContain(".likesharediv")
    // Required only because the container is <html>: drops the duplicated
    // <title>. Safe ONLY because extract.ts reads the title from `root` before
    // the strip loop runs — keep those two steps in that order.
    expect(strip).toContain("head")
    // structuredText reads inline script bodies: 1,271-1,418 chars per page.
    expect(strip).toContain("script")
    // Measured as 0 instances on this host and therefore deliberately ABSENT,
    // rather than carried forward from the siblings as regexes that can never
    // bind. .fctable is 0 because the CTA <table> carries no class here — only
    // its cells do, which is why .fccell IS present.
    expect(strip).toContain(".fccell")
    expect(strip).not.toContain(".fctable")
    expect(strip).not.toContain(".shareiconsmenupg")
    expect(strip).not.toContain(".relatedbottom")
  })
})
