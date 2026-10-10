import { print } from "graphql"
import type { DocumentNode } from "graphql"

import {
  GET_VIDEO_BY_SLUG,
  GET_SERIES_BY_SLUG,
  GET_SERIES_LANGUAGES,
  GET_VIDEO_DUB,
  watchVideoFragment,
  watchDubMediaFragment,
} from "./videoQueries"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const bulkSdl = asSdl(GET_VIDEO_BY_SLUG)
const seriesSdl = asSdl(GET_SERIES_BY_SLUG)
const dubSdl = asSdl(GET_VIDEO_DUB)
const languagesSdl = asSdl(GET_SERIES_LANGUAGES)
const bulkFragmentSdl = asSdl(watchVideoFragment)
const dubFragmentSdl = asSdl(watchDubMediaFragment)

// Slice off the trailing fragment definitions to isolate an operation's OWN
// selections, so absence assertions ("no dubs inside children") aren't defeated
// by the shared WatchVideo fragment legitimately selecting `variants: dubs`.
function operationOnly(sdl: string): string {
  const fragmentStart = sdl.indexOf("fragment ")
  return fragmentStart === -1 ? sdl : sdl.slice(0, fragmentStart)
}

const seriesOpSdl = operationOnly(seriesSdl)
const bulkOpSdl = operationOnly(bulkSdl)

describe("GET_VIDEO_BY_SLUG (lean bulk video + dub list)", () => {
  it("queries the videoBySlug root field", () => {
    expect(bulkSdl).toContain("videoBySlug")
  })

  it("passes slug to videoBySlug but NOT locale (locale is nested-only)", () => {
    // videoBySlug itself takes only slug; $locale is consumed by nested
    // locales(locale:) selections, never as a videoBySlug argument.
    expect(bulkSdl).toMatch(/videoBySlug\(slug:\s*\$slug\)/)
    expect(bulkSdl).not.toMatch(/videoBySlug\([^)]*locale/)
  })

  it("declares both $locale and $slug variables", () => {
    expect(bulkSdl).toContain("$locale: String!")
    expect(bulkSdl).toContain("$slug: String!")
  })

  it("selects the lean per-dub fields under variants: dubs", () => {
    expect(bulkSdl).toContain("variants: dubs")
    for (const field of [
      "documentId: id",
      "slug",
      "published",
      "hls",
      "duration",
      "playbackId",
    ]) {
      expect(bulkSdl).toContain(field)
    }
  })

  it("selects siblings via parents.parent.children.child", () => {
    expect(bulkSdl).toContain("parents")
    expect(bulkSdl).toContain("parent")
    expect(bulkSdl).toContain("children")
    expect(bulkSdl).toContain("child")
    // Hover-preview: each sibling child carries the best-dub muxPlaybackId (U6).
    expect(bulkSdl).toContain("muxPlaybackId")
  })

  it("selects study questions and bible citations (incl. bibleBook name)", () => {
    expect(bulkSdl).toContain("studyQuestions")
    expect(bulkSdl).toContain("bibleCitations")
    expect(bulkSdl).toContain("bibleBook")
  })

  it("consumes $locale only via nested locales(locale: $locale) selections", () => {
    expect(bulkSdl).toMatch(/locales\(locale:\s*\$locale\)/)
  })

  // Payload-regression guard (covers AE6): inlining per-dub media here is what
  // blew up the birth-of-jesus payload to ~9.5MB. These MUST stay out of the
  // bulk fragment — they belong to the lazy GET_VIDEO_DUB query only.
  it("EXCLUDES per-dub downloads from the bulk selection", () => {
    expect(bulkSdl).not.toContain("downloads")
    expect(bulkFragmentSdl).not.toContain("downloads")
  })

  it("EXCLUDES videoEdition.subtitles from the bulk selection", () => {
    expect(bulkSdl).not.toContain("videoEdition")
    expect(bulkSdl).not.toContain("subtitles")
    expect(bulkFragmentSdl).not.toContain("videoEdition")
    expect(bulkFragmentSdl).not.toContain("subtitles")
  })
})

