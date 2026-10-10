/**
 * The `everystudent-ja` registry entry — EveryStudent's Japanese domain
 * (studentinjapan.com). Split out of `registry.test.ts` (the §5.5 300-line cap),
 * following `everystudent.test.ts` / `everystudent-ar.test.ts` /
 * `everystudent-fr.test.ts`.
 *
 * Each guard below encodes a decision measured against the live host on
 * 2026-07-28, so a future edit cannot quietly undo it:
 *   - NOT walled, so no `fetchStrategy` — unlike all three sibling banners;
 *   - discovery mode, because the sitemap is free and reachable here;
 *   - a SEPARATE key from `everystudent`, because one domain = one source;
 *   - the `.shareiconsmenupg` strip, which the siblings do not have and this
 *     host needs, and `sitelevel_noindex`, which this host does NOT have;
 *   - the block list, which does real work the content-length floor cannot.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource, resolveFetchStrategy } from "./index.js"
import type { SourceEntry } from "./types.js"

const ja = (): SourceEntry => getSource("everystudent-ja")!

describe("everystudent-ja registry entry", () => {
  it("resolves everystudent-ja as an UNWALLED Japanese source crawled by discovery", () => {
    const entry = ja()
    expect(entry.domain).toBe("www.studentinjapan.com")
    expect(entry.languages).toEqual(["ja"])
    // Verified 2026-07-28: robots.txt, /sitemap.xml, the homepage and 20 article
    // pages all returned 200 to plain HTTP with no Cloudflare interstitial. So
    // `fetchStrategy` is ABSENT and the plain-http default applies — declaring
    // firecrawl here would bill every page for a wall that does not exist.
    expect(entry.crawl.fetchStrategy).toBeUndefined()
    expect(resolveFetchStrategy(entry)).toBe("plain-http")
    // Discovery, not hand-listed seeds: the sitemap is reachable and free, so
    // there is no frozen inventory to lift (the inverse of the walled siblings).
    expect(entry.crawl.sitemaps).toEqual(["/sitemap.xml"])
    expect(entry.crawl.seedPaths).toBeUndefined()
  })

  it("is a SEPARATE source key from everystudent, not a language of it (ADR-0006)", () => {
    // One domain = one source. studentinjapan.com is its own domain, so the
    // Japanese content must not be folded into `everystudent` as a second
    // language — the same rule that keeps everystudent-ar/-fr separate.
    const en = getSource("everystudent")!
    expect(en.languages).toEqual(["en"])
    expect(en.domain).not.toBe(ja().domain)
    expect(ja().key).toBe("everystudent-ja")
    expect(ja().key).toMatch(/^[a-z0-9-]+$/)
  })

  it("keeps exactly the /a/ article corpus and drops menus, funnel pages and the homepage", () => {
    const { allow, articleHints, block } = ja().crawl
    const keep = (u: string) =>
      allow!.some((r) => new RegExp(r).test(u)) &&
      articleHints!.some((r) => new RegExp(r).test(u)) &&
      !block!.some((r) => new RegExp(r).test(u))
    const H = "https://www.studentinjapan.com"
    // The 81 /a/*.html pages are the whole target set.
    expect(keep(`${H}/a/atheist.html`)).toBe(true)
    expect(keep(`${H}/a/Bible215.html`)).toBe(true)
    // 9 /m/* section indexes, the homepage, and the three email-funnel pages.
    expect(keep(`${H}/m/map.html`)).toBe(false)
    expect(keep(`${H}/m/testimonies.html`)).toBe(false)
    expect(keep(`${H}/`)).toBe(false)
    // /john.html and /pack.html are the John-study and Adventure-Pack signup
    // twins the French entry dropped; /unsubscribe.html is list plumbing.
    // All three clear minContentLength (356-1,099 chars measured), so the floor
    // could never have caught them — the block list is load-bearing.
    for (const p of ["john", "pack", "unsubscribe"]) {
      expect(keep(`${H}/${p}.html`)).toBe(false)
    }
  })

  it("honours the two robots.txt Disallow rules", () => {
    const { articleHints, block } = ja().crawl
    const H = "https://www.studentinjapan.com"
    const blocked = (u: string) => block!.some((r) => new RegExp(r).test(u))
    // robots.txt fetched live 2026-07-28: Disallow /a/fol.html and /m/intl.html.
    // /a/fol.html is the only disallowed path that MATCHES articleHints, and it
    // is linked from every article's FEATURE CLOSE block — so if it ever lands
    // in the sitemap this block is the only thing keeping us compliant.
    expect(
      articleHints!.some((r) => new RegExp(r).test(`${H}/a/fol.html`)),
    ).toBe(true)
    expect(blocked(`${H}/a/fol.html`)).toBe(true)
    expect(blocked(`${H}/m/intl.html`)).toBe(true)
  })

  it("strips the share widget that lives INSIDE .content4 on this host", () => {
    const { contentSelectors, stripSelectors } = ja().crawl
    // .content4 is tried first and is the widest container — measured binding on
    // every article probed, along with the other three shared-template selectors.
    expect(contentSelectors[0]).toBe(".content4")
    for (const s of [".content4b", ".articletitle", ".contentpadding"]) {
      expect(contentSelectors).toContain(s)
    }
    // NEW vs the siblings: 「他の人にシェアする」+ AddToAny buttons sit inside
    // .content4 but outside .content4b, so .content4 captures them. Without this
    // every article ends on the words "share with others".
    expect(stripSelectors).toContain(".shareiconsmenupg")
    // The FEATURE CLOSE call-to-action table: cells plus their wrapping <table>.
    expect(stripSelectors).toContain(".fccell")
    expect(stripSelectors).toContain(".fctable")
  })

  it("does not rely on sitelevel_noindex, which does not exist on this host", () => {
    // The siblings lean on this custom tag to remove share links and related
    // cards. Measured 2026-07-28: the string "noindex" appears ZERO times in
    // this host's markup — its do-not-index marker is an HTML comment. It is
    // retained only as a harmless parity no-op, so the real chrome removal must
    // be carried by the site-specific selectors above, not by this one.
    expect(ja().crawl.stripSelectors).toContain("sitelevel_noindex")
    expect(ja().crawl.stripSelectors).toContain(".shareiconsmenupg")
  })

  it("declares partner provenance, article defaults and Japanese tagging", () => {
    const entry = ja()
    expect(entry.trust).toBe("partner")
    expect(entry.ingestionMode).toBe("html-scrape")
    expect(entry.defaultCategory).toBe("article")
    expect(entry.defaultTags).toEqual([
      "everystudent",
      "cru",
      "topic:seeker",
      "lang:ja",
    ])
    expect(entry.rights).toContain("Cru")
    // 81 discovered articles + headroom; polite 1s delay on direct fetches.
    expect(entry.crawl.maxPages).toBe(120)
    expect(entry.crawl.requestDelayMs).toBe(1000)
  })
})
