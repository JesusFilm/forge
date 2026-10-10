/**
 * The `everystudent-cs` registry entry — EveryStudent's Czech domain
 * (everystudent.cz). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-zh-cn.test.ts` / `everystudent-fr.test.ts`.
 *
 * Each guard below pins a decision that is costly to undo SILENTLY, because
 * every failure mode here is an HTTP 200 that quietly ingests the wrong text:
 *   - this domain is a TEMPLATE OUTLIER (a bespoke Yii PHP app, not the shared
 *     `.content4` template and not WordPress), so a "normalise the siblings"
 *     sweep would bind nothing and `extract.ts` would fall through to `<body>`;
 *   - exactly ONE `contentSelector`, because the field is first-match-wins and
 *     the obvious runner-up (`.textDetail`) binds a 31-char sidebar widget;
 *   - the nav indexes and the seven-email signup must be blocked BY URL — they
 *     extract 189-2,842 chars and sail past `minContentLength`;
 *   - the article slug is decorative, so two sitemap URLs are exact duplicates;
 *   - 17 articles the 2018 sitemap omits are pinned, and the one Slovak-bodied
 *     page on the host is deliberately not.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const cs = (): SourceEntry => getSource("everystudent-cs")!

/** Apply the entry's own discovery filters to a URL, as discover.ts does. */
function keeps(url: string): boolean {
  const { allow, block, articleHints } = cs().crawl
  const any = (rs?: string[]) => (rs ?? []).some((r) => new RegExp(r).test(url))
  return any(allow) && any(articleHints) && !any(block)
}