describe("GET_SERIES_BY_SLUG (series detail: lean — own children, no language union)", () => {
  it("queries videoBySlug(slug:) and spreads the lean SeriesWatchVideo fragment", () => {
    expect(seriesOpSdl).toMatch(/videoBySlug\(slug:\s*\$slug\)/)
    expect(seriesOpSdl).toContain("...SeriesWatchVideo")
    // The series screen does NOT use the full WatchVideo fragment — that one
    // carries the watch screen's sibling chain + player-only per-dub fields.
    expect(seriesOpSdl).not.toContain("...WatchVideo")
  })

  // Perf guard (TV series 10s render): the series screen renders EpisodeRail from
  // its OWN children, never siblings, so the parents→parent→children chain (~208
  // nodes / ~190KB / ~1.6s prod resolver) stays on the watch screen only.
  it("EXCLUDES the parents/siblings chain", () => {
    expect(seriesSdl).not.toContain("parents")
  })

  // Perf guard: the series screen only needs `hls` + `language` to swap the
  // trailer. Per-dub `duration` + `muxVideo.playbackId` are player-only; fetching
  // them across ~2,270 dubs is dead weight (bytes + per-dub muxVideo resolution).
  it("KEEPS variants: dubs with hls + language, but EXCLUDES per-dub duration + muxVideo", () => {
    expect(seriesSdl).toContain("variants: dubs")
    expect(seriesSdl).toContain("hls")
    expect(seriesSdl).toMatch(/language\s*\{/)
    expect(seriesSdl).not.toContain("duration")
    // No per-dub muxVideo projection. The child scalar `muxPlaybackId` (asserted
    // below) is a separate cheap field and contains "playbackId", so guard the
    // muxVideo block itself, not the raw substring.
    expect(seriesSdl).not.toContain("muxVideo")
  })

  it("selects the series' own children with the relation `order` field", () => {
    expect(seriesOpSdl).toMatch(/children\s*\{\s*order/)
    expect(seriesOpSdl).toContain("child")
  })

  it("selects episode card fields on each child (slug, label, locales, images, muxPlaybackId)", () => {
    for (const field of [
      "slug",
      "label",
      "languageSlug",
      "title",
      "description",
      "imageAlt",
      "mobileCinematicHigh",
      "muxPlaybackId",
    ]) {
      expect(seriesOpSdl).toContain(field)
    }
  })

  // U1 over-fetch guard: childDubLanguages — the ~835 KB server aggregation —
  // moved to the lazy GET_SERIES_LANGUAGES query. It must NOT creep back onto the
  // initial fetch, or the series screen pays the aggregation on first paint again.
  it("does NOT select childDubLanguages (moved to GET_SERIES_LANGUAGES)", () => {
    expect(seriesSdl).not.toContain("childDubLanguages")
  })

  // Payload guard: the series' own dub list comes from the WatchVideo spread
  // (the trailer). Projecting dubs PER CHILD would multiply the 9.5MB incident
  // by the episode count — the children selection must stay card-lean.
  it("EXCLUDES dubs/variants from the children selection", () => {
    expect(seriesOpSdl).not.toContain("dubs")
    expect(seriesOpSdl).not.toContain("variants")
  })

  it("EXCLUDES per-dub media everywhere in the document", () => {
    expect(seriesSdl).not.toContain("downloads")
    expect(seriesSdl).not.toContain("subtitles")
  })
})

describe("GET_SERIES_LANGUAGES (lazy secondary language union — U1)", () => {
  it("selects childDubLanguages (slug, name, bcp47) on videoBySlug", () => {
    expect(languagesSdl).toMatch(/videoBySlug\(slug:\s*\$slug\)/)
    expect(languagesSdl).toContain("childDubLanguages")
    for (const field of ["slug", "name", "bcp47"]) {
      expect(languagesSdl).toContain(field)
    }
  })

  // Same Video entity (documentId: id) so the union normalizes alongside the lean
  // record; only $slug is needed (name is a JSON locale map resolved client-side).
  it("selects the id and declares only $slug", () => {
    expect(languagesSdl).toContain("documentId: id")
    expect(languagesSdl).toContain("$slug: String!")
    expect(languagesSdl).not.toContain("$locale")
  })

  it("carries no episode or dub weight (just the union)", () => {
    expect(languagesSdl).not.toContain("variants")
    expect(languagesSdl).not.toContain("children")
  })
})

describe("shared fragment stays lean (series-only fields never leak in)", () => {
  // GET_SERIES_BY_SLUG's extra selections live on the operation, not on
  // watchVideoFragment — otherwise every single-video fetch would pay for them.
  it("watchVideoFragment selects no childDubLanguages", () => {
    expect(bulkFragmentSdl).not.toContain("childDubLanguages")
  })

  it("GET_VIDEO_BY_SLUG adds own children to the operation, never to the fragment", () => {
    expect(bulkSdl).not.toContain("childDubLanguages")
    expect(bulkOpSdl).toContain("...WatchVideo")
    expect(bulkOpSdl).toContain("children")
    // The fragment's ONE `children` is the parents -> parent -> children sibling
    // chain. A second occurrence means the chapter selection leaked in, and the
    // series query — which reuses this fragment — would then pay for it twice.
    expect(bulkFragmentSdl.match(/\bchildren\b/g) ?? []).toHaveLength(1)
    expect(bulkFragmentSdl).toContain("parents")
  })

  // The chapter rail reads these through buildChildren, which is shared with the
  // series episode rail — a field dropped here silently empties the rail.
  it("GET_VIDEO_BY_SLUG's own children select the fields the child card renders", () => {
    for (const field of [
      "order",
      "slug",
      "label",
      "muxPlaybackId",
      "title",
      "description",
      "imageAlt",
      "url",
      "thumbnail",
      "mobileCinematicHigh",
      "mobileCinematicLow",
    ]) {
      expect(bulkOpSdl).toContain(field)
    }
  })
})

describe("GET_VIDEO_DUB (lazy per-dub media)", () => {
  it("queries the videoDub(id:) root field", () => {
    expect(dubSdl).toContain("videoDub")
    expect(dubSdl).toMatch(/videoDub\(id:\s*\$id\)/)
  })

  it("declares the $id: ID! variable", () => {
    expect(dubSdl).toContain("$id: ID!")
  })

  it("INCLUDES per-dub downloads (quality, size, url)", () => {
    expect(dubSdl).toContain("downloads")
    for (const field of ["quality", "size", "url"]) {
      expect(dubSdl).toContain(field)
    }
  })

  it("INCLUDES videoEdition.subtitles (vttSrc, primary, aiGenerated)", () => {
    expect(dubSdl).toContain("videoEdition")
    expect(dubSdl).toContain("subtitles")
    for (const field of ["vttSrc", "primary", "aiGenerated"]) {
      expect(dubSdl).toContain(field)
    }
    expect(dubFragmentSdl).toContain("subtitles")
  })
})
