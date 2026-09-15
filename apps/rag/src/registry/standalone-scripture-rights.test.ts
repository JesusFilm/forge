/**
 * Temporary rights quarantine for predominantly Bible-translation pages,
 * guarded in ONE place because it is ONE rule, not thirteen.
 *
 * A public source-page citation preserves provenance, but it does not identify
 * the Bible translation, rights holder, reuse terms, or attribution notice a
 * consumer may be required to display. The registry's source-level `rights`
 * field can also misattribute third-party translation text to the ministry that
 * hosts it. Until the corpus can represent those facts and return required
 * attribution, pages made predominantly of Bible-translation text stay out of
 * acquisition. Ordinary Scripture quotations inside ministry articles are
 * unaffected.
 *
 * This file guards the smaller instance found on 2026-08-06: the
 * "Who was Jesus?" page, ~20-26k chars of curated highlights from John that state
 * the formula in their own first paragraph — excerpts taken straight from the
 * Bible with **no commentary added**. Thirteen banners publish it.
 *
 * It lives apart from registry.test.ts because it is a cross-source policy, not a
 * fact about any single entry, and because thirteen scattered assertions in
 * thirteen files is exactly how a policy silently loses a member.
 */
import { describe, expect, it } from "vitest"
import { getSource, seedUrls } from "./index.js"

describe("standalone Scripture rights quarantine", () => {
  /**
   * Excluded 2026-08-06 on an operator decision (campaign #111 §0.13). The page
   * is NOT inert: sibling copies took ranks 7 and 8 on a cross question,
   * consuming top-10 slots a real answer would otherwise hold.
   *
   * ⚠️ Two mechanisms, because two shapes of source carry it. A `block` rule is
   * DEAD CONFIG on a seed-only source — `block` filters DISCOVERED urls and a
   * seed-only source discovers none — so those three drop the seed instead.
   */
  it("quarantines the predominantly Scripture 'Who was Jesus?' page on all 13 banners that carry it", () => {
    const blocked = (key: string, path: string): boolean => {
      const entry = getSource(key)
      expect(entry, `${key} is not registered`).toBeDefined()
      const url = `${entry!.crawl.baseUrl}${path}`
      // Seed-only sources: the seed list IS the filter.
      if (!entry!.crawl.sitemaps?.length) {
        return !seedUrls(entry!).includes(url)
      }
      return (entry!.crawl.block ?? []).some((p) => new RegExp(p).test(url))
    }

    // Discovery sources — excluded by a `block` regex.
    expect(blocked("everystudent-de", "/artikel/werwar.html")).toBe(true)
    expect(blocked("everystudent-es", "/articulos/jesus.html")).toBe(true)
    expect(blocked("everystudent-hi", "/a/whowas.html")).toBe(true)
    expect(blocked("everystudent-hu", "/a/jezus.html")).toBe(true)
    expect(blocked("everystudent-ja", "/a/whowas.html")).toBe(true)
    expect(blocked("everystudent-my", "/a/whowas.html")).toBe(true)
    expect(blocked("everystudent-ro", "/a/cineafostiisus.html")).toBe(true)
    expect(blocked("everystudent-sq", "/a/ishte.html")).toBe(true)
    expect(blocked("everystudent-ta", "/a/whowas.html")).toBe(true)
    expect(blocked("everystudent-zh-cn", "/a/whowas.html")).toBe(true)

    // Seed-only sources — excluded by omission from `seedPaths`.
    expect(blocked("everystudent", "/wires/who-was-jesus.html")).toBe(true)
    expect(blocked("everystudent-ar", "/a/whowas.html")).toBe(true)
    expect(blocked("everystudent-hy", "/a/whowas.html")).toBe(true)

    // 🔴 The block must be SURGICAL. Two same-family slugs are entirely
    // different articles and must survive: Lithuanian /a/jezus.html is "Did
    // Jesus ever say he was God?" (4,520 ch of argument, not excerpts) and
    // Polish /a/ktoryjezus.html is "Which Jesus is real?" on media portrayals
    // (5,502 ch). Both were read before the exclusion ran. A slug-only audit
    // would have taken them; the size band is what separated them.
    expect(blocked("everystudent-lt", "/a/jezus.html")).toBe(false)
    expect(blocked("everystudent-pl", "/a/ktoryjezus.html")).toBe(false)
  })
})
