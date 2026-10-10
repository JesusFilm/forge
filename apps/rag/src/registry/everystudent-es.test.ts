/**
 * The `everystudent-es` registry entry — EveryStudent's Spanish domain
 * (cadaestudiante.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent.test.ts` / `everystudent-ar.test.ts` /
 * `everystudent-fr.test.ts`.
 *
 * Each guard encodes a decision reached by measuring the live site on
 * 2026-07-28, so a future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this sibling is unwalled, and declaring a
 *     strategy here would spend credits for nothing;
 *   - discovery mode, because the sitemap is reachable and free;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - `/audio/` and `/pdf/` excluded as measured near-duplicates of `/articulos/`;
 *   - the CTA + "COMPARTE ESTA PÁGINA" strip that keeps citations clean.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const es = (): SourceEntry => getSource("everystudent-es")!

/** Discovery keep-decision: allow ∧ articleHints ∧ ¬block. */
const kept = (url: string): boolean => {
  const { allow, articleHints, block } = es().crawl
  const any = (pats: string[] | undefined): boolean =>
    (pats ?? []).some((p) => new RegExp(p).test(url))
  return any(allow) && any(articleHints) && !any(block)
}

/** Does the `block` list alone reject this URL? */
const blocked = (url: string): boolean =>
  (es().crawl.block ?? []).some((p) => new RegExp(p).test(url))

