import {
  googleTvContinuation,
  googleTvDiscoveryCandidates,
  googleTvPoster,
  googleTvPersonalizedModel,
  selectGoogleTvDiscovery,
  DISCOVERY_INTERVAL_MS,
} from "./googleTvHomeContent"
import type { ContinueWatchingEntry } from "./watchEvents/continueWatching"
import type { WatchHomeCard, WatchHomeModel } from "./watchHome/model"

const now = Date.parse("2026-10-02T12:00:00Z")
function card(
  slug = "jesus",
  patch: Partial<WatchHomeCard> = {},
): WatchHomeCard {
  return {
    id: slug,
    sourceId: slug,
    coreId: slug,
    slug,
    title: slug,
    description: "A film",
    label: "Film",
    rawLabel: "FEATURE_FILM",
    metaLabel: null,
    imageUrl: null,
    landscapeImageUrl: "https://image.mux.com/abc/thumbnail.jpg",
    imageAlt: slug,
    muxPlaybackId: null,
    durationSeconds: 3600,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
    ...patch,
  }
}
function model(
  cards = [
    card(),
    card("hope", { rawLabel: "SHORT_FILM", durationSeconds: 120 }),
  ],
): WatchHomeModel {
  return {
    featured: cards,
    sections: [
      {
        id: "hope",
        title: "Stories of Hope",
        eyebrow: "",
        description: null,
        layout: "rail",
        orientation: "horizontal",
        showSequenceNumbers: false,
        isPosterRail: false,
        cards,
      },
    ],
    missingData: [],
  }
}
function entry(
  patch: Partial<ContinueWatchingEntry> = {},
): ContinueWatchingEntry {
  return {
    videoId: "jesus",
    slug: "jesus",
    title: "JESUS",
    imageUrl: null,
    positionSeconds: 120,
    durationSeconds: 3600,
    progress: 120 / 3600,
    updatedAt: new Date(now).toISOString(),
    ...patch,
  }
}

