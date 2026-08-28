/**
 * The `everystudent-kk` registry entry — EveryStudent's Kazakh domain
 * (shakirtter.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following the sibling `everystudent-*.test.ts` files.
 *
 * Each guard below pins a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is bare Apache, not walled;
 *   - a SEPARATE key from `everystudent` and from the Cyrillic `ru` sibling,
 *     because one domain = one source (ADR-0006);
 *   - `["html"]` ALONE, because `.content4` and `.container2` both match on
 *     17/17 articles at 0 chars and would shadow anything listed after them;
 *   - the robots.txt Disallow enforced BY URL, because acquire does not read
 *     robots.txt;
 *   - a `/baylanis.html` block anchored at the host root, so it cannot swallow
 *     the real 17,294-char article at `/a/baylanis.html`;
 *   - an `articleHints` regex that survives a Cyrillic or mixed-case slug.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const kk = (): SourceEntry => getSource("everystudent-kk")!
const HOST = "https://www.shakirtter.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = kk().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

/** The 25 `<loc>` values in /sitemap.xml, fetched verbatim 2026-07-30. */
const SITEMAP = [
  "/",
  "/a/usbirlikti.html",
  "/m/ekendigi.html",
  "/m/suraqtari.html",
  "/m/tanw.html",
  "/m/smenj.html",
  "/baylanis.html",
  "/a/barma.html",
  "/a/ateistin.html",
  "/a/nelikten.html",
  "/a/qaygiga.html",
  "/a/jeke.html",
  "/a/minajattarimizga.html",
  "/a/islam.html",
  "/a/baylanis.html",
  "/a/maqsatim.html",
  "/a/senimnen.html",
  "/a/wli.html",
  "/a/tinistigi.html",
  "/a/kieli.html",
  "/m/kartasi.html",
  "/m/twrali.html",
  "/a/tursigerlik.html",
  "/a/jaqsi.html",
  "/a/koronavirus.html",
].map((p) => `${HOST}${p}`)

