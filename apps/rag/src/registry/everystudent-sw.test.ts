/**
 * The `everystudent-sw` registry entry — EveryStudent's Swahili domain
 * (lipotumaini.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-am.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below pins a decision that took live measurement on 2026-07-30 to
 * reach, so a future edit cannot quietly undo it:
 *   - `.contentpadding` FIRST and the ABSENCE of `.content4` / `.content4b` —
 *     both match real elements here and extract 0 chars, so either would shadow
 *     the real container and ingest nothing;
 *   - the `"html"` LAST entry, which is the only thing recovering the two
 *     broken-markup articles;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - `/a/fol.html` blocked — it matches `articleHints`, so only the URL block
 *     catches this host's post-decision hand-off page;
 *   - the homepage, `/m/` indexes, site plan, about and contact pages, every one
 *     of which clears the 250-char floor except `/m/intl.html`, so
 *     `minContentLength` could never have excluded them.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const sw = (): SourceEntry => getSource("everystudent-sw")!
const HOST = "https://www.lipotumaini.com"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = sw().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-sw registry entry", () => {
  it("is an UNWALLED SWAHILI source on its own key, not a language of everystudent", () => {
    const entry = sw()
    // Apex 301s to www (both schemes, measured 2026-07-30) and every sitemap
    // <loc> uses www — pinning the bare apex would make every regex below miss.
    expect(entry.domain).toBe("www.lipotumaini.com")
    expect(entry.crawl.baseUrl).toBe(HOST)
    // Read on 2026-07-30, not inferred from <html lang>: the pages carry the
    // `ni` copula, the ki-/vi- and m-/wa- noun classes and the ku- infinitive
    // ("Mungu anakupenda na anakupa mpango mzuri sana wa maisha yako").
    expect(entry.languages).toEqual(["sw"])
    // Verified 2026-07-30: bare Apache, zero Cloudflare markers, 200 on every
    // page probed. Declaring a strategy would bill every page for an absent wall.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // ADR-0006: one domain = one source, the same rule that keeps thelife-fr
    // and thelife-zh separate from thelife.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(entry.domain)
    expect(entry.key).toBe("everystudent-sw")
    expect(entry.key).toMatch(/^[a-z0-9-]+$/)
  })

  it("binds .contentpadding FIRST, with html as the last-resort recovery", () => {
    const selectors = sw().crawl.contentSelectors
    // The single load-bearing measurement on this entry, taken over all 14 live
    // /a/ pages. `.contentpadding` matched 11/14 with ZERO empties (3,452-23,512
    // ch). `.content4` matched 11/14 and extracted 0 chars on every one;
    // `.content4b` matched exactly the 3 pages `.contentpadding` misses and
    // extracted 0 chars on all 3. extractContent scopes to the first selector
    // that MATCHES, not the first that yields text, so listing either as a
    // "fallback" would skip articles as `too-thin` on an HTTP 200 — silent, and
    // invisible to these tests. What must never change is the FIRST entry and
    // the absence of those two.
    expect(selectors).toEqual([".contentpadding", "html"])
    expect(selectors[0]).toBe(".contentpadding")
    expect(selectors).not.toContain(".content4")
    expect(selectors).not.toContain(".content4b")
    // "html" must stay LAST: there it can shadow nothing, and it is the only
    // thing recovering /a/kumjua.html (unclosed <span>) and
    // /a/utatu-mtakatifu.html (unclosed <sup>), whose .contentpadding element
    // does not survive parsing. Those two are genuine articles worth 6,436 and
    // 5,194 chars — ~15% of this 13-article source.
    expect(selectors.at(-1)).toBe("html")
  })

  it("is a DISCOVERY crawl over the one live sitemap, with no seeds to pin", () => {
    const entry = sw()
    // /sitemap.xml answered 200 (3,551 bytes, a flat <urlset>, 0 sitemapindex
    // elements, 21 <loc>, all distinct, all https, all live with 0 redirects).
    // /sitemap_index.xml is 404, so this is not the everystudent.sk fossil case.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    // The site's own /sitemap.html lists exactly the same 13 /a/ URLs the XML
    // does — 0 delta either way — and an href harvest across every fetched page
    // added only /a/fol.html (blocked) and /john.html (404). Nothing to pin.
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(entry.crawl.maxPages).toBeGreaterThan(21) // 21 sitemap URLs + headroom
  })

  it("keeps the 13 /a/ articles and drops the indexes, site plan, about, contact and homepage", () => {
    // Real articles, including the one that had to be judged against the
    // scripture policy: /a/biblia.html is "Kwa Nini Unaweza Kuamini Biblia", an
    // apologetics essay ABOUT the Bible (authorship, archaeology) at 23,390 ch —
    // argument, not quoted Bible text, and nowhere near the 98k-100k band the
    // sibling scripture pages sit in. No page on this host carries Scripture.
    expect(keeps(`${HOST}/a/biblia.html`)).toBe(true)
    expect(keeps(`${HOST}/a/kwa-nini-yesu-alikufa.html`)).toBe(true)
    expect(keeps(`${HOST}/a/kumjua.html`)).toBe(true) // broken markup, NOT blocked
    expect(keeps(`${HOST}/a/utatu-mtakatifu.html`)).toBe(true) // ditto
    // /a/fol.html MATCHES articleHints — only the block excludes it. 678 ch: the
    // post-decision "Kuanza na Mungu" page handing readers to KutembeaNaYesu.com.
    // Same slug and same call as the Amharic sibling's blocked /a/fol.html.
    expect(keeps(`${HOST}/a/fol.html`)).toBe(false)
    // Every one of these clears minContentLength except /m/intl.html (14 ch), so
    // the floor cannot be what excludes them: homepage 711 ch (no
    // .contentpadding -> `html` container returns the full teaser list), /m/
    // indexes 345-481 ch, /sitemap.html 526 ch, /kuhusu.html 883 ch,
    // /wasiliana.html 307 ch.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(keeps(`${HOST}/m/kuwepo.html`)).toBe(false)
    expect(keeps(`${HOST}/m/intl.html`)).toBe(false)
    expect(keeps(`${HOST}/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/kuhusu.html`)).toBe(false)
    expect(keeps(`${HOST}/wasiliana.html`)).toBe(false)
    // Off-domain never survives `allow`.
    expect(keeps("https://www.habeshastudent.com/a/biblia.html")).toBe(false)
  })

  it("pins the https scheme the sitemap actually emits, and does not assume lowercase-ASCII slugs", () => {
    // All 21 <loc> values are https (0 http). discover.ts filters the RAW <loc>
    // string without normalising, so a scheme mismatch would discover ZERO —
    // the everystudent.gr failure.
    expect(keeps(`${HOST}/a/imani.html`)).toBe(true)
    expect(keeps("http://www.lipotumaini.com/a/imani.html")).toBe(false)
    // This host's slugs are all lowercase ASCII today, but a `[a-z0-9-]+` hint
    // would silently drop a future mixed-case or percent-encoded slug, as
    // /a/pomoshch-ot-Boga.html elsewhere on the estate already proves.
    expect(keeps(`${HOST}/a/Mungu-ni-Nani.html`)).toBe(true)
    expect(keeps(`${HOST}/a/%C3%A9glise.html`)).toBe(true)
    // ...but the hint still stops at a single path segment.
    expect(keeps(`${HOST}/a/sub/dir.html`)).toBe(false)
  })

  it("strips the chrome that sits inside .contentpadding, and carries no selector that cannot bind", () => {
    const strip = sw().crawl.stripSelectors
    // The custom ELEMENT tag (no leading dot) — 2 instances on 14/14 pages and
    // the largest site-specific contributor at 2,774 chars: the share row and
    // the related-links/footer block.
    expect(strip).toContain("sitelevel_noindex")
    // The FEATURE CLOSE call-to-action: .fccell removes 1,612 ch, and .fctable
    // is 0 MARGINAL only because .fccell empties it first — on its own it is
    // 1,453 ch, so dropping .fccell would leave the table behind.
    expect(strip).toContain(".fccell")
    expect(strip).toContain(".fctable")
    // Required because the container is <html> on 3 pages: drops the duplicated
    // <title>. Safe only because extract.ts reads the title from `root`
    // (line 43) BEFORE this strip loop (line 52) — keep that order.
    expect(strip).toContain("head")
    // 0 instances on this host, so it can never bind. Listing it would be dead
    // config that reads as evidence of a strip that does not happen.
    expect(strip).not.toContain(".relatedbottom")
  })
})
