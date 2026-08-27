import { InMemoryCache } from "@apollo/client"
import { parse, print } from "graphql"
import type { DocumentNode } from "graphql"

import {
  projectBiblePassage,
  type RawBiblePassage,
  type RequiredPassageField,
} from "../biblePassages"
import { GET_VIDEO_BIBLE_PASSAGES, GET_VIDEO_BY_SLUG } from "../queries"

// Every value read off deployed admin for Genesis 1:26-27 on `the-beginning`
// on 2026-08-27, `content` abridged. Re-read it if the version admin resolves
// changes — a fixture that claims to be production-shaped and is not sends
// every reviewer to the wrong contract.
const COMPLETE: Required<RawBiblePassage> = {
  content:
    "Then God said, “Let Us make man in Our image, after Our likeness…” So God created man in His own image.",
  copyright: "Public Domain",
  humanReference: "Genesis 1:26-27",
  provider: "youversion",
  reference: "GEN.1.26-27",
  versionAbbreviation: "BSB",
  versionId: 3034,
  versionTitle: "Berean Standard Bible",
}

describe("projectBiblePassage", () => {
  it("projects a complete passage, with a link", () => {
    const result = projectBiblePassage(COMPLETE)

    expect(result).toEqual({
      status: "renderable",
      passage: {
        reference: "Genesis 1:26-27",
        content: COMPLETE.content,
        copyright: "Public Domain",
        versionTitle: "Berean Standard Bible",
        versionAbbreviation: "BSB",
        passageUrl: "https://www.bible.com/bible/3034/GEN.1.26-27.BSB",
      },
    })
  })

  it("reports an absent passage separately from a rejected one", () => {
    expect(projectBiblePassage(null)).toEqual({ status: "absent" })
    expect(projectBiblePassage(undefined)).toEqual({ status: "absent" })
  })

  // Covers R6. Each fixture is written out in full with explicit literals and
  // nulls exactly ONE required value, so a passing case cannot be passing
  // because a sibling field also failed the gate.
  describe("R6 gate — one missing value at a time", () => {
    const cases: ReadonlyArray<{
      readonly field: RequiredPassageField
      readonly raw: RawBiblePassage
      readonly reachable: boolean
    }> = [
      {
        // SYNTHETIC. `apps/admin/src/services/scripture-passage.service.ts`
        // requires non-empty content before it caches or returns a passage, so
        // this state is not reachable in production today.
        field: "content",
        reachable: false,
        raw: {
          content: null,
          copyright: "Public Domain",
          humanReference: "Genesis 1:26-27",
          provider: "youversion",
          reference: "GEN.1.26-27",
          versionAbbreviation: "BSB",
          versionId: 3034,
          versionTitle: "Berean Standard Bible",
        },
      },
      {
        // SYNTHETIC. `scripture-passage.service.ts` returns nothing at all when
        // the provider supplies no copyright, so a passage with a null
        // copyright is not reachable in production today.
        field: "copyright",
        reachable: false,
        raw: {
          content: "In the beginning God created the heavens and the earth.",
          copyright: null,
          humanReference: "Genesis 1:26-27",
          provider: "youversion",
          reference: "GEN.1.26-27",
          versionAbbreviation: "BSB",
          versionId: 3034,
          versionTitle: "Berean Standard Bible",
        },
      },
      {
        // SYNTHETIC. `scripture-passage.service.ts` coalesces the human
        // reference to the citation's own reference, so it is never null in
        // production today.
        field: "humanReference",
        reachable: false,
        raw: {
          content: "In the beginning God created the heavens and the earth.",
          copyright: "Public Domain",
          humanReference: null,
          provider: "youversion",
          reference: "GEN.1.26-27",
          versionAbbreviation: "BSB",
          versionId: 3034,
          versionTitle: "Berean Standard Bible",
        },
      },
      {
        // SYNTHETIC. `scripture-passage.service.ts` hardcodes the provider on
        // every passage it returns, so a null provider is not reachable in
        // production today.
        field: "provider",
        reachable: false,
        raw: {
          content: "In the beginning God created the heavens and the earth.",
          copyright: "Public Domain",
          humanReference: "Genesis 1:26-27",
          provider: null,
          reference: "GEN.1.26-27",
          versionAbbreviation: "BSB",
          versionId: 3034,
          versionTitle: "Berean Standard Bible",
        },
      },
      {
        // SYNTHETIC. The cache column backing `reference` is NOT NULL, so an
        // absent reference is not reachable in production today.
        field: "reference",
        reachable: false,
        raw: {
          content: "In the beginning God created the heavens and the earth.",
          copyright: "Public Domain",
          humanReference: "Genesis 1:26-27",
          provider: "youversion",
          reference: null,
          versionAbbreviation: "BSB",
          versionId: 3034,
          versionTitle: "Berean Standard Bible",
        },
      },
      {
        // SYNTHETIC. `scripture-passage.service.ts` always derives a version id
        // before it returns a passage, so a null version id is not reachable in
        // production today.
        field: "versionId",
        reachable: false,
        raw: {
          content: "In the beginning God created the heavens and the earth.",
          copyright: "Public Domain",
          humanReference: "Genesis 1:26-27",
          provider: "youversion",
          reference: "GEN.1.26-27",
          versionAbbreviation: "BSB",
          versionId: null,
          versionTitle: "Berean Standard Bible",
        },
      },
      {
        // PRODUCTION-REACHABLE. Nullable end to end. All 94 resolved production
        // passages carry it today, so the gate is what holds if that changes.
        field: "versionAbbreviation",
        reachable: true,
        raw: {
          content: "In the beginning God created the heavens and the earth.",
          copyright: "Public Domain",
          humanReference: "Genesis 1:26-27",
          provider: "youversion",
          reference: "GEN.1.26-27",
          versionAbbreviation: null,
          versionId: 3034,
          versionTitle: "Berean Standard Bible",
        },
      },
      {
        // PRODUCTION-REACHABLE. Nullable end to end, same as the abbreviation.
        field: "versionTitle",
        reachable: true,
        raw: {
          content: "In the beginning God created the heavens and the earth.",
          copyright: "Public Domain",
          humanReference: "Genesis 1:26-27",
          provider: "youversion",
          reference: "GEN.1.26-27",
          versionAbbreviation: "BSB",
          versionId: 3034,
          versionTitle: null,
        },
      },
    ]

    it("covers every required field exactly once", () => {
      expect(cases.map((c) => c.field).sort()).toEqual([
        "content",
        "copyright",
        "humanReference",
        "provider",
        "reference",
        "versionAbbreviation",
        "versionId",
        "versionTitle",
      ])
      expect(cases.filter((c) => c.reachable).map((c) => c.field)).toEqual([
        "versionAbbreviation",
        "versionTitle",
      ])
    })

    it.each(cases)("rejects a passage missing $field", ({ field, raw }) => {
      expect(projectBiblePassage(raw)).toEqual({
        status: "rejected",
        missingField: field,
      })
    })
  })

  // Admin passes provider columns through raw, so a blank string is a real
  // shape the `!= null` form would let through.
  it("treats a blank required value as missing", () => {
    expect(projectBiblePassage({ ...COMPLETE, versionTitle: "   " })).toEqual({
      status: "rejected",
      missingField: "versionTitle",
    })
  })

  it("yields no link for a rejected passage", () => {
    const result = projectBiblePassage({
      ...COMPLETE,
      versionAbbreviation: null,
    })

    expect(result.status).toBe("rejected")
    expect(JSON.stringify(result)).not.toContain("bible.com")
  })

  // SYNC guard with `getBibleComUrl` in
  // apps/web/src/components/watch/BibleQuotesSection.tsx. The literals are the
  // shipped web output for this citation; a divergence sends the two apps to
  // different bible.com pages.
  it("derives the same link web derives", () => {
    expect(projectBiblePassage(COMPLETE)).toMatchObject({
      passage: {
        passageUrl: "https://www.bible.com/bible/3034/GEN.1.26-27.BSB",
      },
    })
  })

  // SYNTHETIC reference/abbreviation. Admin's references carry no characters
  // that need escaping today, so this pins that the escaping web applies is
  // applied here too rather than being dead code.
  it("percent-encodes the reference and the abbreviation", () => {
    expect(
      projectBiblePassage({
        ...COMPLETE,
        reference: "GEN.1.26 26",
        versionAbbreviation: "WEB BE",
      }),
    ).toMatchObject({
      passage: {
        passageUrl: "https://www.bible.com/bible/3034/GEN.1.26%2026.WEB%20BE",
      },
    })
  })
})