describe("everystudent-es registry entry", () => {
  it("resolves everystudent-es as an UNWALLED Spanish discovery source on plain HTTP", () => {
    const entry = es()
    expect(entry.domain).toBe("www.cadaestudiante.com")
    expect(entry.languages).toEqual(["es"])
    expect(entry.trust).toBe("partner")
    expect(entry.ingestionMode).toBe("html-scrape")
    // The load-bearing fact: probed 2026-07-28, robots.txt, /sitemap.xml, the
    // homepage and 32 content pages all returned HTTP 200 with real HTML — no
    // Cloudflare block page. Unlike its three siblings this domain must NOT
    // declare a strategy; doing so would burn Firecrawl credits for nothing.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("crawls by DISCOVERY off /sitemap.xml, not a hand-listed seed set", () => {
    const crawl = es().crawl
    // The siblings hand-list only because their walls made discovery cost money.
    // Here the sitemap is reachable and plain-HTTP fetching is free (153 <loc>
    // entries counted 2026-07-28), so hand-listing would be pure maintenance debt.
    expect(crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(crawl.seedPaths).toBeUndefined()
    expect(crawl.baseUrl).toBe("https://www.cadaestudiante.com")
    expect(crawl.maxPages).toBeGreaterThanOrEqual(153) // sitemap size + headroom
    expect(crawl.minContentLength).toBe(250)
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. cadaestudiante.com is its own domain, so the
    // Spanish content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(es().domain)
    expect(es().key).toBe("everystudent-es")
    const domains = [
      "everystudent",
      "everystudent-ar",
      "everystudent-fr",
      "everystudent-es",
    ].map((k) => getSource(k)!.domain)
    expect(new Set(domains).size).toBe(4)
  })

  it("keeps /articulos/<slug>.html and drops the pdf/audio near-duplicates, menus and nav", () => {
    const b = "https://www.cadaestudiante.com"
    // Articles: mixed-case slugs with hyphens pass.
    expect(kept(`${b}/articulos/hayundios.html`)).toBe(true)
    expect(kept(`${b}/articulos/Dios.html`)).toBe(true)
    expect(kept(`${b}/articulos/ayuda-de-Dios.html`)).toBe(true)
    // `articleHints` still admits underscore slugs — but the only one this host
    // has is /articulos/biblia_juan.html, which is now blocked (below), so
    // there is no live example left to assert. Kept as a note, not a test.
    //
    // Scripture is excluded estate-wide (2026-07-29): biblia_juan.html is the
    // COMPLETE Gospel of John, 100,409 chars — verbatim Scripture on an article
    // URL, not ministry writing. Same policy as `everystudent-ar`'s
    // /bible/**.pdf, and siblings -sq, -et, -mn, -fa. It matches the article
    // hint, so ONLY a URL block excludes it; the row staged on 2026-07-28 was
    // deleted from raw_documents when the block landed.
    expect(blocked(`${b}/articulos/biblia_juan.html`)).toBe(true)
    // /audio/ pages are the same body wrapped in a player: measured 85.7% and
    // 83.5% 12-word-shingle overlap with their /articulos/ twin, and the one
    // page with no same-slug twin (intimidad) is 91.9% of /articulos/busqueda.
    // The document-level content hash cannot collapse duplicates at other URLs.
    expect(blocked(`${b}/audio/fe.html`)).toBe(true)
    expect(blocked(`${b}/audio/intimidad.html`)).toBe(true)
    expect(blocked(`${b}/audio/`)).toBe(true)
    // /pdf/ are print twins of the same articles, and this source is html-scrape.
    expect(blocked(`${b}/pdf/Hay1Dios.pdf`)).toBe(true)
    // Section indexes (incl. the sibling-language links page) and site nav.
    expect(blocked(`${b}/menu/preguntas.html`)).toBe(true)
    expect(blocked(`${b}/menu/intl.html`)).toBe(true)
    expect(blocked(`${b}/sitemap.html`)).toBe(true)
    expect(blocked(`${b}/promocion/`)).toBe(true)
    const nonArticles = [
      `${b}/audio/fe.html`,
      `${b}/pdf/Hay1Dios.pdf`,
      `${b}/menu/preguntas.html`,
      `${b}/`,
    ]
    for (const u of nonArticles) {
      expect(kept(u)).toBe(false)
    }
  })

  it("excludes the email-signup landing pages structurally, before the first fetch", () => {
    const b = "https://www.cadaestudiante.com"
    // /juan.html (1,630 ch) and /aventura.html (1,757 ch) are "Regístrate …
    // por email" sign-up pages — the Spanish counterparts of the /jean.html and
    // /aventure.html that slice #10 fetched, then dropped from everystudent-fr.
    // They clear minContentLength easily: length is not aboutness, so the floor
    // could never catch them. Blocked here so no fetch is ever made.
    expect(blocked(`${b}/juan.html`)).toBe(true)
    expect(blocked(`${b}/aventura.html`)).toBe(true)
    expect(blocked(`${b}/personal.html`)).toBe(true) // contact form
    expect(blocked(`${b}/acerca.html`)).toBe(true) // about + privacy
  })

  it("scopes to .contentpadding and never lets the empty .content4 spacer shadow it", () => {
    const crawl = es().crawl
    // Measured 2026-07-28 with the repo's own extractContent against live
    // pages: .contentpadding is the ONLY element on this host that extracts the
    // article (19,976 ch raw on /articulos/hayundios.html). .content4 exists but
    // is `<div class="content4"> </div>` — 0 chars — and .content4b is absent.
    // extractContent scopes to the first selector that MATCHES AN ELEMENT, not
    // the first that yields text, so any of those listed ahead of
    // .contentpadding silently extracts nothing and every page skips
    // `too-thin` on a 200. This assertion is the guard against that regression.
    // The MEASURED container must bind first. A trailing "html" (rule 1e) is
    // allowed and is what rescues pages whose container collapses — it can
    // shadow nothing, because nothing follows it. What must never appear is a
    // selector that matches at 0 chars ahead of the real one.
    expect(crawl.contentSelectors[0]).toBe(".contentpadding")
    expect(crawl.contentSelectors.at(-1)).toBe("html")
    expect(crawl.contentSelectors).not.toContain(".content4")
    expect(crawl.contentSelectors).not.toContain(".content4b")
    expect(crawl.contentSelectors).not.toContain(".articletitle")
  })

  it("strips the CTA and share chrome that survive inside .contentpadding", () => {
    const crawl = es().crawl
    // Re-measured 2026-07-28 inside .contentpadding: the FEATURE CLOSE CTA
    // table (6 instances / 185 ch on hayundios) and the trailing "COMPARTE ESTA
    // PÁGINA" share row (1 / 23 ch). The share row is site-specific here
    // because <sitelevel_noindex> closes after .contentpadding and so pops
    // early (#128) — only .shareiconsmenupg catches it. Together they let
    // articles end on their own last line.
    expect(crawl.stripSelectors).toContain(".fccell")
    expect(crawl.stripSelectors).toContain(".shareiconsmenupg")
    // A custom TAG, not a class — hence no leading dot, as in the siblings.
    // Measured 2 instances / 148 ch inside .contentpadding.
    expect(crawl.stripSelectors).toContain("sitelevel_noindex")
  })
})
