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
  it("EXCLUDES series-only selections (childDubLanguages + top-level children)", () => {
    expect(bulkSdl).not.toContain("childDubLanguages")
    // `children` appears only inside the WatchVideo fragment's parents.parent
    // sibling path — never as a top-level operation selection.
    expect(operationOnly(bulkSdl)).not.toContain("children")
  })
})
