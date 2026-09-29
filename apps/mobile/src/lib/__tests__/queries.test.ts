import { print } from "graphql"
import type { DocumentNode } from "graphql"

import * as queries from "../queries"
import { localeQueryVariables } from "../videoText"
import {
  EXPLORE_CLIP_CANDIDATES,
  EXPLORE_INVENTORY,
  GET_SERIES_BY_SLUG,
  GET_VIDEO_BIBLE_PASSAGES,
  GET_VIDEO_BY_SLUG,
} from "../queries"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const seriesSdl = asSdl(GET_SERIES_BY_SLUG)
const bulkSdl = asSdl(GET_VIDEO_BY_SLUG)
const passagesSdl = asSdl(GET_VIDEO_BIBLE_PASSAGES)

// The printed document is the operation followed by its fragment definitions.
// Slicing off the fragments isolates an operation's OWN selections.
function operationOnly(sdl: string): string {
  const fragmentStart = sdl.indexOf("fragment ")
  return fragmentStart === -1 ? sdl : sdl.slice(0, fragmentStart)
}

describe("GET_SERIES_BY_SLUG (lean series detail)", () => {
  it("spreads the lean SeriesWatchVideo fragment, not the full WatchVideo", () => {
    expect(operationOnly(seriesSdl)).toContain("...SeriesWatchVideo")
    expect(operationOnly(seriesSdl)).not.toContain("...WatchVideo")
  })

  // Perf guard (series detail slow render): screen renders its episode grid from
  // its OWN children, never siblings, so the parents → parent → children chain
  // (~208 nodes/~190KB, ~1.6s prod resolver time) must stay on the watch screen only.
  it("EXCLUDES the parents/siblings chain", () => {
    expect(seriesSdl).not.toContain("parents")
  })

  // Perf guard: series screen only needs `hls` + `language` to pick/swap the
  // trailer. Per-dub `duration` + `muxVideo.playbackId` are player-only — dead
  // weight across ~2,270 dubs (bytes + server-side per-dub muxVideo resolution).
  // Word-boundary (not substring): U1 adds the lightweight, server-derived
  // `durationSeconds` scalar on `children.child` (one row per episode, not per
  // dub) — a substring match would wrongly flag it as the forbidden per-dub field.
  it("KEEPS variants: dubs with hls + language, but EXCLUDES per-dub duration + muxVideo", () => {
    expect(seriesSdl).toContain("variants: dubs")
    expect(seriesSdl).toContain("hls")
    expect(seriesSdl).toMatch(/language\s*\{/)
    expect(seriesSdl).not.toMatch(/\bduration\b/)
    expect(seriesSdl).not.toContain("muxVideo")
    expect(seriesSdl).not.toContain("playbackId")
  })

  it("still selects the series-only children + childDubLanguages", () => {
    expect(operationOnly(seriesSdl)).toMatch(/children\s*\{\s*order/)
    expect(seriesSdl).toContain("childDubLanguages")
    expect(seriesSdl).toContain("bcp47")
  })

  // U1: the episode grid needs the runtime alongside `order` to persist series
  // ordering/duration on offline records. Video-level scalar (one row per
  // episode), not the forbidden per-dub `duration` the guard above excludes.
  it("selects durationSeconds on each episode (U1)", () => {
    expect(operationOnly(seriesSdl)).toMatch(/children\s*\{\s*order/)
    expect(seriesSdl).toContain("durationSeconds")
  })
})

describe("GET_VIDEO_BY_SLUG (watch screen) keeps the full fragment", () => {
  // The watch screen still needs siblings (Up Next) + player-only dub fields
  // (duration, muxVideo.playbackId), so the trims above must NOT leak here.
  it("KEEPS the parents/siblings chain and player-only dub fields", () => {
    expect(bulkSdl).toContain("parents")
    expect(bulkSdl).toContain("duration")
    expect(bulkSdl).toContain("playbackId")
  })

  // ...and does NOT carry the series-only selections (mirrors the TV
  // "shared fragment stays lean" guard): the watch query must stay focused.
  // U6: the Bible reader picks its default translation from the audio
  // language's ISO 639-3 code, and the catalog keys languages by that code.
  it("SELECTS iso3 on each dub's language", () => {
    expect(bulkSdl).toMatch(
      /variants: dubs\s*\{[^}]*language\s*\{[^}]*\biso3\b/,
    )
  })

  // feat-553 U12: "Read full passage" opens the native reader at the cited
  // book, which it keys by USFM code. Admin sends the book as an OSIS id.
  it("SELECTS osisId and paratextAbbreviation on each citation's book", () => {
    expect(bulkSdl).toMatch(
      /bibleCitations\s*\{[^}]*bibleBook\s*\{[^}]*\bosisId\b[^}]*\bparatextAbbreviation\b/,
    )
  })

  it("EXCLUDES series-only selections (childDubLanguages + top-level children)", () => {
    expect(bulkSdl).not.toContain("childDubLanguages")
    // `children` appears only inside the WatchVideo fragment's parents.parent
    // sibling path — never as a top-level operation selection.
    expect(operationOnly(bulkSdl)).not.toContain("children")
  })
})

// ── U2. Bible passage isolation guard (KTD1, KTD2) ─────────────────────────
//
// These assertions run over the FULL printed document, never `operationOnly`:
// `passage` would be re-inlined inside the WatchVideo / SeriesWatchVideo
// FRAGMENT, which `operationOnly` slices off — an assertion built on it would
// sit in the discarded region and pass whether the field is there or not.
describe("Bible passages stay off the player-gating queries", () => {
  it("EXCLUDES passage from the watch-screen operation", () => {
    expect(bulkSdl).not.toMatch(/\bpassage\b/)
  })

  it("EXCLUDES passage from the series operation", () => {
    expect(seriesSdl).not.toMatch(/\bpassage\b/)
  })

  // Positive control. Without it the two negatives above pass vacuously the day
  // the field is renamed on admin's side.
  it("SELECTS passage on the companion operation", () => {
    expect(passagesSdl).toMatch(/\bpassage\s*\{/)
    expect(passagesSdl).toContain("versionAbbreviation")
  })

  // KTD2. The OUTER alias is what lets the cache normalize the video; without
  // it a successful passage read replaces the shared reference and takes the
  // player-gating read down with it. `biblePassages.test.ts` pins that
  // mechanism against a real InMemoryCache; this pins the selection itself.
  it("SELECTS documentId on videoBySlug itself and on each citation", () => {
    expect(passagesSdl).toMatch(
      /videoBySlug\(slug: \$slug\)\s*\{\s*documentId: id/,
    )
    expect(passagesSdl).toMatch(/bibleCitations\s*\{\s*documentId: id/)
  })
})

// ── Explore clips feed (feat-552 U5, KTD6) ──────────────────────────────────

describe("EXPLORE_INVENTORY (the lean candidate pool)", () => {
  const sdl = asSdl(EXPLORE_INVENTORY)

  it("reads the language inventory with a limit", () => {
    expect(sdl).toContain("query ExploreInventory")
    expect(sdl).toContain(
      "watchLanguageInventory(languageSlug: $languageSlug, limit: $limit)",
    )
  })

  it("selects the three buckets and the lean row fields", () => {
    for (const bucket of [
      "audioCollections",
      "audioVideos",
      "subtitleOnlyVideos",
    ]) {
      expect(sdl).toMatch(new RegExp(`${bucket}\\s*\\{`))
    }
    for (const field of [
      "id",
      "coreId",
      "slug",
      "label",
      "availability",
      "durationSeconds",
      "muxPlaybackId",
      "watchLanguageSlug",
      "title",
      "description",
    ]) {
      expect(sdl).toMatch(new RegExp(`\\b${field}\\b`))
    }
  })

  // U1 measured English at limit 1,000 as 665 KB decoded with exactly the
  // fields above. `imageUrl` adds 20%, and the veil takes its authored image
  // from the hydration instead, so the pool never pays for it.
  it("stays lean: no image URL, no promoted bucket, no parent fields", () => {
    expect(sdl).not.toMatch(/\bimageUrl\b/)
    expect(sdl).not.toMatch(/\bpromoted\b/)
    expect(sdl).not.toMatch(/\bparent(Slug|Title|Order)\b/)
  })
})

describe("EXPLORE_CLIP_CANDIDATES (queued-candidate hydration)", () => {
  const sdl = asSdl(EXPLORE_CLIP_CANDIDATES)

  // One public root field per request: admin counts 60 accesses per minute
  // per root field, and each alias costs one (U1).
  it("hydrates several candidates through one watchHomeVideos access", () => {
    expect(sdl).toContain("query ExploreClipCandidates")
    expect(sdl).toContain("watchHomeVideos(coreIds: $coreIds)")
    expect(sdl.match(/watchHomeVideos\(/g)).toHaveLength(1)
  })

  it("asks for one preferred dub in the candidates' audio language", () => {
    expect(sdl).toContain(
      "preferredPlayableDub(languageSlug: $audioLanguageSlug)",
    )
  })

  // U21 keys its stored verdicts on the Video Edition id.
  it("selects the edition id and its subtitle tracks", () => {
    expect(sdl).toMatch(/videoEdition\s*\{\s*documentId: id/)
    expect(sdl).toMatch(/subtitles\s*\{/)
    for (const field of ["vttSrc", "primary", "aiGenerated"]) {
      expect(sdl).toMatch(new RegExp(`\\b${field}\\b`))
    }
  })

  it("never selects dubs in bulk", () => {
    expect(sdl).not.toMatch(/\bdubs\b/)
    expect(sdl).not.toMatch(/\bvariants\b/)
    expect(sdl).not.toMatch(/\bdownloads\b/)
  })

  it("selects videoStill beside images, and never the bare url", () => {
    expect(sdl).toMatch(/images\s*\{[^}]*\bvideoStill\b[^}]*\}/)
    expect(sdl).not.toMatch(/images\s*\{[^}]*\burl\b[^}]*\}/)
  })
})

describe("every Explore operation that selects images selects videoStill", () => {
  it.each([
    ["EXPLORE_INVENTORY", EXPLORE_INVENTORY],
    ["EXPLORE_CLIP_CANDIDATES", EXPLORE_CLIP_CANDIDATES],
  ])("%s", (_name, doc) => {
    const sdl = asSdl(doc)
    const blocks = sdl.match(/images\s*\{[^}]*\}/g) ?? []
    for (const block of blocks) expect(block).toContain("videoStill")
  })
})

// ── U6. Video text in the UI locale (KTD10) ─────────────────────────────────

/** Every exported GraphQL document in queries.ts, by export name. */
function exportedDocuments(): [string, DocumentNode][] {
  return Object.entries(queries).filter(
    (entry): entry is [string, DocumentNode] => {
      const value = entry[1] as { kind?: unknown } | null
      return value != null && value.kind === "Document"
    },
  )
}

/** A document by export name; fails loudly when the export is missing. */
function documentNamed(name: string): string {
  const doc = (queries as Record<string, unknown>)[name]
  expect({ name, exported: doc != null }).toEqual({ name, exported: true })
  return asSdl(doc)
}

describe("the heavy video documents are language-free (KTD10)", () => {
  // A UI language change must never refetch the ~9.5 MB dub list, so the
  // player-gating documents take the slug and nothing else.
  it.each([
    ["GET_VIDEO_BY_SLUG", bulkSdl],
    ["GET_SERIES_BY_SLUG", seriesSdl],
  ])("%s has no language variable and no text rows", (_name, sdl) => {
    expect(sdl).not.toMatch(/\$locale\b/)
    expect(sdl).not.toMatch(/\$textSlug\b/)
    expect(sdl).not.toMatch(/\blocales\s*\(/)
    expect(operationOnly(sdl)).toMatch(/\(\$slug: String!\)/)
  })
})

describe("GET_VIDEO_TEXT and GET_SERIES_TEXT (the text companions)", () => {
  it("GET_VIDEO_TEXT reads the video, its parent, and the siblings", () => {
    const sdl = documentNamed("GET_VIDEO_TEXT")
    expect(sdl).toContain(
      "query GetVideoText($slug: String!, $textSlug: String!)",
    )
    // documentId at every level, as the Bible passage companion needs it.
    expect(sdl).toMatch(/videoBySlug\(slug: \$slug\)\s*\{\s*documentId: id/)
    expect(sdl).toMatch(/parent\s*\{\s*documentId: id/)
    expect(sdl).toMatch(/child\s*\{\s*documentId: id/)
    expect(sdl).toContain("...VideoText")
    expect(sdl.match(/\.\.\.VideoTitleText\b/g)).toHaveLength(2)
    expect(sdl).not.toMatch(/\bdubs\b/)
  })

  // The watch read selects `children { child }` on the parent. A text write
  // with another relation shape would replace that list under it.
  it("GET_VIDEO_TEXT keeps the watch document's relation shape", () => {
    const sdl = operationOnly(documentNamed("GET_VIDEO_TEXT"))
    expect(sdl).toMatch(/parents\s*\{\s*parent\s*\{/)
    expect(sdl).toMatch(/children\s*\{\s*child\s*\{/)
    expect(sdl).not.toMatch(/\border\b/)
  })

  it("GET_SERIES_TEXT keeps the series document's `children { order child }`", () => {
    const sdl = documentNamed("GET_SERIES_TEXT")
    expect(sdl).toContain(
      "query GetSeriesText($slug: String!, $textSlug: String!)",
    )
    expect(sdl).toMatch(/videoBySlug\(slug: \$slug\)\s*\{\s*documentId: id/)
    expect(operationOnly(sdl)).toMatch(
      /children\s*\{\s*order\s*child\s*\{\s*documentId: id/,
    )
    expect(operationOnly(sdl)).not.toContain("parents")
    expect(sdl).not.toMatch(/\bdubs\b/)
  })
})

describe("one argument set for every locales(...) selection (KTD10)", () => {
  const ALLOWED = new Set([
    "locales(languageSlug: $textSlug)",
    'locales(languageSlug: "english")',
  ])

  it("every exported document spells locales(...) only the two shared ways", () => {
    const seen: string[] = []
    for (const [, doc] of exportedDocuments()) {
      for (const call of asSdl(doc).match(/\blocales\([^)]*\)/g) ?? []) {
        seen.push(call)
      }
    }
    // Positive control: the scan found the shared fragments.
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.filter((call) => !ALLOWED.has(call))).toEqual([])
  })

  it("aliases the English row as englishLocales wherever the UI row is read", () => {
    for (const [name, doc] of exportedDocuments()) {
      const sdl = asSdl(doc)
      const ui = sdl.match(/\blocales\(languageSlug: \$textSlug\)/g) ?? []
      const english =
        sdl.match(/englishLocales: locales\(languageSlug: "english"\)/g) ?? []
      expect({ name, english: english.length }).toEqual({
        name,
        english: ui.length,
      })
    }
  })

  it("flags a hand-built locale pair (negative control)", () => {
    const call = "locales(locale: $locale, languageSlug: $languageSlug)"
    expect(ALLOWED.has(call)).toBe(false)
  })
})

describe("the homepage and Experience documents ask for the UI locale and en", () => {
  it("GET_WATCH_SETTING asks for both homepages, skipping en under en", () => {
    const sdl = documentNamed("GET_WATCH_SETTING")
    expect(sdl).toContain("watchSetting(locale: $locale)")
    expect(sdl).toContain(
      'englishWatchSetting: watchSetting(locale: "en") @skip(if: $isEnglish)',
    )
  })

  it("GET_EXPERIENCE_BY_SLUG asks for both Experiences, skipping en under en", () => {
    const sdl = documentNamed("GET_EXPERIENCE_BY_SLUG")
    expect(sdl).toContain("experienceBySlug(locale: $locale, slug: $slug)")
    expect(sdl).toContain(
      'englishExperience: experienceBySlug(locale: "en", slug: $slug) @skip(if: $isEnglish)',
    )
  })

  it("localeQueryVariables marks only en as English", () => {
    expect(localeQueryVariables("en")).toEqual({
      locale: "en",
      isEnglish: true,
    })
    expect(localeQueryVariables("es")).toEqual({
      locale: "es",
      isEnglish: false,
    })
  })
})