test("builds four concepts from real eligible films and groups", () => {
  expect(
    googleTvDiscoveryCandidates(model()).map((item) => item.concept),
  ).toEqual(["spotlight", "collection", "hope", "journey"])
})
test("personalized source preserves recommendation order and excludes editorial-only cards", () => {
  const catalogue = model([card("editorial"), card("second"), card("first")])
  const items = ["first", "second"].map((videoSlug) => ({
    videoSlug,
    videoTitle: `Recommended ${videoSlug}`,
    imageUrl: "https://image.mux.com/rec/thumbnail.jpg",
    description: "For you",
    durationSeconds: 300,
  }))
  const personalized = googleTvPersonalizedModel(items, catalogue)
  expect(personalized.featured.map((item) => item.slug)).toEqual([
    "first",
    "second",
  ])
  expect(
    googleTvDiscoveryCandidates(personalized)
      .flatMap((item) => item.videos)
      .some((item) => item.slug === "editorial"),
  ).toBe(false)
  expect(googleTvPersonalizedModel([], catalogue).featured).toEqual([])
})
test("unknown recommendation media types are not invented as films", () => {
  expect(
    googleTvPersonalizedModel(
      [
        {
          videoSlug: "unknown",
          videoTitle: "Unknown",
          imageUrl: "https://image.mux.com/rec/thumbnail.jpg",
          description: "",
          durationSeconds: 300,
        },
      ],
      model(),
    ).featured,
  ).toEqual([])
})
test("skips series, unknown duration and missing artwork", () => {
  expect(
    googleTvDiscoveryCandidates(
      model([
        card("series", { rawLabel: "SERIES" }),
        card("unknown", { durationSeconds: null }),
        card("no-art", { landscapeImageUrl: null }),
      ]),
    ),
  ).toEqual([])
})
test("never invents topic or short film candidates", () => {
  const data = model([card()])
  data.sections[0]!.title = "Movies"
  expect(googleTvDiscoveryCandidates(data).map((item) => item.concept)).toEqual(
    ["spotlight"],
  )
})
test("rejects untrusted artwork and normalizes dimensions", () => {
  expect(googleTvPoster("http://image.mux.com/abc/thumbnail.jpg")).toBeNull()
  expect(
    googleTvPoster("https://image.mux.com.evil.test/abc/thumbnail.jpg"),
  ).toBeNull()
  expect(
    googleTvPoster("https://user@image.mux.com/abc/thumbnail.jpg"),
  ).toBeNull()
  expect(
    googleTvPoster("https://image.mux.com/abc/thumbnail.jpg?width=10"),
  ).toContain("width=448&height=252")
})
test("does not change the selected concept before 24 hours", () => {
  const choices = googleTvDiscoveryCandidates(model())
  const previous = { selectedAt: now - 1000, concept: "spotlight" as const }
  expect(
    selectGoogleTvDiscovery(choices, previous, now, () => 0.9)?.rotation,
  ).toEqual(previous)
})
test("avoids repeating the previous concept at next refresh", () => {
  const choices = googleTvDiscoveryCandidates(model())
  expect(
    selectGoogleTvDiscovery(
      choices,
      { selectedAt: now - DISCOVERY_INTERVAL_MS, concept: "spotlight" },
      now,
      () => 0,
    )?.selection.concept,
  ).not.toBe("spotlight")
})
test("persisted shuffled bags visit every eligible theme once and avoid boundary repeats", () => {
  const choices = googleTvDiscoveryCandidates(model())
  let previous: Parameters<typeof selectGoogleTvDiscovery>[1] = null
  const selected: string[] = []
  for (let day = 0; day < 12; day++) {
    const next = selectGoogleTvDiscovery(
      choices,
      previous,
      now + day * DISCOVERY_INTERVAL_MS,
      () => 0,
    )!
    selected.push(next.selection.concept)
    previous = JSON.parse(JSON.stringify(next.rotation))
  }
  for (let offset = 0; offset < 12; offset += 4)
    expect(new Set(selected.slice(offset, offset + 4)).size).toBe(4)
  expect(selected[3]).not.toBe(selected[4])
  expect(selected[7]).not.toBe(selected[8])
})
test("bag removes ineligible themes without repeating consumed ones", () => {
  const choices = googleTvDiscoveryCandidates(model())
  const previous = {
    selectedAt: now - DISCOVERY_INTERVAL_MS,
    concept: "spotlight" as const,
    cycle: ["spotlight", "collection", "hope", "journey"] as const,
    remaining: ["collection", "hope", "journey"] as const,
  }
  const next = selectGoogleTvDiscovery(
    choices.filter((item) => item.concept !== "collection"),
    {
      ...previous,
      cycle: [...previous.cycle],
      remaining: [...previous.remaining],
    },
    now,
    () => 0,
  )!
  expect(next.selection.concept).toBe("hope")
  expect(next.rotation.remaining).toEqual(["journey"])
})
test("handles only one or no eligible concept", () => {
  const choices = googleTvDiscoveryCandidates(model()).slice(0, 1)
  expect(
    selectGoogleTvDiscovery(
      choices,
      { selectedAt: 0, concept: "spotlight" },
      now,
    )?.selection.concept,
  ).toBe("spotlight")
  expect(selectGoogleTvDiscovery([], null, now)).toBeNull()
})
test("only unfinished real viewing appears in continuation", () => {
  expect(googleTvContinuation([entry()], model(), now)[0]).toMatchObject({
    positionMillis: 120000,
    lastEngagementMillis: now,
  })
  expect(
    googleTvContinuation(
      [
        entry({ positionSeconds: 3550 }),
        entry({ positionSeconds: 1 }),
        entry({ positionSeconds: NaN }),
      ],
      model(),
      now,
    ),
  ).toEqual([])
})
test("drops unknown titles, stale timestamps and future timestamps", () => {
  expect(
    googleTvContinuation(
      [
        entry({ slug: "missing" }),
        entry({ updatedAt: "bad" }),
        entry({ updatedAt: new Date(now + 120000).toISOString() }),
        entry({
          updatedAt: new Date(now - 31 * DISCOVERY_INTERVAL_MS).toISOString(),
        }),
      ],
      model(),
      now,
    ),
  ).toEqual([])
})
test("continuation is deduplicated, chronological and capped at five", () => {
  const cards = Array.from({ length: 7 }, (_, i) => card(`film-${i}`))
  const entries = cards.map((item, i) =>
    entry({
      slug: item.slug!,
      updatedAt: new Date(now - i * 1000).toISOString(),
    }),
  )
  expect(
    googleTvContinuation(
      [...entries.reverse(), entries[0]!],
      model(cards),
      now,
    ).map((item) => item.slug),
  ).toEqual(["film-0", "film-1", "film-2", "film-3", "film-4"])
})
