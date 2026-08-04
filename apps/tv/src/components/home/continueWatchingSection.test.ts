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
    expect(card.metaLabel).toBe("4 min left") // (300-45)/60 = 4.25 rounded
  })

  it("falls back to slug when title missing and omits minutes without duration", () => {
    const section = buildContinueWatchingSection([
      entry({ title: null, durationSeconds: null }),
    ])!
    const card = section.cards[0]!
    expect(card.title).toBe("stunned")
    expect(card.metaLabel).toBeNull()
  })
})
