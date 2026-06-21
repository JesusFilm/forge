import { print } from "graphql"
import type { DocumentNode } from "graphql"

import { GET_SERIES_BY_SLUG, GET_VIDEO_BY_SLUG } from "../queries"

// gql.tada documents are parsed DocumentNode ASTs (no raw source string is
// retained), so we serialize them back with graphql's `print` to make
// string/shape assertions on the selection set.
function asSdl(doc: unknown): string {
  return print(doc as DocumentNode)
}

const seriesSdl = asSdl(GET_SERIES_BY_SLUG)
const bulkSdl = asSdl(GET_VIDEO_BY_SLUG)

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

  // Perf guard (series detail slow render): the screen renders its episode grid
  // from its OWN children and never shows siblings, so the parents → parent →
  // children chain (~208 nodes / ~190KB and ~1.6s of prod resolver time on a
  // Jesus-sized series) must NOT be fetched here. It lives only on the watch
  // screen's full WatchVideo fragment.
  it("EXCLUDES the parents/siblings chain", () => {
    expect(seriesSdl).not.toContain("parents")
  })

  // Perf guard: the series screen only needs a playable `hls` + `language` to
  // pick/swap the trailer. Each dub's `duration` + `muxVideo.playbackId` are
  // player-only — fetching them across ~2,270 dubs is dead weight (bytes + a
  // per-dub muxVideo relation resolution server-side).
  it("KEEPS variants: dubs with hls + language, but EXCLUDES per-dub duration + muxVideo", () => {
    expect(seriesSdl).toContain("variants: dubs")
    expect(seriesSdl).toContain("hls")
    expect(seriesSdl).toMatch(/language\s*\{/)
    expect(seriesSdl).not.toContain("duration")
    expect(seriesSdl).not.toContain("muxVideo")
    expect(seriesSdl).not.toContain("playbackId")
  })

  it("still selects the series-only children + childDubLanguages", () => {
    expect(operationOnly(seriesSdl)).toMatch(/children\s*\{\s*order/)
    expect(seriesSdl).toContain("childDubLanguages")
    expect(seriesSdl).toContain("bcp47")
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
  it("EXCLUDES series-only selections (childDubLanguages + top-level children)", () => {
    expect(bulkSdl).not.toContain("childDubLanguages")
    // `children` appears only inside the WatchVideo fragment's parents.parent
    // sibling path — never as a top-level operation selection.
    expect(operationOnly(bulkSdl)).not.toContain("children")
  })
})
