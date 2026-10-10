import {
  buildMuxStoryboardUrl,
  getStoryboardWindow,
  hasSeekReachedTarget,
  nextScrubOrigin,
  parseMuxStoryboard,
  seekDirection,
  scrubTimeFromPan,
  timelinePositions,
  type MuxStoryboard,
} from "./tvScrubPreview"

const storyboard: MuxStoryboard = {
  duration: 100,
  tileHeight: 90,
  tileWidth: 160,
  url: "https://image.mux.com/pb/storyboard.webp",
  tiles: Array.from({ length: 10 }, (_, index) => ({
    start: index * 10,
    x: index * 160,
    y: 0,
  })),
}

describe("TV scrub preview", () => {
  it("builds only safe Mux storyboard URLs", () => {
    expect(buildMuxStoryboardUrl("abc_123-Z")).toBe(
      "https://image.mux.com/abc_123-Z/storyboard.json?format=webp",
    )
    expect(buildMuxStoryboardUrl("abc_123-Z", "jpg")).toBe(
      "https://image.mux.com/abc_123-Z/storyboard.json?format=jpg",
    )
    expect(buildMuxStoryboardUrl("../evil")).toBeNull()
  })

  it("parses valid Mux metadata and rejects a foreign sprite host", () => {
    const wire = {
      duration: 100,
      tile_height: 90,
      tile_width: 160,
      tiles: storyboard.tiles,
      url: storyboard.url,
    }
    expect(parseMuxStoryboard(wire)).toEqual(storyboard)
    expect(
      parseMuxStoryboard({ ...wire, url: "https://example.com/sprite.webp" }),
    ).toBeNull()
  })

  it("keeps the selected tile centered when possible", () => {
    const window = getStoryboardWindow(storyboard, 50, 7)
    expect(window.tiles.map((tile) => tile.start)).toEqual([
      20, 30, 40, 50, 60, 70, 80,
    ])
    expect(window.selectedIndex).toBe(3)
  })

  it("maps pan distance to a bounded preview without seeking", () => {
    expect(
      scrubTimeFromPan({ originTime: 50, translationX: 900, duration: 100 }),
    ).toBe(75)
    expect(
      scrubTimeFromPan({ originTime: 5, translationX: -900, duration: 100 }),
    ).toBe(0)
    expect(
      scrubTimeFromPan({ originTime: 95, translationX: 900, duration: 100 }),
    ).toBe(99.5)
  })

  it("continues a second gesture from the current preview target", () => {
    expect(nextScrubOrigin(180, 60)).toBe(180)
    expect(nextScrubOrigin(null, 60)).toBe(60)
  })

  it("does not accept a stale pre-seek time for a backward seek", () => {
    const direction = seekDirection(180, 60)
    expect(direction).toBe("backward")
    expect(
      hasSeekReachedTarget({ currentTime: 180, targetTime: 60, direction }),
    ).toBe(false)
    expect(
      hasSeekReachedTarget({ currentTime: 60.2, targetTime: 60, direction }),
    ).toBe(true)
  })

  it("keeps the existing forward-seek crossing behavior", () => {
    const direction = seekDirection(60, 180)
    expect(
      hasSeekReachedTarget({ currentTime: 60, targetTime: 180, direction }),
    ).toBe(false)
    expect(
      hasSeekReachedTarget({ currentTime: 181, targetTime: 180, direction }),
    ).toBe(true)
  })

  it("moves only the preview thumb while scrubbing", () => {
    expect(
      timelinePositions({ currentTime: 120, previewTime: 300, duration: 600 }),
    ).toEqual({ committedPct: 20, previewPct: 50 })
    expect(
      timelinePositions({ currentTime: 120, previewTime: 60, duration: 600 }),
    ).toEqual({ committedPct: 20, previewPct: 10 })
  })
})
