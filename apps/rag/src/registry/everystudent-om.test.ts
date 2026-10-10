/**
 * The `everystudent-om` registry entry — EveryStudent's Oromo domain
 * (everybarataa.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-am.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below pins a decision that took live measurement on 2026-07-30 to
 * reach, so a future edit cannot quietly undo it:
 *   - `contentSelectors` starting at `.contentpadding` and, critically, the
 *     ABSENCE of `.content4` — it matches 29 of 30 pages and extracts 0 chars on
 *     all 19 articles, so listing it would shadow the real container and ingest
 *     nothing;
 *   - `/a/whowas.html` blocked — 26,194 chars of abridged Gospel of John under a
 *     third-party Bible-edition credit, and it MATCHES `articleHints`, so only
 *     the URL block catches it;
 *   - `/a/fol.html` blocked — same shape, this host's twin of the
 *     `/aventure` · `/pack` starter-kit follow-up;
 *   - `[^/]+` in the article hint, because `/a/Godreal.html` is genuinely
 *     mixed-case and a lowercase class would drop a real article;
 *   - pure discovery with NO seeds, because the site's own HTML map lists exactly
 *     the same articles as the XML sitemap;
 *   - `om` (Oromo, Latin/Qubee script), a SEPARATE key from the Ge'ez-script
 *     Amharic sibling.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const om = (): SourceEntry => getSource("everystudent-om")!
const HOST = "https://www.everybarataa.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = om().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-om registry entry", () => {
  it("is an UNWALLED OROMO source on its own key, distinct from the Amharic sibling", () => {
    const entry = om()
    // Apex 301s to www (measured on /robots.txt, /sitemap.xml and an article),
    // and every sitemap <loc> is a www absolute URL. Pinning the wrong form
    // would make every regex below miss.
    expect(entry.domain).toBe("www.everybarataa.com")
    expect(entry.crawl.baseUrl).toBe(HOST)
    // Oromo, in Latin/Qubee script — read 2026-07-30 ("Waaqayyo jiraa?",
    // "gaa'ela", "dhugaa"; zero Ethiopic characters across all 19 articles).
    // Script alone separates it from habeshastudent.com (Amharic) and
    // everytemhari.com (Tigrinya), both of which are Ge'ez.
    expect(entry.languages).toEqual(["om"])
    expect(getSource("everystudent-am")!.languages).toEqual(["am"])
    expect(getSource("everystudent-am")!.domain).not.toBe(entry.domain)
    // Verified 2026-07-30: all 29 sitemap URLs returned HTTP/2 200 from bare
    // Apache with no Cloudflare block page. The Turnstile script on
    // /contact.html is a mail-form widget on a page that still serves 200 —
    // declaring a strategy would bill every page for a wall that isn't there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // ADR-0006: one domain = one source, the rule that keeps thelife-fr and
    // thelife-zh separate from thelife.
    expect(getSource("everystudent")!.languages).toEqual(["en"])
    expect(getSource("everystudent")!.domain).not.toBe(entry.domain)
    expect(entry.key).toMatch(/^[a-z0-9-]+$/)
  })

  it("binds .contentpadding FIRST — .content4 must never be listed", () => {
    const selectors = om().crawl.contentSelectors
    // The single load-bearing measurement on this entry. `.contentpadding`
    // matched 23/30 pages with ZERO empties and holds the whole article on all
    // 19 (2,397-26,099 chars post-strip). `.content4` matched 29/30 and
    // extracted 0 chars on all 19 articles — an empty spacer div. extractContent
    // scopes to the first selector that MATCHES, not the first that yields text,
    // so adding `.content4` (or any "fallback") would bind the spacer and skip
    // every article as `too-thin` on an HTTP 200: silent, and invisible to these
    // tests. `.post-content` is likewise excluded — it exists only on the
    // homepage (56 chars).
    expect(selectors[0]).toBe(".contentpadding")
    expect(selectors).not.toContain(".content4")
    expect(selectors).not.toContain("#content4")
    expect(selectors).not.toContain(".post-content")
    // `"html"` is a deliberate LAST entry: nothing follows it, so it cannot
    // shadow anything, and it beats extract.ts's implicit `?? root` because
    // <html> is a real element carrying no literal "<!DOCTYPE html>" text node.
    expect(selectors.at(-1)).toBe("html")
  })

  it("is a PURE discovery crawl with no seeds, because the two site maps agree", () => {
    const entry = om()
    // /sitemap.xml answered 200 (4,727 bytes, a flat <urlset>, 29 <loc>, all
    // distinct, all https, all live with 0 redirects). /sitemap_index.xml is a
    // 404, so there is no larger Yoast index hiding behind this one.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.allow?.length).toBeGreaterThan(0)
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    // The site's own /sitemap.html lists exactly the same 19 articles, and an
    // href harvest across all 29 pages found no article the XML map lacks — so
    // unlike everystudent-am there is nothing for seeds to rescue. A future edit
    // adding a seed should have to justify it against that measurement.
    expect(seedUrls(entry)).toEqual([])
    expect(entry.crawl.maxPages).toBeGreaterThan(29)
  })

  it("blocks the abridged Gospel of John and the follow-up tract, which BOTH match articleHints", () => {
    // Estate-wide scripture policy (2026-07-29). /a/whowas.html is 26,194 chars
    // of continuous biblical text under 16 "Yohannis <n>" chapter headings; its
    // own lede says the text is taken directly from the Bible with nothing
    // added, and it closes on "Macaafa Qulqulluu Afaan Oromoo isa haara irraa"
    // — a third-party Bible-edition credit this entry's `rights` line would
    // misattribute. It sits under /a/, so ONLY the block excludes it.
    expect(keeps(`${HOST}/a/whowas.html`)).toBe(false)
    // ...but an apologetics essay ABOUT the Bible stays. /a/isthere.html cites
    // "Tyndale Press" in a numbered bibliography; that is citation apparatus,
    // not Scripture, and it is the largest article we keep at 19,579 chars.
    expect(keeps(`${HOST}/a/isthere.html`)).toBe(true)
    // The post-decision follow-up tract, 3,867 chars, linked from 6 pages but in
    // NEITHER site map. This host's twin of /aventure · /pack · /abenteuerreise.
    // Also the one /a/ page with no .contentpadding, so the `html` fallback
    // would return the whole document.
    expect(keeps(`${HOST}/a/fol.html`)).toBe(false)
  })

  it("drops the indexes, site plan, about/contact and homepage — none of which the 250 floor could catch", () => {
    // Homepage 887 ch: no .contentpadding AND no <body>, so extraction falls
    // through to `html` and returns teaser headlines rather than nothing.
    expect(keeps(`${HOST}/`)).toBe(false)
    // Section indexes, 43-491 ch. /m/intl.html links out to the sibling
    // language domains, the same reason the English entry drops /menus/intl.html.
    expect(keeps(`${HOST}/m/knowing.html`)).toBe(false)
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false)
    expect(keeps(`${HOST}/sitemap.html`)).toBe(false) // 881 ch of link list
    expect(keeps(`${HOST}/about.html`)).toBe(false) // 990 ch of boilerplate
    expect(keeps(`${HOST}/contact.html`)).toBe(false) // 253 ch — 3 above the floor
    // Off-domain never survives `allow`; the bare apex is not the canonical host.
    expect(keeps("https://www.habeshastudent.com/a/isthere.html")).toBe(false)
  })

  it("accepts the mixed-case slug this host actually publishes", () => {
    // NOT hypothetical: /a/Godreal.html is a real sitemap URL with a capital G.
    // A `[a-z0-9-]+` article hint would silently drop it, the failure mixed-case
    // slugs elsewhere on this estate (/a/pomoshch-ot-Boga.html) already prove.
    expect(keeps(`${HOST}/a/Godreal.html`)).toBe(true)
    // ...but the hint still stops at a single path segment.
    expect(keeps(`${HOST}/a/sub/dir.html`)).toBe(false)
  })

  it("strips the chrome that sits inside .contentpadding on every article", () => {
    const strip = om().crawl.stripSelectors
    // The custom ELEMENT tag (no leading dot) — 2 instances on 18/18 articles,
    // the largest contributor at 111 chars solo: the share row ("FUULA KANA
    // NAMOOTA BIROOF ERGAA") and the footer contact/nav block.
    expect(strip).toContain("sitelevel_noindex")
    // The FEATURE CLOSE call-to-action. Both are required: .fccell still
    // measures up to 86 chars MARGINAL beyond .fctable, so dropping it leaves
    // stray cells, and dropping .fctable leaves the emptied shell.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // Paired with the `"html"` fallback: 0 chars whenever .contentpadding binds,
    // but it drops the duplicated <title> when the fallback fires. Safe because
    // extract.ts reads the title from `root` (line 43) before stripping (line 52).
    expect(strip).toContain("head")
    // A no-op today (0 marginal — sitelevel_noindex is well-formed here and
    // already contains it) kept only as a drift guard. Not evidence it strips.
    expect(strip).toContain(".shareiconsmenupg")
  })
})