// ── KTD2: the companion write must not collapse the player-gating read ──────

const SLUG = "the-beginning"
const VIDEO_VARIABLES = { locale: "en", slug: SLUG }

// A complete result for GET_VIDEO_BY_SLUG. Every list the fragment selects is
// present so the cache read below is complete for the right reason.
const VIDEO_RESULT = {
  videoBySlug: {
    __typename: "Video",
    documentId: "video-the-beginning",
    slug: SLUG,
    // Admin's wire enum is UPPERCASE; the lowercase spelling widens to `string`
    // and fails the generated type.
    label: "FEATURE_FILM" as const,
    images: [],
    primaryLanguage: {
      __typename: "Language",
      coreId: "529",
      bcp47: "en",
    },
    locales: [],
    parents: [],
    variants: [],
    studyQuestions: [],
    bibleCitations: [
      {
        __typename: "BibleCitation",
        documentId: "citation-genesis-1-26",
        chapterStart: 1,
        chapterEnd: null,
        verseStart: 26,
        verseEnd: 27,
        order: 0,
        osisId: "Gen.1.26-Gen.1.27",
        bibleBook: {
          __typename: "BibleBook",
          documentId: "book-genesis",
          name: [{ value: "Genesis", primary: true }],
        },
      },
    ],
  },
}

