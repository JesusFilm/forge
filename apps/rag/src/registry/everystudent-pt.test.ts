/**
 * The `everystudent-pt` registry entry — EveryStudent's Brazilian-Portuguese
 * domain (suaescolha.com). Split out of `registry.test.ts` (the §5.5 300-line
 * cap), following `everystudent.test.ts` / `everystudent-fr.test.ts`.
 *
 * Each guard below encodes a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this is the one EveryStudent sibling that is
 *     not walled, and adding a `fetchStrategy` would start billing per page for
 *     nothing;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - discovery mode, because the sitemap is free to fetch;
 *   - the 13 pinned articles that cover the stale sitemap's 17% blind spot —
 *     the single most silently-losable fact in this entry;
 *   - the measured content selectors and the share/CTA chrome strip.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const pt = (): SourceEntry => getSource("everystudent-pt")!

/** Applies the entry's own allow/block/articleHints to a URL, as discover.ts does. */
const keeps = (url: string): boolean => {
  const { allow, block, articleHints } = pt().crawl
  const hit = (ps: string[] | undefined) =>
    (ps ?? []).some((p) => new RegExp(p).test(url))
  return hit(allow) && !hit(block) && hit(articleHints)
}

describe("everystudent-pt registry entry", () => {
  it("is an UNWALLED, plain-HTTP, discovery-mode Portuguese source", () => {
    const entry = pt()
    expect(entry.domain).toBe("www.suaescolha.com")
    expect(entry.languages).toEqual(["pt"])
    // The load-bearing fact: verified 2026-07-28, all 33 plain-curl probes
    // (robots, sitemap, 27 articles, 6 nav pages) returned HTTP 200 with real
    // content — Cloudflare fronts the host but serves normally. Declaring a
    // fetchStrategy here would bill every page through Firecrawl for nothing.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, not a hand-listed inventory: /sitemap.xml is free to fetch,
    // unlike on all three walled siblings.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. suaescolha.com is its own domain, so the
    // Portuguese content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(pt().domain)
    expect(pt().key).toBe("everystudent-pt")
  })

  it("pins the 13 articles the stale 2021-12-24 sitemap omits", () => {
    const seeds = pt().crawl.seedPaths!
    // The sitemap is a one-off xml-sitemaps.com run: every <lastmod> reads
    // 2021-12-24 and it lists 62 /a/ articles, while the site's own /mapa.html
    // links 75. Discovery ALONE would silently miss 17% of the corpus, so these
    // 13 are pinned — acquire.ts unions seedPaths with the discovered set.
    // Deleting them would lose a sixth of the source with no error anywhere.
    expect(seeds).toHaveLength(13)
    expect(new Set(seeds).size).toBe(13)
    for (const p of seeds) expect(p).toMatch(/^\/a\/[^/]+\.html$/)
    // Verified individually as HTTP 200 with the full article template.
    expect(seeds).toContain("/a/casamento.html")
    expect(seeds).toContain("/a/video-conhecendo-a-Deus.html")
  })

  it("keeps only the flat /a/ article directory and drops every nav page", () => {
    // Measured against the real sitemap 2026-07-28: these filters keep exactly
    // the 62 /a/ URLs and drop all 12 others.
    for (const u of [
      "https://www.suaescolha.com/a/deusexiste.html",
      "https://www.suaescolha.com/a/reencarnacao2.html",
    ]) {
      expect(keeps(u)).toBe(true)
    }
    for (const u of [
      "https://www.suaescolha.com/", // homepage
      "https://www.suaescolha.com/m/faq.html", // menu section index
      "https://www.suaescolha.com/m/intl.html", // links out to the sibling domains
      "https://www.suaescolha.com/mapa.html", // "Mapa do site" — the /sitemap.html twin
      "https://www.suaescolha.com/sobre.html", // about + privacy policy
      "https://www.suaescolha.com/contato.html", // contact form
      "https://www.suaescolha.com/promocion/", // "Promova este site"
      // The Gospel-of-John email-signup landing page: the exact twin of the
      // French /jean.html that slice #10 paid to fetch and then dropped at
      // Stage 1 as a signup form, not an article. Blocked up front here.
      "https://www.suaescolha.com/joao.html",
    ]) {
      expect(keeps(u)).toBe(false)
    }
  })

  it("scopes to .contentpadding and never lets the empty .content4 spacer shadow it", () => {
    const { contentSelectors } = pt().crawl
    // Measured 2026-07-28 with the repo's own extractContent against live
    // pages: .contentpadding is the ONLY element on this host that extracts the
    // article (19,147 ch raw on /a/deusexiste.html, 9,604 on
    // /a/coronavirus.html). .content4 exists but is an empty spacer div — 0
    // chars — and .content4b is absent. extractContent scopes to the first
    // selector that MATCHES AN ELEMENT, not the first that yields text, so
    // either of those listed ahead of .contentpadding silently extracts nothing
    // and every page skips `too-thin` on a 200. This is the guard against that.
    // The MEASURED container must bind first. A trailing "html" (rule 1e) is
    // allowed and is what rescues pages whose container collapses — it can
    // shadow nothing, because nothing follows it. What must never appear is a
    // selector that matches at 0 chars ahead of the real one.
    expect(contentSelectors[0]).toBe(".contentpadding")
    expect(contentSelectors.at(-1)).toBe("html")
    expect(contentSelectors).not.toContain(".content4")
    expect(contentSelectors).not.toContain(".content4b")
    expect(contentSelectors).not.toContain(".articletitle")
  })

  it("strips the share/CTA chrome so citations stay clean", () => {
    const strip = pt().crawl.stripSelectors
    // sitelevel_noindex is a custom ELEMENT here (2 instances / 154 ch inside
    // .contentpadding) whose nesting is malformed — it opens inside
    // .contentpadding and closes only after .contentpadding does, so the parser
    // pops it early and it does NOT contain the share block (#128).
    expect(strip).toContain("sitelevel_noindex")
    // …which is why .shareiconsmenupg is load-bearing: it is the div that
    // actually holds "COMPARTILHE ESTA PÁGINA:" and the share icons (1 instance,
    // 26 ch), and the only selector that removes them.
    expect(strip).toContain(".shareiconsmenupg")
    // The "FEATURE CLOSE" CTA table — 6 cells / 186 ch on /a/deusexiste.html,
    // 4 / 66 on /a/coronavirus.html.
    expect(strip).toContain(".fccell")
  })
})
