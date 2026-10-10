/**
 * The `everystudent-ro` registry entry — EveryStudent's Romanian domain
 * (everystudent.ro). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-fr.test.ts` / `everystudent-ar.test.ts`.
 *
 * Each guard below encodes a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this banner is the un-walled EveryStudent;
 *   - discovery mode, because the sitemap is public and free;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - `/v/` video-transcript pages are IN scope, `/m/` and `/ioan.html` are not;
 *   - `.shareiconsmenupg`, which `sitelevel_noindex` does not cover on this host.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const ro = (): SourceEntry => getSource("everystudent-ro")!

describe("everystudent-ro registry entry", () => {
  it("is an UNWALLED Romanian source fetched over plain HTTP", () => {
    const entry = ro()
    expect(entry.domain).toBe("www.everystudent.ro")
    expect(entry.languages).toEqual(["ro"])
    // Verified 2026-07-28: robots.txt, /sitemap.xml, the homepage and every
    // article probed all returned 200 to plain curl, with no Cloudflare block
    // page. Unlike its three walled siblings this source costs nothing per
    // page, so `fetchStrategy` must stay absent (= the plain-http default).
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. everystudent.ro is its own domain, so the
    // Romanian content must not be folded into `everystudent` as a second
    // language — the same rule that keeps thelife-fr / thelife-zh separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(ro().domain)
    expect(ro().key).toBe("everystudent-ro")
  })

  it("crawls by DISCOVERY off the public sitemap, not a hand-listed seed set", () => {
    const crawl = ro().crawl
    // The walled siblings hand-list because their /sitemap.xml is 403 and
    // re-enumeration burns Firecrawl credits. Neither is true here: the sitemap
    // is public (102 URLs, verified 2026-07-28) and free, so discovery picks up
    // new articles without an entry edit. Precedent: thelife-fr.
    expect(crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(crawl.seedPaths).toBeUndefined()
    expect(crawl.allow?.length).toBeGreaterThan(0)
  })

  it("keeps /a/ articles and /v/ video transcripts as the article set", () => {
    const { articleHints, block } = ro().crawl
    const keeps = (url: string) =>
      articleHints!.some((r) => new RegExp(r).test(url)) &&
      !block!.some((r) => new RegExp(r).test(url))
    // 4 of the 5 /v/ pages carry a real Romanian transcript (1,619-6,644 chars
    // measured); the English sibling seeds /videos/collins.html, the very same
    // Francis Collins piece that lives here at /v/collins.html. Dropping /v/
    // would silently lose that content.
    expect(keeps("https://www.everystudent.ro/a/exista.html")).toBe(true)
    expect(keeps("https://www.everystudent.ro/v/collins.html")).toBe(true)
    // Nothing outside /a/ and /v/ is an article on this host.
    for (const url of [
      "https://www.everystudent.ro/m/intrebari.html",
      "https://www.everystudent.ro/sitemap.html",
      "https://www.everystudent.ro/contact.html",
      "https://www.everystudent.ro/ioan.html",
      "https://www.everystudent.ro/",
    ])
      expect(keeps(url)).toBe(false)
  })

  it("blocks nav, link indexes, contact chrome and the email-signup page by URL", () => {
    // Asserted against `block` DIRECTLY, not via articleHints: these URLs already
    // fail the /a/ + /v/ hints, so a keeps() check alone would still pass with an
    // empty block list. The explicit block is the documented decision.
    const block = ro().crawl.block!
    const blocked = (url: string) => block.some((r) => new RegExp(r).test(url))
    // /m/* are the mobile/menu section indexes — navigation, not articles.
    expect(blocked("https://www.everystudent.ro/m/intrebari.html")).toBe(true)
    expect(blocked("https://www.everystudent.ro/m/intl.html")).toBe(true)
    // "Harta site-ului" link index + the "Întreabă-ne" contact form.
    expect(blocked("https://www.everystudent.ro/sitemap.html")).toBe(true)
    expect(blocked("https://www.everystudent.ro/contact.html")).toBe(true)
    // /ioan.html is the Gospel-of-John email-signup landing page — the Romanian
    // twin of the French /jean.html dropped at slice #10. It extracts 1,550
    // chars, so it clears minContentLength: only a URL block catches it.
    expect(blocked("https://www.everystudent.ro/ioan.html")).toBe(true)
    expect(blocked("https://www.everystudent.ro/")).toBe(true)
    // ...and the block list must not swallow real articles.
    expect(blocked("https://www.everystudent.ro/a/exista.html")).toBe(false)
    expect(blocked("https://www.everystudent.ro/v/collins.html")).toBe(false)
  })

  it("scopes to .contentpadding and never lets the empty .content4 spacer shadow it", () => {
    // Measured 2026-07-28 with the repo's own extractContent against live
    // pages: .contentpadding is the ONLY element on this host that extracts the
    // article (20,511 ch raw on /a/exista.html, 3,782 on /a/scop.html).
    // .content4 exists but is an empty spacer div — 0 chars — and .content4b is
    // absent. extractContent scopes to the first selector that MATCHES AN
    // ELEMENT, not the first that yields text, so either of those listed ahead
    // of .contentpadding silently extracts nothing and every page skips
    // `too-thin` on a 200. This is the guard against that regression.
    // The MEASURED container must bind first. A trailing "html" (rule 1e) is
    // allowed and is what rescues pages whose container collapses — it can
    // shadow nothing, because nothing follows it. What must never appear is a
    // selector that matches at 0 chars ahead of the real one.
    expect(ro().crawl.contentSelectors[0]).toBe(".contentpadding")
    expect(ro().crawl.contentSelectors.at(-1)).toBe("html")
    expect(ro().crawl.contentSelectors).not.toContain(".content4")
    expect(ro().crawl.contentSelectors).not.toContain(".content4b")
    expect(ro().crawl.contentSelectors).not.toContain(".articletitle")
  })

  it("strips the share widget that sitelevel_noindex does NOT cover on this host", () => {
    const strip = ro().crawl.stripSelectors
    for (const s of ["sitelevel_noindex", ".fccell", ".hr2", ".articledivider"])
      expect(strip).toContain(s)
    // The load-bearing addition (1 instance, 8 ch). This host's markup overlaps:
    // <sitelevel_noindex> opens inside .contentpadding but closes only after
    // .contentpadding does, so a conforming parser pops it early and leaves
    // .shareiconsmenupg as a direct child of the container (#128). Without this
    // every extracted body ended in a dangling "SHARE:".
    expect(strip).toContain(".shareiconsmenupg")
  })

  it("hard-blocks the 25 dead /a/ URLs that 301 to the homepage", () => {
    const block = ro().crawl.block!
    const blocked = (url: string) => block.some((r) => new RegExp(r).test(url))
    // These are NOT self-policing, which is how they first shipped. The homepage
    // they redirect to matches no contentSelector, so extractContent falls back
    // to <body> (extract.ts:50) and returns its 842-char teaser list — well over
    // the 250 floor. The ingest dedup gate keys on (sourceKey, canonicalUrl), so
    // 25 distinct URLs do not collapse: the unblocked 2026-07-28 acquire run
    // staged 25 byte-identical copies of that nav page. Only a URL block works.
    const dead = [
      "adam",
      "apostolii",
      "asemanare",
      "astazi",
      "cale",
      "care",
      "ceva",
      "cine",
      "cine2",
      "coronavirus",
      "fericire",
      "iad",
      "inchinare",
      "inspirata",
      "intamplare",
      "iubitor",
      "miracole",
      "nimic",
      "ofera",
      "raul2",
      "religiile",
      "rezultat",
      "sex",
      "sex2",
      "suferinta",
    ]
    expect(dead).toHaveLength(25)
    for (const slug of dead)
      expect(blocked(`https://www.everystudent.ro/a/${slug}.html`)).toBe(true)
    // Near-miss slugs that ARE live (confirmed in the 2026-07-28 acquire run)
    // must survive the alternation — note each one shadows a dead slug above:
    // adam2/adam, miracol/miracole, cineeste/cine, raul/raul2.
    for (const slug of [
      "adam2",
      "miracol",
      "cineeste",
      "raul",
      "exista",
      "scop",
    ])
      expect(blocked(`https://www.everystudent.ro/a/${slug}.html`)).toBe(false)
  })

  it("caps maxPages above the sitemap size and keeps the 250-char floor", () => {
    const crawl = ro().crawl
    expect(crawl.maxPages).toBeGreaterThan(102) // 102 sitemap URLs + headroom
    // The floor still does real work on live-but-empty pages:
    // /v/filmuliisus.html is a bare video embed with no transcript (53 chars).
    expect(crawl.minContentLength).toBe(250)
  })
})
