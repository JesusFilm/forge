/**
 * The `everystudent-zh-cn` registry entry — EveryStudent's Simplified-Chinese
 * domain (xinshengming.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent-fr.test.ts` / `everystudent-ar.test.ts`.
 *
 * Each guard below pins a decision that is costly to undo silently, and the
 * first two are the load-bearing ones:
 *   - this domain is a TEMPLATE OUTLIER — it does NOT use the shared `.content4`
 *     EveryStudent template, so a well-meaning "consistency" edit that
 *     harmonises its selectors with its siblings would break extraction
 *     completely (the shared selectors bind nothing here, and `extract.ts`
 *     silently falls through to `<body>`);
 *   - it is UNWALLED, unlike the three Firecrawl siblings, so plain HTTP is
 *     correct and `fetchStrategy` must stay absent;
 *   - discovery mode, because /sitemap.xml is reachable and free;
 *   - `["zh"]`, not `["zh-cn"]` — the code content detection actually emits;
 *   - the three measured URL traps (a 301 alias and two index pages).
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const zh = (): SourceEntry => getSource("everystudent-zh-cn")!

describe("everystudent-zh-cn registry entry", () => {
  it("resolves as an UNWALLED, discovery-mode Simplified-Chinese source", () => {
    const entry = zh()
    expect(entry.key).toBe("everystudent-zh-cn")
    expect(entry.domain).toBe("www.xinshengming.com")
    // Probed 2026-07-28: 15 page GETs + a HEAD sweep of all 132 article URLs
    // returned 131x200 and 1x301 — no 403, no Cloudflare block page, and
    // /sitemap.xml answers plain HTTP. Unlike its three walled siblings this
    // source must NOT pay Firecrawl.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, not hand-listed seeds: the sitemap is reachable and free.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
  })

  it("declares ['zh'] — the ISO 639-1 code detection emits, NOT 'zh-cn'", () => {
    // The Simplified/Traditional distinction is carried by the key, the name and
    // the docstring. `languages` is the declared/expected set cross-checked
    // against per-document detection (ADR-0006), and that detector emits bare
    // `zh` — declaring "zh-cn" here would never match anything it produces.
    expect(zh().languages).toEqual(["zh"])
    expect(zh().name).toMatch(/Simplified/)
    // Colliding label, flagged not solved: thelife-zh declares the same code.
    expect(getSource("thelife-zh")!.languages).toEqual(["zh"])
  })

  it("does NOT use the shared .content4 EveryStudent template", () => {
    // ⚠️ THE GUARD THIS FILE EXISTS FOR. Verified 2026-07-28 across 13 fetched
    // article pages: `content4`, `content4b`, `articletitle`, `contentpadding`,
    // `sitelevel_noindex`, `fccell` and `relatedbottom` occur ZERO times in this
    // host's HTML — it is WordPress on a `cb-`-prefixed theme, not the legacy
    // hand-rolled template the other banners share. Adding the sibling
    // selectors back "for consistency" would make extraction fall through to
    // <body> and ingest the whole nav + footer as article text.
    const { contentSelectors, stripSelectors } = zh().crawl
    const sharedTemplate = [
      ".content4",
      ".content4b",
      ".articletitle",
      ".contentpadding",
    ]
    for (const dead of sharedTemplate) {
      expect(contentSelectors).not.toContain(dead)
    }
    for (const dead of ["sitelevel_noindex", ".fccell", ".relatedbottom"]) {
      expect(stripSelectors).not.toContain(dead)
    }
    // ...and the English banner really does use that template, so the two
    // entries are genuinely divergent rather than both being unconfigured.
    const en = getSource("everystudent")!
    expect(en.crawl.contentSelectors).toContain(".content4")
  })

  it("binds the WordPress container measured on every sampled page", () => {
    const { contentSelectors, stripSelectors } = zh().crawl
    // <section class="cb-entry-content" itemprop="articleBody"> — present
    // exactly once on all 13 sampled article pages, and absent on the /m/
    // section-index pages, so the selector itself discriminates articles from
    // listings. First-match-wins, so it must lead the chain.
    expect(contentSelectors[0]).toBe(".cb-entry-content")
    expect(contentSelectors).toEqual([
      ".cb-entry-content",
      "article.hentry",
      "#cb-content",
    ])
    // This site's own chrome, found in its markup — not copied from a sibling.
    expect(stripSelectors).toContain(".a2a_kit") // Weibo/WeChat/QZone share kit
    expect(stripSelectors).toContain(".sectionlink") // trailing CTA block
    // Deliberately NOT stripped: despite the name these hold inline figure
    // captions (real body text), e.g. "计算机编程:" / "DNA代码:" on /a/godreal.
    expect(stripSelectors).not.toContain(".sitemapleft")
    expect(stripSelectors).not.toContain(".sitemapright")
  })

  it("keeps both content sections and blocks the three measured URL traps", () => {
    const { articleHints, block } = zh().crawl
    const hits = (url: string, pats: string[] | undefined) =>
      (pats ?? []).some((p) => new RegExp(p).test(url))
    const u = (path: string) => `https://www.xinshengming.com${path}`

    // 94 /a/ articles + 38 /john/ study lessons are the content set.
    expect(hits(u("/a/exist.html"), articleHints)).toBe(true)
    expect(hits(u("/john/john1.html"), articleHints)).toBe(true)
    // /m/* are card-listing section indexes — nav, and they carry no
    // .cb-entry-content at all.
    expect(hits(u("/m/existence.html"), articleHints)).toBe(false)
    expect(hits(u("/m/existence.html"), block)).toBe(true)

    // The three traps, each measured rather than guessed:
    // /a/john.html is the only 301 in the article set → /john/john1.html, which
    // the sitemap also lists; identical bytes at two URLs.
    expect(hits(u("/a/john.html"), block)).toBe(true)
    // /a/fanxuede0.html is an excerpt index (9 "(…)" teasers) for fanxuede1-9.
    expect(hits(u("/a/fanxuede0.html"), block)).toBe(true)
    // /john/john0.html is the series' 目录 (table of contents).
    expect(hits(u("/john/john0.html"), block)).toBe(true)
    // ...but the real chapters and lessons behind those indexes are kept.
    const kept = ["/a/fanxuede1.html", "/john/john1.html", "/a/pack1.html"]
    for (const keep of kept) {
      expect(hits(u(keep), articleHints)).toBe(true)
      expect(hits(u(keep), block)).toBe(false)
    }
  })

  it("is a SEPARATE source key from everystudent and thelife-zh (ADR-0006)", () => {
    // One domain = one source. xinshengming.com is its own domain, so the
    // Simplified-Chinese content is neither a second language of `everystudent`
    // nor part of the other zh source — even though it shares the `zh` label
    // with thelife-zh and the EveryStudent banner with everystudent.
    const en = getSource("everystudent")!
    const tlzh = getSource("thelife-zh")!
    expect(new Set([zh().domain, en.domain, tlzh.domain]).size).toBe(3)
    expect(en.languages).toEqual(["en"])
    // Sibling tag convention preserved, with the zh language tag.
    expect(zh().defaultTags).toEqual([
      "everystudent",
      "cru",
      "topic:seeker",
      "lang:zh",
    ])
    expect(zh().trust).toBe("partner")
    expect(zh().ingestionMode).toBe("html-scrape")
    expect(zh().defaultCategory).toBe("article")
    // 146 sitemap URLs (129 kept after filters) + headroom.
    expect(zh().crawl.maxPages).toBeGreaterThanOrEqual(146)
  })
})
