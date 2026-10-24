/**
 * The `everystudent-ne` registry entry — EveryStudent's Nepali domain
 * (nepalistudent.net). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent-pl.test.ts` / `everystudent-sq.test.ts`.
 *
 * Each guard below pins a decision that took live measurement on 2026-07-30 to
 * reach, so a future edit cannot quietly undo it:
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - the `.net` TLD and the `www.` canonical host — the apex 301s to `www`, and
 *     a `.com` or apex pin would make every filter miss;
 *   - `.contentpadding` FIRST, with `.content4` absent — `.content4` matches on
 *     20/20 articles and extracts 0 chars, so listing it would shadow the real
 *     container and skip every page as `too-thin` on an HTTP 200;
 *   - the two `seedPaths`, which are the only reason two live articles missing
 *     from `/sitemap.xml` get ingested at all;
 *   - `/a/` only — the `/m/` indexes and the homepage all clear the 250-char
 *     floor via the `html` container, so `minContentLength` could never have
 *     excluded them.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy, seedUrls } from "./index.js"
import type { SourceEntry } from "./types.js"

const ne = (): SourceEntry => getSource("everystudent-ne")!
const HOST = "https://www.nepalistudent.net"

/** Apply the entry's own discovery filters to a URL, the way Acquisition does. */
const keeps = (url: string): boolean => {
  const { allow, articleHints, block } = ne().crawl
  const any = (pats: string[] | undefined): boolean =>
    !pats?.length || pats.some((p) => new RegExp(p).test(url))
  if (block?.some((p) => new RegExp(p).test(url))) return false
  return any(allow) && any(articleHints)
}

