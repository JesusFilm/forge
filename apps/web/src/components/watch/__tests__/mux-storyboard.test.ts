import { describe, expect, it } from "vitest"

import {
  buildMuxStoryboardJsonUrl,
  findStoryboardTile,
  parseMuxStoryboard,
} from "@/components/watch/mux-storyboard"

const validStoryboard = {
  url: "https://image.mux.com/playback-id-123/storyboard.webp",
  tile_width: 256,
  tile_height: 160,
  duration: 120,
  tiles: [
    { start: 0, x: 0, y: 0 },
    { start: 30, x: 256, y: 0 },
    { start: 60, x: 512, y: 0 },
  ],
}

describe("buildMuxStoryboardJsonUrl", () => {
  it("builds a webp storyboard JSON URL for a playback id", () => {
    expect(buildMuxStoryboardJsonUrl("playback-id-123")).toBe(
      "https://image.mux.com/playback-id-123/storyboard.json?format=webp",
    )
  })

  it("encodes playback ids as path segments", () => {
    expect(buildMuxStoryboardJsonUrl("playback/id 123")).toBe(
      "https://image.mux.com/playback%2Fid%20123/storyboard.json?format=webp",
    )
  })
})

describe("parseMuxStoryboard", () => {
  it("accepts valid storyboard metadata", () => {
    expect(parseMuxStoryboard(validStoryboard)).toEqual({
      duration: 120,
      tileHeight: 160,
      tileWidth: 256,
      tiles: validStoryboard.tiles,
      url: validStoryboard.url,
    })
  })

  it.each([
    ["missing url", { ...validStoryboard, url: "" }],
    ["zero tile width", { ...validStoryboard, tile_width: 0 }],
    ["zero tile height", { ...validStoryboard, tile_height: 0 }],
    ["non-finite duration", { ...validStoryboard, duration: Number.NaN }],
    ["empty tiles", { ...validStoryboard, tiles: [] }],
    [
      "invalid tile start",
      { ...validStoryboard, tiles: [{ start: "0", x: 0, y: 0 }] },
    ],
    [
      "invalid tile x",
      { ...validStoryboard, tiles: [{ start: 0, x: null, y: 0 }] },
    ],
    [
      "invalid tile y",
      { ...validStoryboard, tiles: [{ start: 0, x: 0, y: undefined }] },
    ],
  ])("returns null for %s", (_name, value) => {
    expect(parseMuxStoryboard(value)).toBeNull()
  })
})

describe("findStoryboardTile", () => {
  const storyboard = parseMuxStoryboard(validStoryboard)!

  it("returns the first tile for a time before the first tile", () => {
    expect(findStoryboardTile(storyboard, -10)).toEqual(storyboard.tiles[0])
  })

  it("returns the matching tile for a time inside the tile range", () => {
    expect(findStoryboardTile(storyboard, 45)).toEqual(storyboard.tiles[1])
  })

  it("returns the last tile for a time after the last tile", () => {
    expect(findStoryboardTile(storyboard, 999)).toEqual(storyboard.tiles[2])
  })

  it("returns null for non-finite times", () => {
    expect(findStoryboardTile(storyboard, Number.NaN)).toBeNull()
  })
})
