/**
 * The `everystudent-am` registry entry — EveryStudent's Amharic domain
 * (habeshastudent.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-pl.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below pins a decision that took live measurement on 2026-07-29 to
 * reach, so a future edit cannot quietly undo it:
 *   - `contentSelectors: [".contentpadding"]` and, critically, the ABSENCE of
 *     `.content4` — it matches 49 of 50 pages and extracts 0 chars on all 40
 *     articles, so listing it would shadow the real container and ingest nothing;
 *   - `am` (Amharic), NOT `ti` — "Habesha" spans Ethiopian/Eritrean identity and
 *     the sibling everytemhari.com is the Tigrinya banner;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery + ONE pinned seed: /a/personally.html is in the site's own HTML
 *     map and linked 51×, but absent from /sitemap.xml;
 *   - `/a/fol.html` blocked — it matches `articleHints`, so only the URL block
 *     catches this host's twin of the /aventure · /pack starter-kit signup;
 *   - the homepage, `/m/` indexes and `/john.html`, every one of which clears the
 *     250-char floor, so `minContentLength` could never have excluded them.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const am = (): SourceEntry => getSource("everystudent-am")!
const HOST = "https://www.habeshastudent.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = am().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-am registry entry", () => {
  it("is an UNWALLED AMHARIC source on its own key, not a language of everystudent", () => {
    const entry = am()
    expect(entry.domain).toBe("www.habeshastudent.com")
    // Amharic, NOT Tigrinya. Read on 2026-07-29: across all 40 articles the
    // Amharic copula/morphology dominates (936 x "ነው", 917 x "የሚ", 74 x "ነገር ግን")
    // while Tigrinya markers are essentially absent (4 x "ናይ", 1 x "እዩ"). The
    // sibling everytemhari.com remains the `ti` banner; the site declares
    // <html lang="am">. "Habesha" names the shared identity, not the language.
    expect(entry.languages).toEqual(["am"])
    // Verified 2026-07-29: all 50 sitemap URLs returned HTTP/2 200 from bare
    // Apache with zero Cloudflare markers. Declaring a strategy would bill every
    // page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // ADR-0006: one domain = one source, same rule that keeps thelife-fr and
    // thelife-zh separate from thelife.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(entry.domain)
    expect(entry.key).toBe("everystudent-am")
    expect(entry.key).toMatch(/^[a-z0-9-]+$/)
  })

  it("binds ONLY .contentpadding — .content4 must never be listed", () => {
    const selectors = am().crawl.contentSelectors
    // The single load-bearing measurement on this entry. `.contentpadding`
    // matched 45/50 pages with ZERO empties and holds the whole article on all
    // 40 (953-15,706 chars post-strip). `.content4` matched 49/50 and extracted
    // 0 chars on all 40 articles — an empty spacer div. extractContent scopes to
    // the first selector that MATCHES, not the first that yields text, so adding
    // `.content4` (or any "fallback") would bind the spacer and skip every
    // article as `too-thin` on an HTTP 200: silent, and invisible to these tests.
    // The `"html"` fallback is a deliberate LAST entry (orchestrator, 2026-07-29):
    // it is only ever consulted when the primary misses, so it cannot shadow
    // anything, and it beats extract.ts's implicit `?? root` because <html> is a
    // real element and so carries no literal "<!DOCTYPE html>" text node. What
    // must never change is the FIRST entry, and the absence of `.content4`.
    expect(selectors).toEqual([".contentpadding", "html"])
    expect(selectors[0]).toBe(".contentpadding")
    expect(selectors).not.toContain(".content4")
    expect(selectors).not.toContain(".content4")
  })

  it("is a DISCOVERY crawl with exactly one seed pinned for the sitemap's gap", () => {
    const entry = am()
    // /sitemap.xml answered 200 (3,965 bytes, a flat <urlset>, 50 <loc>, all
    // distinct, all live with 0 redirects).
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    // The stale-sitemap delta: /a/personally.html is on the site's own
    // /sitemap.html and linked from 51 pages, but is NOT in /sitemap.xml. It is a
    // genuine 3,754-char article, so discovery alone would silently lose it.
    // acquire.ts unions seeds with discovered URLs, and seeds bypass `block`.
    expect(seedUrls(entry)).toEqual([`${HOST}/a/personally.html`])
    expect(entry.crawl.maxPages).toBeGreaterThan(50) // 50 sitemap URLs + the seed
  })

  it("keeps /a/ articles and drops the indexes, signup pages, site plan and homepage", () => {
    expect(keeps(`${HOST}/a/isthere.html`)).toBe(true)
    expect(keeps(`${HOST}/a/bible.html`)).toBe(true) // apologetics ABOUT the Bible, not Scripture
    // /a/fol.html MATCHES articleHints — only the block excludes it. 713 chars:
    // the post-decision "እንኳን ደህና መጡ" page handing readers to addishiwot.net for
    // an email series. This host's twin of /aventure · /pack · /abenteuerreise.
    expect(keeps(`${HOST}/a/fol.html`)).toBe(false)
    // Every one of these clears minContentLength, so the floor cannot catch them:
    // homepage 856 ch (no .contentpadding -> <body> fallback), /m/ indexes
    // 9-676 ch, /sitemap.html 1,101 ch, /john.html 1,039 ch (Gospel-of-John
    // MailChimp signup), /about.html 560 ch.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(keeps(`${HOST}/m/knowing.html`)).toBe(false)
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false)
    expect(keeps(`${HOST}/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/john.html`)).toBe(false)
    expect(keeps(`${HOST}/about.html`)).toBe(false)
    expect(keeps(`${HOST}/contact.html`)).toBe(false)
    // Off-domain never survives `allow`.
    expect(keeps("https://addishiwot.net/a/isthere.html")).toBe(false)
  })

  it("does not assume lowercase-ASCII slugs, even though this host only has them", () => {
    // Verified across all 50 <loc> values: 0 non-ASCII bytes, 0 %XX escapes, 0
    // uppercase. But a `[a-z0-9-]+` hint would silently drop a future mixed-case
    // or percent-encoded slug, as mixed-case slugs elsewhere on this estate
    // (/a/pomoshch-ot-Boga.html, /articulos/Dios.html) already prove.
    expect(keeps(`${HOST}/a/Isthere.html`)).toBe(true)
    expect(keeps(`${HOST}/a/%E1%88%98%E1%8C%BD%E1%88%90%E1%8D%8D.html`)).toBe(
      true,
    )
    // ...but the hint still stops at a single path segment.
    expect(keeps(`${HOST}/a/sub/dir.html`)).toBe(false)
  })

  it("strips the chrome that sits inside .contentpadding on every article", () => {
    const strip = am().crawl.stripSelectors
    // The custom ELEMENT tag (no leading dot) — 2 instances on 40/40, the largest
    // contributor at 119 chars solo: the share row and the footer contact/nav
    // block ("በስልክ ምክር ለማግኘት 0116174400 ይደውሉ / ► ሳይት ማፕ").
    expect(strip).toContain("sitelevel_noindex")
    // The FEATURE CLOSE call-to-action, 49-106 chars JOINTLY. Both are required:
    // each measures 0 marginal alone only because they cover each other, so
    // dropping .fccell leaves the cells and dropping .fctable leaves the shell.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // MailChimp signup forms sit inside .contentpadding on this host.
    expect(strip).toContain("form")
    // A no-op today (0 marginal — sitelevel_noindex is well-formed here and
    // already contains it) kept only as a drift guard. Not evidence it strips.
    expect(strip).toContain(".shareiconsmenupg")
  })
})
