/**
 * The `cru` registry entry — one source for the whole cru.org domain (English + Spanish).
 * Split out of `registry.test.ts` (the §5.5 300-line cap) because this policy is the
 * repo's most trap-laden: a 9-char `article` stub, a truncating `.cmp-text`, an empty
 * `.cmp-container`, a CTA-boilerplate `.category-layout`, and a Spanish locale path that
 * serves untranslated English. Each guard below encodes one trap that actually bit us.
 * Pure data + lookups, no I/O.
 */
import { describe, expect, it } from "vitest"
import { getSource } from "./index.js"
import type { SourceEntry } from "./types.js"

const cru = (): SourceEntry => getSource("cru")!

/**
 * Local mirror of `discover.ts`'s `keepUrl`: allow ∧ articleHints ∧ ¬block, where an
 * empty list means "no constraint" on that gate.
 *
 * Reimplemented rather than imported on purpose — `registry-is-pure`
 * (`.dependency-cruiser.cjs`) forbids anything under `src/registry/` from importing
 * `src/acquisition/`. Keep it in step with `keepUrl`; the `articleHints` gate is
 * load-bearing here (cru declares `\.html$`, which is what drops the extensionless
 * hub/section pages).
 */
function keeps(url: string): boolean {
  const { allow = [], block = [], articleHints = [] } = cru().crawl
  const matches = (patterns: string[]): boolean =>
    patterns.some((p) => new RegExp(p).test(url))

  if (allow.length > 0 && !matches(allow)) return false
  if (articleHints.length > 0 && !matches(articleHints)) return false
  if (block.length > 0 && matches(block)) return false
  return true
}

