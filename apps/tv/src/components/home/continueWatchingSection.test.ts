import { buildContinueWatchingSection } from "./continueWatchingSection"
import type { ContinueWatchingEntry } from "../../lib/watchEvents/continueWatching"

function entry(
  overrides: Partial<ContinueWatchingEntry> = {},
): ContinueWatchingEntry {
  return {
    videoId: "video-1",
    slug: "stunned",
    title: "Stunned",
    imageUrl: "https://img.example/stunned.jpg",
    positionSeconds: 45,
    durationSeconds: 300,
    progress: 0.15,
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  }
}

describe("buildContinueWatchingSection", () => {
  it("returns null for an empty shelf", () => {
    expect(buildContinueWatchingSection([])).toBeNull()
  })

  it("builds a landscape rail with /watch-routable cards", () => {
    const section = buildContinueWatchingSection([entry()])!
    expect(section.id).toBe("continue-watching")
    expect(section.isPosterRail).toBe(false)
    const card = section.cards[0]!
    expect(card.slug).toBe("stunned")
    expect(card.rawLabel).toBeNull() // routes to /watch, never /series
    expect(card.landscapeImageUrl).toBe("https://img.example/stunned.jpg")
    // The progress bar carries remaining-time meaning; no chip on shelf cards.
    expect(card.metaLabel).toBeNull()
  })

  it("falls back to slug when the title is missing", () => {
    const section = buildContinueWatchingSection([
      entry({ title: null, durationSeconds: null }),
    ])!
    const card = section.cards[0]!
    expect(card.title).toBe("stunned")
    expect(card.durationSeconds).toBeNull()
  })
})

describe("progress bar data", () => {
  it("clamps progressFraction to 0..1 and omits non-positive values", () => {
    expect(
      buildContinueWatchingSection([entry({ progress: 0.4 })])!.cards[0]!
        .progressFraction,
    ).toBeCloseTo(0.4)
    expect(
      buildContinueWatchingSection([entry({ progress: 1.7 })])!.cards[0]!
        .progressFraction,
    ).toBe(1)
    expect(
      buildContinueWatchingSection([entry({ progress: null })])!.cards[0]!
        .progressFraction,
    ).toBeNull()
  })
})

describe("card chrome", () => {
  it("leaves the kind line empty so HomeCard omits it", () => {
    const section = buildContinueWatchingSection([entry()])!
    expect(section.cards[0]!.label).toBe("")
    expect(section.title).toBe("Continue Watching")
  })
})

describe("static thumbnail", () => {
  it("carries no playback id, so a focused card never animates a preview", () => {
    const card = buildContinueWatchingSection([entry()])!.cards[0]!
    expect(card.muxPlaybackId).toBeNull()
  })
})
