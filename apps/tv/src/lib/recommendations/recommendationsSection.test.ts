import {
  RECOMMENDATIONS_LIMIT,
  RECOMMENDATIONS_SECTION_ID,
  buildRecommendationsSection,
  pickRecommendationSeed,
  type RecommendationRow,
} from "./recommendationsSection"
import type { ContinueWatchingEntry } from "../watchEvents/continueWatching"

function shelfEntry(
  overrides: Partial<ContinueWatchingEntry> = {},
): ContinueWatchingEntry {
  return {
    videoId: "seed-1",
    slug: "the-savior",
    title: "The Savior",
    imageUrl: null,
    positionSeconds: 100,
    durationSeconds: 1000,
    progress: 0.1,
    updatedAt: "2026-08-14T00:00:00.000Z",
    ...overrides,
  }
}

function row(overrides: Partial<RecommendationRow> = {}): RecommendationRow {
  return {
    videoId: "rec-1",
    videoSlug: "day-6-speak-about-jesus",
    videoTitle: "Day 6: Speak About Jesus",
    playbackId: "abc123",
    ...overrides,
  }
}

describe("pickRecommendationSeed", () => {
  it("returns null for an empty shelf — nothing watched, no rail", () => {
    expect(pickRecommendationSeed([])).toBeNull()
  })

  it("picks the most recently watched entry", () => {
    const seed = pickRecommendationSeed([
      shelfEntry({ videoId: "older", updatedAt: "2026-08-01T00:00:00.000Z" }),
      shelfEntry({ videoId: "newest", updatedAt: "2026-08-14T00:00:00.000Z" }),
      shelfEntry({ videoId: "middle", updatedAt: "2026-08-07T00:00:00.000Z" }),
    ])
    // Chosen by stamp, NOT by position: a caller handing over an unsorted list
    // must still get the freshest seed.
    expect(seed).toEqual({ videoId: "newest", title: "The Savior" })
  })

  it("falls back to the slug when the entry has no title", () => {
    expect(pickRecommendationSeed([shelfEntry({ title: null })])).toEqual({
      videoId: "seed-1",
      title: "the-savior",
    })
  })

  it("skips entries with no videoId — there is nothing to seed on", () => {
    expect(
      pickRecommendationSeed([
        shelfEntry({ videoId: "", updatedAt: "2026-12-31T00:00:00.000Z" }),
        shelfEntry({ videoId: "real", updatedAt: "2026-01-01T00:00:00.000Z" }),
      ]),
    ).toMatchObject({ videoId: "real" })
  })
})

describe("buildRecommendationsSection", () => {
  const seed = { videoId: "seed-1", title: "The Savior" }

  it("titles the rail with the seed and labels it Because you watched", () => {
    const section = buildRecommendationsSection(seed, [row()])
    expect(section).not.toBeNull()
    expect(section!.id).toBe(RECOMMENDATIONS_SECTION_ID)
    expect(section!.eyebrow).toBe("Because you watched")
    expect(section!.title).toBe("The Savior")
  })

  it.each([
    ["there is no seed", null, [row()]],
    ["admin returned no rows", seed, []],
  ])("returns null when %s", (_label, seedInput, rows) => {
    expect(buildRecommendationsSection(seedInput, rows)).toBeNull()
  })

  it("returns null when every row is unusable, rather than an empty rail", () => {
    // Reachable: admin soft-swallows an un-embedded seed to [], and a row
    // without a slug has nowhere to route.
    expect(
      buildRecommendationsSection(seed, [
        row({ videoSlug: "" }),
        row({ videoId: "" }),
      ]),
    ).toBeNull()
  })

  it("never recommends the seed back to the viewer", () => {
    const section = buildRecommendationsSection(seed, [
      row({ videoId: "seed-1" }),
      row({ videoId: "other" }),
    ])
    expect(section!.cards.map((c) => c.sourceId)).toEqual(["other"])
  })

  it("derives card art from the playback id, since admin sends imageUrl null", () => {
    const section = buildRecommendationsSection(seed, [
      row({ playbackId: "pb-xyz" }),
    ])
    expect(section!.cards[0]!.imageUrl).toBe(
      "https://image.mux.com/pb-xyz/thumbnail.jpg?width=1920&height=1080&fit_mode=smartcrop",
    )
    // Landscape and card art are the same 16:9 frame here.
    expect(section!.cards[0]!.landscapeImageUrl).toBe(
      section!.cards[0]!.imageUrl,
    )
  })

  it("leaves art null for an unusable playback id instead of a broken URL", () => {
    const section = buildRecommendationsSection(seed, [
      row({ playbackId: "not a playback id" }),
    ])
    expect(section!.cards[0]!.imageUrl).toBeNull()
  })

  it("routes every card to /watch — recommendations are single videos", () => {
    const section = buildRecommendationsSection(seed, [row()])
    // rawLabel null is what sends a card to /watch rather than /series.
    expect(section!.cards[0]!.rawLabel).toBeNull()
  })

  it("caps the rail at RECOMMENDATIONS_LIMIT", () => {
    const rows = Array.from({ length: RECOMMENDATIONS_LIMIT + 6 }, (_, i) =>
      row({ videoId: `rec-${i}` }),
    )
    expect(buildRecommendationsSection(seed, rows)!.cards).toHaveLength(
      RECOMMENDATIONS_LIMIT,
    )
  })

  it("drops unusable rows BEFORE the cap, so the rail still fills", () => {
    // Filter-then-slice, not slice-then-filter: leading junk must not eat the
    // rail's capacity.
    const rows = [
      ...Array.from({ length: 4 }, () => row({ videoSlug: "" })),
      ...Array.from({ length: RECOMMENDATIONS_LIMIT }, (_, i) =>
        row({ videoId: `good-${i}` }),
      ),
    ]
    const section = buildRecommendationsSection(seed, rows)
    expect(section!.cards).toHaveLength(RECOMMENDATIONS_LIMIT)
    expect(section!.cards.every((c) => c.sourceId.startsWith("good-"))).toBe(
      true,
    )
  })
})
