/**
 * The `everystudent-hr` registry entry — EveryStudent's Croatian domain
 * (vrlovazno.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-sr.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below encodes a decision that took live measurement to reach, so a
 * future edit cannot quietly undo it:
 *   - plain HTTP, NOT Firecrawl — this host is not walled, and the Cloudflare
 *     Turnstile script on two form pages is a CAPTCHA, not a bot wall;
 *   - a SEPARATE key from `everystudent` AND from the Serbian neighbour, whose
 *     text overlaps this host's by under 1%;
 *   - `.contentpadding` alone, because `.content4` matches 39 of the 41 articles
 *     and extracts 0 chars on every one of them;
 *   - the URL blocks for the two email-series signups and the `/a/` form page,
 *     none of which minContentLength can catch;
 *   - the share/CTA chrome strip that keeps citations clean.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const hr = (): SourceEntry => getSource("everystudent-hr")!

/** Applies the entry's own allow/block/articleHints to a URL, as discover.ts does. */
const keeps = (url: string): boolean => {
  const { allow, block, articleHints } = hr().crawl
  const hit = (ps: string[] | undefined) =>
    (ps ?? []).some((p) => new RegExp(p).test(url))
  return hit(allow) && !hit(block) && hit(articleHints)
}

describe("everystudent-hr registry entry", () => {
  it("is an UNWALLED, plain-HTTP, discovery-mode Croatian source with nothing pinned", () => {
    const entry = hr()
    expect(entry.domain).toBe("www.vrlovazno.com")
    // Croatian, verified 2026-07-29 by word-boundary counts across all 42
    // articles: tko 126 / ko 0, covjek 67 / covek 0, krscan 64 / hriscan 0.
    // Latin script only — 8 Cyrillic codepoints exist on the whole site and
    // they are one stray Macedonian word. No hreflang, no /cir/ tree, so there
    // is no parallel script variant and `hr` needs no -Latn qualifier.
    expect(entry.languages).toEqual(["hr"])
    // The load-bearing fact: ~70 plain-curl requests all returned HTTP 200 from
    // Apache/HTTP2. Declaring a fetchStrategy would bill every page through
    // Firecrawl for nothing.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, not a hand-listed inventory: /sitemap.xml is free to fetch.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    // …and NOTHING is pinned, deliberately. The site's own HTML map
    // (/m/sitemap.html) lists exactly the same 41 /a/ URLs as the XML sitemap —
    // zero delta in both directions — unlike -sr, which needed 7 seeds. Adding
    // seeds here would only be someone guessing at a gap that was measured shut.
    expect(entry.crawl.seedPaths).toBeUndefined()
  })

  it("is a SEPARATE source key from everystudent AND from the Serbian neighbour (ADR-0006)", () => {
    // One domain = one source. vrlovazno.com is its own domain, so the Croatian
    // content must not be folded into `everystudent` as a second language.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(hr().domain)
    expect(hr().key).toBe("everystudent-hr")
    // And it is not a script/dialect variant of `everystudent-sr` either:
    // same-topic articles share 0.9% (Trinity) and 0.4% (Prayer) of their
    // 8-word shingles, i.e. independent translations, not one text served twice.
    const sr = getSource("everystudent-sr")!
    expect(sr.domain).not.toBe(hr().domain)
    expect(sr.languages).toEqual(["sr"])
  })

  it("blocks the John study, the 7-email series and the /a/ form page, none of which the 250 floor can catch", () => {
    // All measured 2026-07-29 under this entry's shipped config, and every one
    // is ABOVE minContentLength — several only because extractContent falls
    // back to <body> ?? root rather than returning empty. Only a URL block
    // excludes them.
    for (const u of [
      "https://www.vrlovazno.com/", // homepage: 935 ch of teaser headlines
      "https://www.vrlovazno.com/m/sitemap.html", // "Mapa weba", the site plan, 1,598 ch
      "https://www.vrlovazno.com/m/intl.html", // links out to the sibling language domains
      "https://www.vrlovazno.com/m/postojanje.html", // section index, 972 ch
      "https://www.vrlovazno.com/kontakt.html", // contact form, 359 ch — over the floor
      // "proucavanje Evandelja po Ivanu" — the Gospel-of-John email study
      // (1,832 ch), Croatian twin of the French /jean.html and Polish /jan.html.
      "https://www.vrlovazno.com/upoznajmo-Boga-zajedno.html",
      // "Duhovni izazovi" — "serija od sedam poruka putem e-poste" (1,515 ch),
      // Croatian twin of the French /aventure.html and Arabic /pack.html.
      "https://www.vrlovazno.com/duhovni-izazovi.html",
      // A post-decision follow-up that poses six questions, answers none and
      // asks for an email (1,064 ch). It MATCHES articleHints, so this block is
      // the only thing keeping it out if the sitemap is ever regenerated.
      "https://www.vrlovazno.com/a/osobno2.html",
    ]) {
      expect(keeps(u)).toBe(false)
    }
    // …while every real article still passes, including the two whose extraction
    // relies on the implicit root fallback (28,617 and 6,783 ch).
    for (const u of [
      "https://www.vrlovazno.com/a/postoji.html",
      "https://www.vrlovazno.com/a/bibliji.html",
      "https://www.vrlovazno.com/a/osobno.html",
      "https://www.vrlovazno.com/a/razbijeni-tanjuri.html",
    ]) {
      expect(keeps(u)).toBe(true)
    }
  })

  it("keeps /a/bibliji.html: the host serves no full Bible book (estate scripture policy)", () => {
    // The 2026-07-29 estate-wide policy blocks complete Bible books on article
    // URLs, as -es (/articulos/biblia_juan.html) and -sq (/a/gjoni.html, 98,887
    // ch) do. This host has none: /ivan.html, /a/ivan.html, /a/ivana.html,
    // /biblija.html and /a/biblija.html all 404. The only large page,
    // /a/bibliji.html ("Zasto mozete vjerovati Bibliji", 28,617 ch), is
    // apologetics ABOUT the Bible — 8 of its 303 paragraphs are quoted
    // scripture, 6.5% of the page — so the policy does not reach it. This test
    // exists so a future estate-wide scripture sweep does not block it by name
    // on the strength of the slug alone.
    expect(keeps("https://www.vrlovazno.com/a/bibliji.html")).toBe(true)
    expect(hr().crawl.block?.join(" ")).not.toContain("bibliji")
  })

  it("scopes to .contentpadding and never lets the empty .content4 spacer shadow it", () => {
    // Measured 2026-07-29 with the repo's own extractContent across all 54
    // sitemap pages: .contentpadding matches 46/54 and extracts 155-22,215 ch
    // with NONE empty, while .content4 matches 51/54 and extracts 0 chars on
    // every one of the 39 articles it hits, and .content4b matches 2 and is also
    // empty. extractContent scopes to the first selector that MATCHES AN
    // ELEMENT, not the first that yields text, so either listed ahead of
    // .contentpadding would silently extract nothing and all 41 articles would
    // skip `too-thin` on an HTTP 200. Adding .content4b as a *fallback* would
    // instead drop /a/bibliji.html and /a/osobno.html, which the implicit root
    // fallback extracts correctly. Hence: exactly one selector.
    // The `"html"` fallback is a deliberate LAST entry (orchestrator, 2026-07-29):
    // it is only ever consulted when the primary misses, so it cannot shadow
    // anything, and it beats extract.ts's implicit `?? root` because <html> is a
    // real element and so carries no literal "<!DOCTYPE html>" text node. What
    // must never change is the FIRST entry, and the absence of `.content4`.
    expect(hr().crawl.contentSelectors).toEqual([".contentpadding", "html"])
    expect(hr().crawl.contentSelectors[0]).toBe(".contentpadding")
    expect(hr().crawl.contentSelectors).not.toContain(".content4")
  })

  it("strips the share/CTA chrome, keeping BOTH .fctable and .fccell", () => {
    const strip = hr().crawl.stripSelectors
    // A custom ELEMENT tag here, not a class — 2 instances / 115 ch inside
    // .contentpadding ("POSALJI PRIJATELJU:" plus the related-links block), and
    // 4 instances / 971 ch on the two pages that fall back to the document root,
    // where it is the only thing removing the page nav. The largest contributor.
    expect(strip).toContain("sitelevel_noindex")
    // Both are load-bearing and neither is redundant: .fctable removes 70-195 ch
    // on normal articles, and on /a/osobno.html .fctable has 0 instances while
    // .fccell removes 140 ch on its own. Dropping either loses real chrome.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
  })
})