describe("everystudent-cs registry entry", () => {
  it("resolves as an UNWALLED, discovery-mode Czech source", () => {
    const entry = cs()
    expect(entry.key).toBe("everystudent-cs")
    expect(entry.domain).toBe("www.everystudent.cz")
    // Czech, read directly 2026-07-29 ("Někdy to vypadá, jako by se všechno
    // v životě spiklo proti tomu, abychom mohli mít klid."). NOT Slovak —
    // everystudent.sk is a separate sibling domain, and the Czech-only letters
    // ř/ě/ů appear on 73 of 73 pages ≥250 chars.
    expect(entry.languages).toEqual(["cs"])
    // Verified 2026-07-29: 117 GETs all returned 200, no 403 and no Cloudflare
    // block page, and /sitemap.xml answers plain HTTP. Unlike the three walled
    // banners this source must never pay Firecrawl.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.articleHints).toHaveLength(1)
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source = one crawl job. everystudent.cz is its own
    // domain, so the Czech content must not be folded into `everystudent` as a
    // second language — the same rule that keeps everystudent-fr / -zh-cn apart.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(cs().domain)
    const keys = [
      "everystudent",
      "everystudent-fr",
      "everystudent-zh-cn",
      "everystudent-cs",
    ]
    const domains = keys.map((k) => getSource(k)!.domain)
    expect(new Set(domains).size).toBe(keys.length)
  })

  it("does NOT carry the shared EveryStudent template selectors", () => {
    // ⚠️ THE GUARD THIS FILE EXISTS FOR. Verified 2026-07-29 across all 97
    // sitemap pages plus 20 off-sitemap pages: none of these occurs even once
    // in this host's HTML. It is a bespoke Yii PHP app (nginx/PHPSESSID, Yii
    // CListView widgets, /index.php/stranka/<id> routes) — a third generator,
    // distinct from both the legacy shared template and zh-cn's WordPress.
    // Re-adding these "for consistency" would make extract.ts fall through to
    // <body> and ingest the whole nav + footer as article text.
    const { contentSelectors, stripSelectors } = cs().crawl
    for (const dead of [
      ".content4",
      ".content4b",
      ".articletitle",
      ".contentpadding",
    ]) {
      expect(contentSelectors).not.toContain(dead)
    }
    for (const dead of [
      "sitelevel_noindex",
      ".fccell",
      ".fctable",
      ".hr2",
      ".articledivider",
      ".relatedbottom",
      ".shareiconsmenupg",
    ]) {
      expect(stripSelectors).not.toContain(dead)
    }
    // ...and the English banner really does use that template, so the two
    // entries are genuinely divergent rather than both being unconfigured.
    const en = getSource("everystudent")!
    expect(en.crawl.contentSelectors).toContain(".content4")
  })

  it("binds exactly ONE measured content selector, with the measured strip list", () => {
    const { contentSelectors, stripSelectors } = cs().crawl
    // `contentSelectors` is FIRST-MATCH-WINS, not a fallback chain: extract.ts
    // binds the first selector matching an ELEMENT and stops, even at 0 chars.
    // `.content` matched exactly once on 117/117 pages (12,420 / 21,083 / 2,705
    // ch on sampled articles). The runner-up `.textDetail` is a trap — its
    // sidebar twin ("Napiš otázku - dostaneš odpověď", 31 ch) comes first in
    // document order on the 26 empty pages.
    expect(contentSelectors).toEqual([".content"])
    // Each of these was measured removing text from INSIDE .content across the
    // 85 /in/ pages; together they make .content extract byte-identically to
    // the pure article body on 59 of 59 real articles.
    for (const chrome of [
      ".breadCrumb",
      ".listing",
      ".shareButs",
      ".backFromLong",
      ".keys",
    ]) {
      expect(stripSelectors).toContain(chrome)
    }
    // NOT stripped, on measurement: an unclosed <div> makes .articleimageright
    // wrap 7,916 chars of body text on /in/36 — stripping it deletes an
    // article. .a2a_kit / .addthissidebar sit in the <aside>, never inside
    // .content, so they would be unmeasured dead config.
    expect(stripSelectors).not.toContain(".articleimageright")
    expect(stripSelectors).not.toContain(".a2a_kit")
  })

  it("blocks the homepage, the nav indexes and the seven-email signup BY URL", () => {
    // These are NOT caught by minContentLength: when no contentSelector matches
    // extract.ts falls back to <body>, and here .content matches anyway, so the
    // nav pages extract 189-2,842 chars — well over the 250 floor.
    for (const nav of [
      "https://www.everystudent.cz/",
      "https://www.everystudent.cz/1/existence",
      "https://www.everystudent.cz/7/o_nas",
      "https://www.everystudent.cz/24/mapa_stranek", // the HTML site map
      "https://www.everystudent.cz/25/jine_jazyky", // links to sibling domains
      "https://www.everystudent.cz/08/kontakt", // leading-zero twin of /8/
    ]) {
      expect(keeps(nav)).toBe(false)
    }
    // "Cesta k Bohu" — 1,233 ch of signup copy for a SEVEN-EMAIL series ("série
    // sedmi zamyšlení ... jako sedm e-mailů"). This host's analogue of the
    // French /aventure.html and Arabic /pack.html.
    expect(keeps("https://www.everystudent.cz/22/cesta_k_bohu")).toBe(false)
    expect(cs().crawl.block).toContain(
      "^https://www\\.everystudent\\.cz/22/cesta_k_bohu/?$",
    )
    // Real articles still survive the filters.
    expect(keeps("https://www.everystudent.cz/in/13/existuje_buh")).toBe(true)
    expect(keeps("https://www.everystudent.cz/in/59/je_jezis_buh")).toBe(true)
  })

  it("drops the decorative-slug duplicates and pins the 17 articles the sitemap omits", () => {
    // The slug is decorative — /in/13/naprosty_nesmysl_slug (invented) returns
    // text byte-identical to /in/13/existuje_buh. The sitemap lists ids 18 and
    // 64 twice under different slugs; the variant the site links to most is
    // kept, the other blocked, so one id never lands as two documents.
    const host = "https://www.everystudent.cz"
    expect(keeps(`${host}/in/64/kdyby_slo_poznat_boha_osobne___`)).toBe(true)
    expect(keeps(`${host}/in/64/poznat_boha_osobne`)).toBe(false)
    const nic = `${host}/in/18/bylo_nekdy_nic`
    expect(keeps(`${nic}_uvahy_o_pocatku_vesmiru_i`)).toBe(true)
    expect(keeps(`${nic}__uvahy_o_pocatku_vesmiru_i`)).toBe(false)
    // The 2018 sitemap omits the whole /19/zivot_s_bohem section. All 17 were
    // fetched 2026-07-29 (200, 621-7,695 ch, Czech, no duplicate of any sitemap
    // document); acquire.ts unions seeds with discovered URLs.
    const seeds = cs().crawl.seedPaths!
    expect(seeds).toHaveLength(17)
    expect(new Set(seeds).size).toBe(17)
    for (const p of seeds) expect(p).toMatch(/^\/in\/\d+\/[^/]+$/)
    // ⚠️ Deliberately NOT seeded: off-sitemap and its BODY IS SLOVAK ("Prinášame
    // ti spoľahlivý spôsob, ako prekonať úzkosť...") under a Czech headline —
    // 97 of the 99 Slovak-only letters on the whole host are on this one page.
    expect(seeds).not.toContain("/in/163/koronavirus_jak_prekonat_strach")
  })
})