describe("everystudent-kk registry entry", () => {
  it("resolves everystudent-kk as an UNWALLED Kazakh discovery crawl over plain HTTP", () => {
    const entry = kk()
    // The apex 301s to `www` (measured on /, /robots.txt, /sitemap.xml) and all
    // 25 sitemap <loc> values use the www host, so every regex is pinned to it.
    expect(entry.domain).toBe("www.shakirtter.com")
    expect(entry.crawl.baseUrl).toBe(HOST)
    // Cyrillic Kazakh, measured across all 17 articles: 189,052 Cyrillic vs 178
    // Latin characters (99.91% Cyrillic), with the nine letters that do not
    // exist in the Russian alphabet present in bulk (і ×13,546, қ ×6,079,
    // ң ×3,156, ғ ×2,818, ұ ×2,203, ө ×2,142, ә ×1,896, ү ×1,579, һ ×16) while
    // the common Russian function words что/это/как/для/они/был/есть/бог all
    // score ZERO word-bounded. Not Russian, and not a Latin-script edition.
    expect(entry.languages).toEqual(["kk"])
    // Probed 2026-07-30: ~80 plain-HTTP requests, bare Apache, no Cloudflare
    // header, no block page, no 429. Declaring a strategy would bill Firecrawl
    // for a wall that is not there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, not hand-listed seeds: the XML sitemap and the site's own
    // /m/kartasi.html list the SAME 17 articles, so there is no orphan to pin.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
  })

  it("keeps exactly the 17 articles out of the 25 real sitemap URLs", () => {
    const kept = SITEMAP.filter(keeps)
    expect(kept).toHaveLength(17)
    // Nothing outside the article namespace survives: no homepage, no /m/
    // section index, no contact page. With contentSelectors ["html"] the
    // container matches on those too, so each would extract its full teaser
    // list (262-1,379 chars) rather than nothing — the 250 floor cannot catch
    // a single one of them.
    for (const url of kept) expect(url.startsWith(`${HOST}/a/`)).toBe(true)
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(keeps(`${HOST}/m/kartasi.html`)).toBe(false)
  })

  it("blocks the contact page WITHOUT swallowing the article that shares its slug", () => {
    // /baylanis.html is the 411-char contact page; /a/baylanis.html is a real
    // 17,294-char article ("Құдаймен байланыс"). A block matching the bare
    // filename instead of the host root would silently delete the article.
    expect(keeps(`${HOST}/baylanis.html`)).toBe(false)
    expect(keeps(`${HOST}/a/baylanis.html`)).toBe(true)
  })

  it("honours the one robots.txt Disallow by URL, and drops the two dead /a/ links", () => {
    // robots.txt is `User-agent: * / Disallow: /a/fol.html`. The acquire path
    // does NOT enforce robots.txt, so the rule only holds if it is a URL block.
    // The page returns 200 and extracts 3,001 chars, and it matches
    // articleHints, so nothing else would exclude it.
    expect(keeps(`${HOST}/a/fol.html`)).toBe(false)
    // Both 404, and the 404 body extracts 505 chars — over the 250 floor — so
    // a "fixed" URL or a hand-added seed would stage an error page as an article.
    expect(keeps(`${HOST}/a/kim.html`)).toBe(false)
    expect(keeps(`${HOST}/a/sinayiomir.html`)).toBe(false)
    // The hint regex must not be narrowed to `[a-z0-9-]+`: a mixed-case or
    // Cyrillic slug added later has to keep matching.
    expect(keeps(`${HOST}/a/Qudai-Bar-Ma.html`)).toBe(true)
    expect(keeps(`${HOST}/a/%D2%9A%D2%B1%D0%B4%D0%B0%D0%B9.html`)).toBe(true)
  })

  it("extracts from `html` alone — the 0-char shadow selectors must never be listed", () => {
    const selectors = kk().crawl.contentSelectors
    // Measured 2026-07-30 over all 25 pages: `<html>` is the ONLY element that
    // contains an article (3,015-26,869 chars). A stray </sitelevel_noindex>
    // closes the content divs early and one extra </div> per page disposes of
    // <body>, leaving the prose as flat children of <html>.
    expect(selectors).toEqual(["html"])
    // extractContent binds the FIRST selector that MATCHES AN ELEMENT, not the
    // first that yields text. Each of these matches on 17/17 articles and
    // extracts 0 characters, so adding any of them — even "as a fallback" —
    // would skip every article as `too-thin` on an HTTP 200.
    for (const shadow of [
      ".content4",
      ".container2",
      ".contentpadding",
      "#content4",
    ]) {
      expect(selectors).not.toContain(shadow)
    }
  })

  it("strips the chrome measured on this host and omits the selectors with 0 instances", () => {
    const strip = kk().crawl.stripSelectors
    // Required because the container is <html>: without `head` every document
    // opens with a duplicate of its own <title> (616 chars over 17 pages).
    expect(strip).toContain("head")
    // A custom ELEMENT tag, not a class — 2 per page, removing exactly 1,313
    // chars on all 17: the cookie bar, top nav, share row, related links and
    // footer. The largest contributor by an order of magnitude.
    expect(strip).toContain("sitelevel_noindex")
    // The "FEATURE CLOSE" CTA cells — 84 instances, 2,062 chars.
    expect(strip).toContain(".fccell")
    // Measured 0 INSTANCES each on this host, so they can never bind. Carrying
    // them would misrepresent them as load-bearing; `.fctable` in particular is
    // absent because the CTA table carries no class here, only its cells do.
    for (const absent of [".fctable", ".shareiconsmenupg", ".relatedbottom"]) {
      expect(strip).not.toContain(absent)
    }
  })

  it("is a SEPARATE source key from everystudent and from the Cyrillic ru sibling (ADR-0006)", () => {
    // One domain = one source. shakirtter.com is its own domain, so the Kazakh
    // content must not be folded into `everystudent` as a second language, nor
    // confused with the other Cyrillic banner it shares a script with.
    const en = getSource("everystudent")!
    const ru = getSource("everystudent-ru")!
    expect(kk().key).toBe("everystudent-kk")
    expect(new Set([kk().domain, en.domain, ru.domain]).size).toBe(3)
    expect(ru.languages).toEqual(["ru"])
    expect(kk().languages).not.toEqual(ru.languages)
  })
})