const PASSAGE_RESULT = {
  videoBySlug: {
    __typename: "Video",
    documentId: "video-the-beginning",
    bibleCitations: [
      {
        __typename: "BibleCitation",
        documentId: "citation-genesis-1-26",
        passage: {
          __typename: "Passage",
          content: COMPLETE.content,
          copyright: COMPLETE.copyright,
          humanReference: COMPLETE.humanReference,
          provider: COMPLETE.provider,
          reference: COMPLETE.reference,
          versionAbbreviation: COMPLETE.versionAbbreviation,
          versionId: COMPLETE.versionId,
          versionTitle: COMPLETE.versionTitle,
        },
      },
    ],
  },
}

/**
 * The production companion document with the OUTER `documentId: id` alias
 * removed and nothing else changed — derived from the shipped document so the
 * two halves cannot drift apart.
 */
function companionWithoutOuterId(): DocumentNode {
  const sdl = print(GET_VIDEO_BIBLE_PASSAGES as DocumentNode)
  const stripped = sdl.replace("documentId: id\n", "")
  expect(stripped).not.toBe(sdl)
  return parse(stripped)
}

function passageResultWithoutOuterId() {
  const withoutOuterId: Record<string, unknown> = {
    ...PASSAGE_RESULT.videoBySlug,
  }
  delete withoutOuterId.documentId
  return { videoBySlug: withoutOuterId }
}

describe("GET_VIDEO_BIBLE_PASSAGES cache isolation (KTD2)", () => {
  it("leaves the player-gating read intact after the companion write", () => {
    const cache = new InMemoryCache()

    cache.writeQuery({
      query: GET_VIDEO_BY_SLUG,
      variables: VIDEO_VARIABLES,
      data: VIDEO_RESULT,
    })
    cache.writeQuery({
      query: GET_VIDEO_BIBLE_PASSAGES,
      variables: { slug: SLUG },
      data: PASSAGE_RESULT,
    })

    const read = cache.readQuery<typeof VIDEO_RESULT>({
      query: GET_VIDEO_BY_SLUG,
      variables: VIDEO_VARIABLES,
    })

    expect(read?.videoBySlug?.slug).toBe(SLUG)
    expect(read?.videoBySlug?.bibleCitations).toHaveLength(1)
  })

  // The mechanism, not only the outcome: without the outer alias the same write
  // takes the read down. If this case ever goes green, the KTD2 comment in
  // queries.ts is describing a hazard that no longer exists.
  it("collapses that same read when the outer alias is removed", () => {
    const cache = new InMemoryCache()

    cache.writeQuery({
      query: GET_VIDEO_BY_SLUG,
      variables: VIDEO_VARIABLES,
      data: VIDEO_RESULT,
    })
    cache.writeQuery({
      query: companionWithoutOuterId(),
      variables: { slug: SLUG },
      data: passageResultWithoutOuterId(),
    })

    const read = cache.readQuery<typeof VIDEO_RESULT>({
      query: GET_VIDEO_BY_SLUG,
      variables: VIDEO_VARIABLES,
    })

    expect(read?.videoBySlug?.slug).toBeUndefined()
  })
})
