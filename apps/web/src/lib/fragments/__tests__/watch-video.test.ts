import { print } from "graphql"
import { describe, expect, it } from "vitest"

import {
  getWatchVideoOperation,
  watchVideoFragment,
} from "@/lib/fragments/watch-video"

/**
 * U2 verification — guard the WatchVideoFragment + GetWatchVideo operation
 * against (a) accidental field removal and (b) the
 * `codegen-strips-optional-graphql-variables` failure mode where required
 * variable definitions are silently dropped from the serialized DocumentNode.
 *
 * See `docs/plans/2026-04-29-001-feat-watch-page-mux-parity-plan.md` (R22, U2).
 */

describe("WatchVideoFragment", () => {
  it("projects every field the watch page consumes (R22)", () => {
    const printed = print(watchVideoFragment)

    // Top-level Video fields
    expect(printed).toMatch(/fragment WatchVideo on Video/)
    expect(printed).toMatch(/documentId/)
    expect(printed).toMatch(/\bslug\b/)
    expect(printed).toMatch(/\btitle\b/)
    expect(printed).toMatch(/\bsnippet\b/)
    expect(printed).toMatch(/\bdescription\b/)
    expect(printed).toMatch(/\bnoIndex\b/)
    expect(printed).toMatch(/\blabel\b/)
    expect(printed).toMatch(/\bimageAlt\b/)

    // images { url }
    expect(printed).toMatch(/images\s*\{\s*[^}]*\burl\b/)

    // primaryLanguage { coreId, bcp47 }
    expect(printed).toMatch(/primaryLanguage\s*\{[\s\S]*?coreId[\s\S]*?bcp47/)

    // parents projection (canonical-parent + sibling carousel).
    // NOTE: R22 originally asked for `children(sort: ["order:asc"])`, but
    // Strapi has no `order` field on Video — see fragment file comment.
    // Children come back in editor-curated relation order; sibling-carousel
    // (U6) will fall back to client-side ordering if needed.
    expect(printed).toMatch(/parents\s*\{[\s\S]*?\bchildren\b/)
    expect(printed).toMatch(
      /\bchildren\b[^{]*\{[\s\S]*?documentId[\s\S]*?\bslug\b[\s\S]*?\btitle\b[\s\S]*?\blabel\b[\s\S]*?images\s*\{\s*url/,
    )

    // Top-level `children(pagination: { limit: -1 })` — required so Strapi
    // returns every chapter for parent/collection videos (e.g. JESUS has 61
    // segments). The default 10-row pagination would silently drop chapters
    // and the SiblingCarousel would render an incomplete strip. Mirrors the
    // variants assertion shape below. graphql-js prints selections in source
    // order, so the printed fragment shape is:
    //   parents { ... children(pagination) { ... } }
    //   children(pagination) { ... }      ← top-level
    //   variants(pagination) { ... }
    // The top-level occurrence is uniquely anchored by what appears AFTER
    // the closing `}` of the children block — the next field is
    // `variants(`. The nested occurrence is followed by another `}` (the
    // parents block close) instead.
    expect(printed).toMatch(
      /\bchildren\(pagination:\s*\{\s*limit:\s*-1\s*\}\)\s*\{[\s\S]*?\}\s*variants\s*\(/,
    )

    // variants: identifying + playable + downloads + muxVideo.
    // The relation is paginated with `limit: -1` so Strapi returns every
    // variant — the 10-row default would silently drop the English variant
    // for any video whose first 10 variants are non-English (242 variants
    // on `mary-visit-to-elizabeth`, etc.) and the watch page would fall back
    // to "first playable" → wrong-language playback.
    expect(printed).toMatch(/variants\(pagination:\s*\{\s*limit:\s*-1\s*\}\)/)
    expect(printed).toMatch(/variants\([^)]*\)\s*\{[\s\S]*?\bhls\b/)
    expect(printed).toMatch(/variants\([^)]*\)\s*\{[\s\S]*?\bpublished\b/)
    expect(printed).toMatch(
      /variants\([^)]*\)\s*\{[\s\S]*?\bmuxVideo\s*\{[\s\S]*?playbackId/,
    )
    expect(printed).toMatch(
      /variants\([^)]*\)\s*\{[\s\S]*?downloads\s*\{[\s\S]*?\bquality\b[\s\S]*?\bsize\b[\s\S]*?\burl\b/,
    )
    // variants.language must include the slug U3 will key off
    expect(printed).toMatch(
      /variants\([^)]*\)\s*\{[\s\S]*?language\s*\{[\s\S]*?coreId[\s\S]*?bcp47[\s\S]*?\bslug\b[\s\S]*?\bname\b/,
    )

    // studyQuestions sorted ascending; only `value` + `order` (no `answer`)
    expect(printed).toMatch(/studyQuestions\(sort:\s*\["order:asc"\]\)/)
    expect(printed).toMatch(/studyQuestions\([^)]*\)\s*\{[\s\S]*?\bvalue\b/)
    expect(printed).not.toMatch(
      /studyQuestions\([^)]*\)\s*\{[\s\S]*?\banswer\b[\s\S]*?\}/,
    )

    // bibleCitations sorted ascending
    expect(printed).toMatch(/bibleCitations\(sort:\s*\["order:asc"\]\)/)
    expect(printed).toMatch(
      /bibleCitations\([^)]*\)\s*\{[\s\S]*?chapterStart[\s\S]*?chapterEnd[\s\S]*?verseStart[\s\S]*?verseEnd[\s\S]*?\border\b[\s\S]*?\bosisId\b/,
    )

    // bibleBook { name } MUST be a plain String selection — guard against
    // accidentally projecting `name { value primary }`.
    expect(printed).toMatch(
      /bibleBook\s*\{[\s\S]*?documentId[\s\S]*?\bname\b[\s\S]*?\}/,
    )
    expect(printed).not.toMatch(/bibleBook\s*\{[^}]*name\s*\{/)
  })

  it("preserves a single fragment definition (gql.tada @_unmask compiles cleanly)", () => {
    const printed = print(watchVideoFragment)
    // graphql-js's `print()` strips unknown client directives like
    // `@_unmask` after schema validation, so we cannot assert the directive
    // text round-trips. Instead, assert the fragment definition prints
    // exactly once and on the expected target type — proof that gql.tada's
    // codegen accepted the fragment without throwing.
    const matches = printed.match(/fragment WatchVideo on Video/g) ?? []
    expect(matches).toHaveLength(1)
  })
})

describe("GetWatchVideo operation", () => {
  it("declares every variable as required (avoids codegen-strips-optional-graphql-variables)", () => {
    const printed = print(getWatchVideoOperation)

    expect(printed).toMatch(
      /query GetWatchVideo\([\s\S]*?\$i18nLocale:\s*I18NLocaleCode!/,
    )
    expect(printed).toMatch(/\$collectionSlug:\s*String!/)
    expect(printed).toMatch(/\$videoSlug:\s*String!/)
    // No optional variables — every var has the trailing `!`.
    const variableSection = printed.match(/GetWatchVideo\(([^)]*)\)/)?.[1] ?? ""
    expect(variableSection).not.toMatch(/:\s*[A-Za-z]+\s*[,)\s]/)
  })

  it("filters videos by slug + parent.slug and threads i18nLocale", () => {
    const printed = print(getWatchVideoOperation)

    expect(printed).toMatch(/videos\(/)
    expect(printed).toMatch(
      /filters:\s*\{[\s\S]*?slug:\s*\{\s*eq:\s*\$videoSlug/,
    )
    expect(printed).toMatch(
      /parents:\s*\{\s*slug:\s*\{\s*eq:\s*\$collectionSlug/,
    )
    expect(printed).toMatch(/locale:\s*\$i18nLocale/)
  })

  it("inlines the WatchVideoFragment selection set (gql.tada @_unmask)", () => {
    const printed = print(getWatchVideoOperation)
    // With `@_unmask`, gql.tada keeps the spread syntax in the printed AST
    // BUT gql.tada wires the fragment definition into the same DocumentNode,
    // so `print()` emits it after the operation. Guard both the spread and
    // the inlined fragment definition.
    expect(printed).toMatch(/\.\.\.WatchVideo\b/)
    expect(printed).toMatch(/fragment WatchVideo on Video/)
  })

  it("does NOT declare $languageSlug as a query variable (resolver-side per R22)", () => {
    const printed = print(getWatchVideoOperation)
    // Per the U2 plan, `$languageSlug` is consumed resolver-side by U3, not
    // passed through the GraphQL operation. Declaring it without using it
    // would fail GraphQL validation; passing it as a Strapi filter would
    // contradict the "Strapi returns every variant" decision in R8/R22.
    expect(printed).not.toMatch(/\$languageSlug/)
  })
})

describe("WatchVideoFragment empirical assertions (skipped — Strapi fetch)", () => {
  // Deferred-to-implementation check from the plan:
  //   "$Video.variant.language.slug actual values in Strapi$ — empirical check
  //    during U2 codegen run. If `language.slug` is null on existing variants
  //    (unlikely given Strapi convention), surface as a U2 blocker."
  //
  // We do NOT mock-fetch from Strapi here because (a) Strapi credentials live
  // in env vars not present in CI, and (b) the apollo client wrapper is
  // covered by content.test.ts. The empirical check is performed manually
  // during the codegen run; results are documented in the U2 commit message
  // and PR description.
  it.todo(
    "fetches `considering-christmas` against christmas/en/english and asserts variants[].language.slug is non-null",
  )
})