describe("Cru registry entry", () => {
  it("is one source for the whole domain, declaring the expected language set", () => {
    const c = getSource("cru")
    expect(c).toBeDefined()
    expect(c?.domain).toBe("www.cru.org")
    expect(c?.trust).toBe("partner")
    expect(c?.ingestionMode).toBe("html-scrape")
    // One domain = one source: the Spanish locale is NOT a sibling key.
    expect(getSource("cru-es")).toBeUndefined()
    // The old narrow sub-scope is absorbed too.
    expect(getSource("cru-10-basic-steps")).toBeUndefined()
    // DECLARED set; language is a per-document property decided at ingest.
    expect(c?.languages).toEqual(["en", "es", "fr"])
    // Discovery source (absorbed the 12 hand-listed 10-basic-steps seeds).
    expect(c?.crawl.seedPaths).toBeUndefined()
    expect(
      c?.crawl.sitemaps?.some((s) => s.includes("us-en-sitemap.xml")),
    ).toBe(true)
    expect(
      c?.crawl.sitemaps?.some((s) => s.includes("mx-es-sitemap.xml")),
    ).toBe(true)
    // maxPages must clear the ~2,716 URLs the two locales discover.
    expect(cru().crawl.maxPages).toBeGreaterThan(2716)
  })

  it("keeps the three English spiritual trunks and drops org / recruiting / commerce", () => {
    // includes the absorbed 10-basic-steps lessons
    expect(
      keeps(
        "https://www.cru.org/us/en/train-and-grow/10-basic-steps/4-prayer.html",
      ),
    ).toBe(true)
    expect(
      keeps(
        "https://www.cru.org/us/en/how-to-know-god/what-is-christianity.html",
      ),
    ).toBe(true)
    expect(
      keeps(
        "https://www.cru.org/us/en/blog/spiritual-growth/beyond-religion.html",
      ),
    ).toBe(true)

    expect(keeps("https://www.cru.org/us/en/communities/campus.html")).toBe(
      false,
    )
    expect(
      keeps("https://www.cru.org/us/en/opportunities/mission-trips.html"),
    ).toBe(false)
    expect(keeps("https://www.cru.org/us/en/about/donor-relations.html")).toBe(
      false,
    )
    // non-article media
    expect(
      keeps("https://www.cru.org/us/en/train-and-grow/video/a-clip.html"),
    ).toBe(false)
    expect(
      keeps(
        "https://www.cru.org/us/en/train-and-grow/quizzes-and-assessments/q.html",
      ),
    ).toBe(false)
  })

  it("keeps the Spanish locale but blocks the untranslated-English /10-pasos/ path", () => {
    expect(
      keeps(
        "https://www.cru.org/mx/es/conoce-a-dios/jesus-dios-o-simplemente-buen-hombre.html",
      ),
    ).toBe(true)
    expect(
      keeps(
        "https://www.cru.org/mx/es/crecer-y-equipar/crecimiento-espiritual/oracion/nacido.html",
      ),
    ).toBe(true)
    // Bill Bright's 10 Basic Steps, served as English bodies under Spanish chrome.
    expect(
      keeps(
        "https://www.cru.org/mx/es/crecer-y-equipar/estudios-biblicos/10-pasos-basicos-para-la-madurez-cristiana/intro-the-uniqueness-of-jesus.html",
      ),
    ).toBe(false)
    // `conoce-a-dios1` is a CMS duplicate section — excluded by the trailing [/.]
    expect(keeps("https://www.cru.org/mx/es/conoce-a-dios1/algo.html")).toBe(
      false,
    )
    // regional English mirrors would duplicate the corpus under other canonical URLs
    expect(
      keeps("https://www.cru.org/tt/en/train-and-grow/spiritual-growth.html"),
    ).toBe(false)
    expect(
      keeps("https://www.cru.org/bb/en/train-and-grow/spiritual-growth.html"),
    ).toBe(false)
  })

  it("keeps /language-resources/ now that per-document language detection landed (ADR-0006/0007)", () => {
    // Un-blocked 2026-07-13. The 28 per-language pages are ~90-char link-card hubs that
    // minContentLength drops; the section's one real doc is a French article — kept.
    expect(
      keeps(
        "https://www.cru.org/us/en/train-and-grow/language-resources/french.html",
      ),
    ).toBe(true)
    expect(
      keeps(
        "https://www.cru.org/us/en/train-and-grow/language-resources/french/que-se-passe-t-il-lorsque-les-gens-font-une-recherche-google-sur.html",
      ),
    ).toBe(true)
  })

  it("REGRESSION: contentSelectors exclude every container that silently loses content", () => {
    const sel = cru().crawl.contentSelectors
    expect(sel).toEqual([".article-long-form"])
    // `article` matches a 9-char stub on every cru.org page. Listing it starved
    // /how-to-know-god/ — 59/59 dropped too-thin on the first live crawl.
    expect(sel).not.toContain("article")
    // `.cmp-text` takes only the first block: heaven-and-hell 14%, full-article 3%.
    expect(sel).not.toContain(".cmp-text")
    // `.cmp-container` matches empty on some pages (finding-peace: 0 chars).
    expect(sel).not.toContain(".cmp-container")
    // Spanish-template traps: 138-char CTA boilerplate / wildly variable first match.
    expect(sel).not.toContain(".category-layout")
    expect(sel).not.toContain(".aem-Grid")
  })

  it("REGRESSION: stripSelectors remove the <div>-based AEM chrome and related-content furniture", () => {
    const strip = cru().crawl.stripSelectors
    // <div class="cmp-header"> etc. — the `header`/`footer` tag strip misses these.
    // The global picker alone is ~1,745 chars of country names on every page.
    for (const sel of [".cmp-header", ".cmp-footer", ".cmp-global-picker"]) {
      expect(strip).toContain(sel)
    }
    // furniture: cut body-fallback overhead from ~114-152% to ~104% of ground truth
    for (const sel of [
      ".cmp-teaser",
      ".swiper",
      ".cmp-experiencefragment",
      ".legacy-tile",
    ]) {
      expect(strip).toContain(sel)
    }
  })
})