describe("everystudent-ne registry entry", () => {
  it("is a SEPARATE source key per domain, pinned to the .net host (ADR-0006)", () => {
    const entry = ne()
    // One domain = one source — the rule that keeps thelife-fr / thelife-zh
    // separate. Nepali must not be folded into `everystudent` as a language.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(entry.domain)
    expect(entry.key).toMatch(/^[a-z0-9-]+$/)
    // ⚠️ The TLD is .net, NOT .com, and the apex 301s to www (measured on /,
    // /robots.txt and /sitemap.xml). Every <loc> is a www absolute URL, and the
    // filters match the full absolute URL — so an apex or .com pin misses all 28.
    expect(entry.domain).toBe("www.nepalistudent.net")
    expect(entry.crawl.baseUrl).toBe("https://www.nepalistudent.net")
    expect(keeps(`${HOST}/a/tragedy.html`)).toBe(true)
    expect(keeps("https://nepalistudent.net/a/tragedy.html")).toBe(false)
    expect(keeps("https://www.nepalistudent.com/a/tragedy.html")).toBe(false)
  })

  it("is an UNWALLED discovery crawl whose allow-regex matches the sitemap's https scheme", () => {
    const entry = ne()
    // ~70 plain-HTTP GETs on 2026-07-30 all returned `server: Apache` with no
    // Cloudflare layer and no block page. Declaring a strategy would bill every
    // page for a wall that is not there.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    expect(entry.languages).toEqual(["ne"])
    // Discovery, not hand-listed seeds: /sitemap.xml answers 200 (4,670 bytes,
    // 28 distinct <loc>). /sitemap_index.xml is 404, so there is no larger index.
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.articleHints?.length).toBeGreaterThan(0)
    // discover.ts filters the RAW <loc> string without normalising the scheme.
    // All 28 <loc> values are https, so ^https:// discovers them; the everystudent.gr
    // trap is an http sitemap behind an ^https:// pin, which discovers zero.
    for (const p of entry.crawl.allow!) expect(p).toContain("^https://")
  })

  it("pins the two live articles that /sitemap.xml omits", () => {
    // The XML sitemap lists 18 /a/ URLs. The site's own HTML map
    // (/m/sitemap.html) lists 19 — the extra is /a/prayer.html, "Does God answer
    // our prayers?" (10,885 ch). Harvesting every href across all 28 fetched
    // pages found /a/fol.html too, "Starting with God" (2,806 ch), which is in
    // NEITHER map. Both are live 200s. acquire.ts unions seeds with discovered
    // URLs, so without these pins two real articles are simply never fetched.
    expect(seedUrls(ne())).toEqual([
      `${HOST}/a/prayer.html`,
      `${HOST}/a/fol.html`,
    ])
    // ...and the seeds must still survive the discovery filters, since a block
    // that caught them would make the pin useless.
    expect(keeps(`${HOST}/a/prayer.html`)).toBe(true)
    expect(keeps(`${HOST}/a/fol.html`)).toBe(true)
  })

  it("keeps /a/ articles — including the mixed-case slug — and drops indexes, contact and homepage", () => {
    expect(keeps(`${HOST}/a/is-there-a-god.html`)).toBe(true)
    // /a/know-God.html carries an uppercase G. A [a-z0-9-]+ hint would silently
    // lose it, which is why the hint uses [^/]+.
    expect(keeps(`${HOST}/a/know-God.html`)).toBe(true)
    // The 8 section indexes. /m/existence, /m/knowing and /m/life have NO
    // .contentpadding, so the `html` container returns 617-819 ch of link list —
    // the 250 floor cannot catch them. /m/sitemap.html is the site plan (728 ch),
    // /m/intl.html the page linking out to the sibling language domains.
    expect(keeps(`${HOST}/m/existence.html`)).toBe(false)
    expect(keeps(`${HOST}/m/sitemap.html`)).toBe(false)
    expect(keeps(`${HOST}/contact.html`)).toBe(false)
    // The homepage extracts 697 chars through the `html` container, NOT 0 —
    // it has no .contentpadding and no <body>, so only a URL block excludes it.
    expect(keeps(`${HOST}/`)).toBe(false)
    expect(ne().crawl.minContentLength).toBe(250)
  })

  it("binds .contentpadding FIRST and never lets the empty .content4 shadow it", () => {
    const { contentSelectors } = ne().crawl
    // Measured 2026-07-30 with the repo's own extractContent over all 20 article
    // pages: .contentpadding matches on 20/20 and yields 2,806-22,512 chars,
    // while .content4 ALSO matches on 20/20 and yields 0 — it is an empty spacer
    // div. extractContent scopes to the first selector that MATCHES AN ELEMENT,
    // not the first that yields text, so putting .content4 anywhere ahead of
    // .contentpadding makes every article skip `too-thin` on an HTTP 200:
    // silent, and the batch-1 failure mode.
    expect(contentSelectors[0]).toBe(".contentpadding")
    expect(contentSelectors).not.toContain(".content4")
    expect(contentSelectors).not.toContain("#content4")
    // "html" is the LAST entry and only fires if .contentpadding misses (a
    // collapsed div tree on malformed markup). Nothing follows it, so it cannot
    // shadow anything; "head" is what keeps that path from duplicating <title>,
    // and it is safe only because extract.ts reads the title from `root` BEFORE
    // the strip loop. Keep that order.
    expect(contentSelectors.at(-1)).toBe("html")
    expect(ne().crawl.stripSelectors).toContain("head")
  })

  it("strips the share and CTA chrome that was actually counted on this host", () => {
    const strip = ne().crawl.stripSelectors
    // A custom ELEMENT tag, not a class — <sitelevel_noindex>…</sitelevel_noindex>.
    // 40 instances across the 20 articles, removing 1,679 chars: the
    // "अरूलार्इ पठाउनुहोस्" share row and the related-links block. The missing
    // leading "." is correct, not a typo.
    expect(strip).toContain("sitelevel_noindex")
    // BOTH halves of the "FEATURE CLOSE" CTA are needed: .fctable (18 inst,
    // 2,404 ch isolated) is absent on 2 of the 20 pages, where .fccell (98 inst,
    // 2,575 ch isolated) alone catches the block. Dropping either leaks CTA copy.
    expect(strip).toContain(".fctable")
    expect(strip).toContain(".fccell")
    // Measured at 0 instances here, so it is deliberately NOT carried as a
    // parity no-op with the siblings.
    expect(strip).not.toContain(".relatedbottom")
  })
})
