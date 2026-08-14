/**
 * The series-detail hero decision (U8, R9/R10), plus a SOURCE guard on the two
 * places that consume it. The screen itself reaches Apollo, the downloads
 * provider and expo-router, so a render suite over it would prove the
 * plumbing of everything except this rule; a one-line revert at either call
 * site is what would actually ship the second decoder.
 */

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}

import { showsSeriesPosterHero, showsSeriesTrailer } from "../seriesHero"

const fs = require("node:fs")
const path = require("node:path")

const LOADED = { hasSeries: true, hasTrailer: true, miniPlayerActive: false }

function routeSource(): string {
  return fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "app", "series", "[slug].tsx"),
    "utf8",
  )
}

describe("showsSeriesTrailer", () => {
  it("shows a loaded series' trailer when nothing else holds the decoder", () => {
    expect(showsSeriesTrailer(LOADED)).toBe(true)
  })

  it("suppresses it while a mini player session holds playback", () => {
    // AE14. The trailer's autostart is unconditional, so without this the day
    // the window ships, opening any series over a live session gives two
    // decoders and two audio streams.
    expect(showsSeriesTrailer({ ...LOADED, miniPlayerActive: true })).toBe(
      false,
    )
  })

  it("shows nothing for a series with no trailer, or no series at all", () => {
    expect(showsSeriesTrailer({ ...LOADED, hasTrailer: false })).toBe(false)
    expect(showsSeriesTrailer({ ...LOADED, hasSeries: false })).toBe(false)
  })
})

describe("showsSeriesPosterHero", () => {
  it("takes the trailer's place whenever the trailer is suppressed", () => {
    // The poster hero used to key on the trailer URL alone, which is TRUE
    // while a session floats — so suppressing the trailer alone leaves the
    // screen with no hero, and that reads as a loading bug.
    expect(showsSeriesPosterHero({ ...LOADED, miniPlayerActive: true })).toBe(
      true,
    )
  })

  it("stays out of the way while the trailer plays", () => {
    expect(showsSeriesPosterHero(LOADED)).toBe(false)
  })

  it("covers every case the trailer does not", () => {
    for (const hasSeries of [true, false]) {
      for (const hasTrailer of [true, false]) {
        for (const miniPlayerActive of [true, false]) {
          const input = { hasSeries, hasTrailer, miniPlayerActive }
          expect(showsSeriesPosterHero(input)).toBe(!showsSeriesTrailer(input))
        }
      }
    }
  })
})

describe("the series route consumes both halves", () => {
  it("gates the trailer block on showsSeriesTrailer", () => {
    const source = routeSource()

    expect(source).toContain(
      "const showTrailer = showsSeriesTrailer(heroInput)",
    )
    expect(source).toContain("{showTrailer && (")
  })

  it("gates the poster hero on showsSeriesPosterHero", () => {
    // Not `!showTrailer`: the two halves must read from one module, so a
    // future third reason to suppress the trailer cannot reach one and miss
    // the other.
    const source = routeSource()

    expect(source).toContain("{showsSeriesPosterHero(heroInput) && posterHero}")
  })

  it("has no trailer render site outside that gate", () => {
    // The positive control for the two checks above: they pass on a file that
    // renders a SECOND, ungated VideoPlayer somewhere else.
    const source = routeSource()

    expect(source.split("<VideoPlayer").length - 1).toBe(1)
  })
})
