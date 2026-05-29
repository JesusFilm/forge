import { print } from "graphql"
import { describe, expect, it } from "vitest"

import {
  getWatchVideoBySlugOperation,
  watchVideoFragment,
} from "@/lib/fragments/watch-video"

/**
 * Guards the WatchVideo fragment + GetWatchVideoBySlug operation against
 * (a) accidental field removal at the GraphQL boundary and (b) silent
 * drops of required variable definitions (the
 * `codegen-strips-optional-graphql-variables` failure mode).
 *
 * The fragment is admin-shape: `documentId: id` alias on every node,
 * `variants: dubs` alias, `value: text` alias on study questions, and
 * locale-narrowed reads via `locales(locale: $locale)`. Tests assert
 * those aliases survive `graphql-js`'s printer.
 */

describe("WatchVideoFragment", () => {
  it("projects every field the watch page consumes", () => {
    const printed = print(watchVideoFragment)

    // Top-level Video fields (with admin id → documentId alias).
    expect(printed).toMatch(/fragment WatchVideo on Video/)
    expect(printed).toMatch(/documentId\s*:\s*\bid\b/)
    expect(printed).toMatch(/\bslug\b/)
    expect(printed).toMatch(/\bnoIndex\b/)
    expect(printed).toMatch(/\blabel\b/)

    // Locale-narrowed projection for the active locale's title /
    // description / snippet / imageAlt — the resolver flattens this
    // single-element array onto the WatchVideoRecord shape.
    expect(printed).toMatch(/locales\(locale:\s*\$locale\)/)
    expect(printed).toMatch(
      /locales\([^)]*\)\s*\{[\s\S]*?\btitle\b[\s\S]*?description[\s\S]*?snippet[\s\S]*?imageAlt/,
    )

    // images { url ... } with thumbnail variants for poster selection.
    expect(printed).toMatch(/images\s*\{[\s\S]*?\burl\b/)
    expect(printed).toMatch(
      /images\s*\{[\s\S]*?thumbnail[\s\S]*?mobileCinematicHigh/,
    )

    // primaryLanguage { coreId, bcp47 }
    expect(printed).toMatch(/primaryLanguage\s*\{[\s\S]*?coreId[\s\S]*?bcp47/)

    // parents / children come through VideoRelation in admin — the
    // fragment projects `parent { ... }` / `child { ... }`. Assert both
    // joins are present and surface their nested locales/images/dubs.
    expect(printed).toMatch(/parents\s*\{[\s\S]*?parent\s*\{/)
    expect(printed).toMatch(/children\s*\{[\s\S]*?child\s*\{/)
    expect(printed).toMatch(/child\s*\{[\s\S]*?locales\(locale:\s*\$locale\)/)
    expect(printed).toMatch(
      /child\s*\{[\s\S]*?dubs\s*\{[\s\S]*?published[\s\S]*?\bhls\b/,
    )

    // variants: dubs alias on Video; nested fields keep the consumer
    // vocabulary intact.
    expect(printed).toMatch(/variants\s*:\s*dubs\s*\{/)
    expect(printed).toMatch(/variants\s*:\s*dubs\s*\{[\s\S]*?\bhls\b/)
    expect(printed).toMatch(/variants\s*:\s*dubs\s*\{[\s\S]*?\bpublished\b/)
    expect(printed).toMatch(
      /variants\s*:\s*dubs\s*\{[\s\S]*?\bmuxVideo\s*\{[\s\S]*?playbackId/,
    )
    expect(printed).toMatch(
      /variants\s*:\s*dubs\s*\{[\s\S]*?downloads\s*\{[\s\S]*?\bquality\b[\s\S]*?\bsize\b/,
    )
    expect(printed).not.toMatch(
      /variants\s*:\s*dubs\s*\{[\s\S]*?downloads\s*\{[\s\S]*?\burl\b/,
    )
    expect(printed).toMatch(
      /variants\s*:\s*dubs\s*\{[\s\S]*?language\s*\{[\s\S]*?coreId[\s\S]*?bcp47[\s\S]*?\bslug\b[\s\S]*?\bname\b/,
    )

    // studyQuestions: `value: text` alias because the consumer reads
    // `q.value`.
    expect(printed).toMatch(/studyQuestions\s*\{[\s\S]*?value\s*:\s*text/)
    expect(printed).toMatch(/studyQuestions\s*\{[\s\S]*?\border\b/)

    // bibleCitations + bibleBook { name } as a plain selection (admin's
    // `BibleBook.name` is JSON; the resolver coerces to string).
    expect(printed).toMatch(
      /bibleCitations\s*\{[\s\S]*?chapterStart[\s\S]*?chapterEnd[\s\S]*?verseStart[\s\S]*?verseEnd[\s\S]*?\border\b[\s\S]*?\bosisId\b/,
    )
    expect(printed).toMatch(
      /bibleBook\s*\{[\s\S]*?documentId\s*:\s*\bid\b[\s\S]*?\bname\b/,
    )
    expect(printed).not.toMatch(/bibleBook\s*\{[^}]*name\s*\{/)
  })

  it("preserves a single fragment definition (gql.tada @_unmask compiles cleanly)", () => {
    const printed = print(watchVideoFragment)
    const matches = printed.match(/fragment WatchVideo on Video/g) ?? []
    expect(matches).toHaveLength(1)
  })
})

describe("GetWatchVideoBySlug operation", () => {
  it("declares every variable as required (avoids codegen-strips-optional-graphql-variables)", () => {
    const printed = print(getWatchVideoBySlugOperation)

    expect(printed).toMatch(
      /query GetWatchVideoBySlug\([\s\S]*?\$locale:\s*String!/,
    )
    expect(printed).toMatch(/\$videoSlug:\s*String!/)
    // No optional variables — every var has the trailing `!`.
    const variableSection =
      printed.match(/GetWatchVideoBySlug\(([^)]*)\)/)?.[1] ?? ""
    expect(variableSection).not.toMatch(/:\s*[A-Za-z]+\s*[,)\s]/)
  })

  it("invokes videoBySlug with the slug var and threads $locale into the fragment", () => {
    const printed = print(getWatchVideoBySlugOperation)

    expect(printed).toMatch(/videoBySlug\(/)
    expect(printed).toMatch(/slug:\s*\$videoSlug/)
    // $locale is consumed inside the fragment's `locales(locale:)` arg.
    expect(printed).toMatch(/locales\(locale:\s*\$locale\)/)
  })

  it("inlines the WatchVideoFragment selection set (gql.tada @_unmask)", () => {
    const printed = print(getWatchVideoBySlugOperation)
    expect(printed).toMatch(/\.\.\.WatchVideo\b/)
    expect(printed).toMatch(/fragment WatchVideo on Video/)
  })
})
