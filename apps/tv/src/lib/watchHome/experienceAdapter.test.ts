import { isSeriesSearchResult } from "../isSeriesRecord"
import {
  buildWatchHomeSectionsFromExperience,
  experienceItemCoreIds,
  mapVariant,
  resolveWatchHomeModel,
} from "./experienceAdapter"
import type {
  WatchHomeModel,
  WatchHomeSection,
  WatchHomeVideoInput,
} from "./model"

// A hydrated top-level series record (two distinct child episodes) — routes to
// the series screen (rawLabel SERIES / childCount > 0), meta chip "2 episodes".
const seriesVideo: WatchHomeVideoInput = {
  documentId: "doc-series",
  coreId: "core-series",
  slug: "the-series",
  label: "SERIES",
  durationSeconds: null,
  images: [{ mobileCinematicHigh: "https://img/series.jpg" }],
  locales: [{ title: "The Series" }],
  children: [
    {
      child: {
        documentId: "doc-ep1",
        coreId: "core-ep1",
        slug: "ep-1",
        label: "EPISODE",
        durationSeconds: 600,
        images: [],
        locales: [{ title: "Ep 1" }],
      },
    },
    {
      child: {
        documentId: "doc-ep2",
        coreId: "core-ep2",
        slug: "ep-2",
        label: "EPISODE",
        durationSeconds: 700,
        images: [],
        locales: [{ title: "Ep 2" }],
      },
    },
  ],
}

// A single video — routes to /watch, meta chip is its duration (1:00:00).
const singleVideo: WatchHomeVideoInput = {
  documentId: "doc-single",
  coreId: "core-single",
  slug: "a-single",
  label: "FEATURE_FILM",
  durationSeconds: 3600,
  images: [{ videoStill: "https://img/single.jpg" }],
  locales: [{ title: "A Single Film" }],
}

// A child-only record (no `children` key) — the accepted edge: childCount 0 →
// duration chip + /watch even though it may itself be a series elsewhere.
const childOnly: WatchHomeVideoInput = {
  documentId: "doc-ep1",
  coreId: "core-ep1",
  slug: "ep-1",
  label: "EPISODE",
  durationSeconds: 600,
  images: [{ videoStill: "https://img/ep1.jpg" }],
  locales: [{ title: "Ep 1" }],
}

function makeIndex(
  entries: readonly (readonly [string, WatchHomeVideoInput])[],
): Map<string, WatchHomeVideoInput> {
  return new Map(entries)
}

const HYDRATED = makeIndex([
  ["core-series", seriesVideo],
  ["core-single", singleVideo],
])

function mediaBlock(
  overrides: Record<string, unknown> = {},
): { __typename: string } & Record<string, unknown> {
  return {
    __typename: "MediaCollectionBlock",
    sectionKey: "row-1",
    title: "Featured Series",
    subtitle: "Watch now",
    categoryLabel: "Collections",
    mediaCollectionVariant: "carousel",
    showItemNumbers: false,
    items: [{ coreId: "core-series" }, { coreId: "core-single" }],
    ...overrides,
  }
}

describe("mapVariant (KTD2)", () => {
  it("maps carousel → horizontal rail", () => {
    expect(mapVariant("carousel")).toEqual({
      layout: "rail",
      orientation: "horizontal",
    })
  })
  it("maps collection → vertical grid", () => {
    expect(mapVariant("collection")).toEqual({
      layout: "grid",
      orientation: "vertical",
    })
  })
  it("maps grid and unknown/missing → horizontal grid (least-disruptive default)", () => {
    expect(mapVariant("grid")).toEqual({
      layout: "grid",
      orientation: "horizontal",
    })
    expect(mapVariant("mystery")).toEqual({
      layout: "grid",
      orientation: "horizontal",
    })
    expect(mapVariant(null)).toEqual({
      layout: "grid",
      orientation: "horizontal",
    })
  })
  // MediaCollectionVariant is a 5-literal enum (carousel collection grid hero
  // player) — the two we don't name must land on the safe default, not crash.
  it("maps the unhandled hero/player enum members → horizontal grid", () => {
    expect(mapVariant("hero")).toEqual({
      layout: "grid",
      orientation: "horizontal",
    })
    expect(mapVariant("player")).toEqual({
      layout: "grid",
      orientation: "horizontal",
    })
  })
})

// Prod's "Discover the full story" is a `carousel` (→ horizontal by variant)
// whose every item carries a curated 2:3 poster, and web renders it PORTRAIT.
// The poster override is what promotes it — mirrors mobile's isPortraitPosterRail.
describe("portrait poster rails", () => {
  const POSTER_A =
    "https://admin.jesusfilm.org/api/public/media-assets/a/preview"
  const POSTER_B =
    "https://admin.jesusfilm.org/api/public/media-assets/b/preview"

  function posterBlock(
    items: readonly Record<string, unknown>[],
    variant = "carousel",
  ) {
    return mediaBlock({ mediaCollectionVariant: variant, items })
  }

  function sectionFor(
    items: readonly Record<string, unknown>[],
    variant = "carousel",
  ): WatchHomeSection {
    return buildWatchHomeSectionsFromExperience(
      [posterBlock(items, variant)],
      HYDRATED,
    )[0]
  }

  it("promotes an all-poster carousel to a poster rail despite variant=carousel", () => {
    const section = sectionFor([
      { coreId: "core-series", imageOverrideUrl: POSTER_A },
      { coreId: "core-single", imageOverrideUrl: POSTER_B },
    ])
    expect(section.isPosterRail).toBe(true)
    // layout still follows the variant; orientation mirrors mobile's model.
    expect(section.layout).toBe("rail")
    expect(section.orientation).toBe("vertical")
  })

  it("is not a poster rail when only SOME items have a poster", () => {
    const section = sectionFor([
      { coreId: "core-series", imageOverrideUrl: POSTER_A },
      { coreId: "core-single" },
    ])
    expect(section.isPosterRail).toBe(false)
  })

  it("is not a poster rail when no item has a poster", () => {
    const section = sectionFor([
      { coreId: "core-series" },
      { coreId: "core-single" },
    ])
    expect(section.isPosterRail).toBe(false)
  })

  // Tightening vs mobile (which tests the raw field): an override that cannot
  // resolve yields NO poster, so the rail must not claim a portrait frame — that
  // is exactly how landscape art ends up cropped into 2:3.
  it("is not a poster rail when an override is present but unresolvable", () => {
    const section = sectionFor([
      { coreId: "core-series", imageOverrideUrl: POSTER_A },
      { coreId: "core-single", imageOverrideUrl: "javascript:alert(1)" },
    ])
    expect(section.isPosterRail).toBe(false)
  })

  // REGRESSION GUARD: `collection` maps to orientation "vertical" for mobile
  // layout parity, but that says NOTHING about art. Rendering off orientation
  // put a 2:3 frame around the landscape cinematic — the exact bug this feature
  // exists to prevent. isPosterRail must stay false here.
  it("does NOT make a poster-less variant=collection a poster rail", () => {
    const section = sectionFor(
      [{ coreId: "core-series" }, { coreId: "core-single" }],
      "collection",
    )
    expect(section.orientation).toBe("vertical") // mobile parity, unchanged
    expect(section.isPosterRail).toBe(false) // but the frame stays landscape
    // ...and the cards keep the hydrated landscape art, as before the feature.
    expect(section.cards.map((c) => c.imageUrl)).toEqual([
      "https://img/series.jpg",
      "https://img/single.jpg",
    ])
  })

  // The invariant the whole feature rests on: a poster rail implies portrait ART
  // on every rendered card. If this can fail, cards crop.
  it("gives every card in a poster rail its curated poster", () => {
    const section = sectionFor([
      { coreId: "core-series", imageOverrideUrl: POSTER_A },
      { coreId: "core-single", imageOverrideUrl: POSTER_B },
    ])
    expect(section.isPosterRail).toBe(true)
    expect(section.cards.map((c) => c.imageUrl)).toEqual([POSTER_A, POSTER_B])
  })

  // The converse: a landscape rail must never adopt a portrait poster, or the
  // 2.13:1 frame crops it. Frame and art are gated on the SAME value.
  it("keeps landscape art on a mixed rail, ignoring the stray poster", () => {
    const section = sectionFor([
      { coreId: "core-series", imageOverrideUrl: POSTER_A },
      { coreId: "core-single" },
    ])
    expect(section.isPosterRail).toBe(false)
    expect(section.cards.map((c) => c.imageUrl)).toEqual([
      "https://img/series.jpg",
      "https://img/single.jpg",
    ])
  })
})

// Card art is gated on the SAME poster-rail decision as the frame, so the two
// can never disagree: poster rail → the curated override; anything else → the
// hydrated video art, exactly as before this feature existed.
describe("card image source", () => {
  const POSTER = "https://admin.jesusfilm.org/api/public/media-assets/a/preview"
  const ITEM_IMAGE = "https://cdn.example/item.jpg"
  const VIDEO_ART = "https://img/single.jpg" // singleVideo's videoStill

  function cardFor(item: Record<string, unknown>) {
    return buildWatchHomeSectionsFromExperience(
      [mediaBlock({ items: [item] })],
      HYDRATED,
    )[0].cards[0]
  }

  it("uses the override poster on a poster rail (outranks the video art)", () => {
    expect(
      cardFor({ coreId: "core-single", imageOverrideUrl: POSTER }).imageUrl,
    ).toBe(POSTER)
  })

  it("uses the hydrated video art when the item has no override", () => {
    expect(cardFor({ coreId: "core-single" }).imageUrl).toBe(VIDEO_ART)
  })

  // item.imageUrl is deliberately NOT a poster signal (it carries landscape art
  // too), so it can't promote a rail — and a landscape rail keeps its video art.
  it("ignores the item imageUrl — it cannot make a rail portrait", () => {
    const section = buildWatchHomeSectionsFromExperience(
      [
        mediaBlock({
          items: [{ coreId: "core-single", imageUrl: ITEM_IMAGE }],
        }),
      ],
      HYDRATED,
    )[0]
    expect(section.isPosterRail).toBe(false)
    expect(section.cards[0].imageUrl).toBe(VIDEO_ART)
  })

  it("ignores an unresolvable override rather than blanking the card", () => {
    expect(
      cardFor({ coreId: "core-single", imageOverrideUrl: "javascript:x" })
        .imageUrl,
    ).toBe(VIDEO_ART)
  })
})

describe("buildWatchHomeSectionsFromExperience (R2, R3, R5, R6)", () => {
  it("maps a carousel block with hydrating items to one rail of hydrated cards", () => {
    const sections = buildWatchHomeSectionsFromExperience(
      [mediaBlock()],
      HYDRATED,
    )
    expect(sections).toHaveLength(1)
    const section = sections[0]
    expect(section.id).toBe("row-1")
    expect(section.eyebrow).toBe("Collections")
    expect(section.title).toBe("Featured Series")
    expect(section.layout).toBe("rail")
    expect(section.orientation).toBe("horizontal")
    expect(section.cards).toHaveLength(2)

    const [series, single] = section.cards
    // Cards are hydrated from the video record, not the flat item.
    expect(series.rawLabel).toBe("SERIES")
    expect(series.childCount).toBe(2)
    expect(series.metaLabel).toBe("2 episodes")
    expect(single.rawLabel).toBe("FEATURE_FILM")
    expect(single.childCount).toBe(0)
    expect(single.metaLabel).toBe("1:00:00")
  })

  it("carries the series-vs-single routing signal (AE2, R5)", () => {
    const [series, single] = buildWatchHomeSectionsFromExperience(
      [mediaBlock()],
      HYDRATED,
    )[0].cards
    expect(
      isSeriesSearchResult({
        label: series.rawLabel,
        childCount: series.childCount,
      }),
    ).toBe(true)
    expect(
      isSeriesSearchResult({
        label: single.rawLabel,
        childCount: single.childCount,
      }),
    ).toBe(false)
  })

  it("threads the item's muxPlaybackId onto the card, null when absent (R5, R6)", () => {
    const sections = buildWatchHomeSectionsFromExperience(
      [
        mediaBlock({
          sectionKey: "with-id",
          items: [{ coreId: "core-single", muxPlaybackId: "pbSingle01" }],
        }),
        mediaBlock({ sectionKey: "no-id", items: [{ coreId: "core-series" }] }),
      ],
      HYDRATED,
    )
    const [withId, noId] = sections
    expect(withId.cards[0].muxPlaybackId).toBe("pbSingle01")
    expect(noId.cards[0].muxPlaybackId).toBeNull()
  })

  it("uses categoryLabel as the title when the block title is blank", () => {
    const sections = buildWatchHomeSectionsFromExperience(
      [mediaBlock({ title: "" })],
      HYDRATED,
    )
    expect(sections[0].title).toBe("Collections")
  })

  it("drops per-item on no-hydrate and skips the fully-empty block (AE5)", () => {
    const allMiss = mediaBlock({
      sectionKey: "all-miss",
      items: [{ coreId: "core-x" }, { coreId: "core-y" }],
    })
    const mixed = mediaBlock({
      sectionKey: "mixed",
      items: [{ coreId: "core-series" }, { coreId: "core-missing" }],
    })
    const sections = buildWatchHomeSectionsFromExperience(
      [allMiss, mixed],
      HYDRATED,
    )
    // The all-miss block is skipped; the mixed block renders minus the dropped card.
    expect(sections).toHaveLength(1)
    expect(sections[0].id).toBe("mixed")
    expect(sections[0].cards).toHaveLength(1)
    expect(sections[0].cards[0].coreId).toBe("core-series")
  })

  it("hydrates a child-only coreId from the merged index (childCount 0 → /watch, duration)", () => {
    const index = makeIndex([["core-ep1", childOnly]])
    const sections = buildWatchHomeSectionsFromExperience(
      [mediaBlock({ items: [{ coreId: "core-ep1" }] })],
      index,
    )
    const card = sections[0].cards[0]
    expect(card.childCount).toBe(0)
    expect(card.metaLabel).toBe("10:00")
    expect(
      isSeriesSearchResult({
        label: card.rawLabel,
        childCount: card.childCount,
      }),
    ).toBe(false)
  })

  it("validates coreId before lookup (KTD10) — an unsafe id is dropped even if indexed", () => {
    const index = makeIndex([["bad/id", singleVideo]])
    const sections = buildWatchHomeSectionsFromExperience(
      [mediaBlock({ items: [{ coreId: "bad/id" }] })],
      index,
    )
    expect(sections).toHaveLength(0)
  })

  it("skips the known non-rail allowlist silently and dev-warns once on an unknown block (AE6, R6)", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    try {
      const sections = buildWatchHomeSectionsFromExperience(
        [
          { __typename: "WatchHomeHeroBlock" },
          { __typename: "SectionBlock" },
          { __typename: "PromoBannerBlock" },
          { __typename: "CtaBlock" },
          { __typename: "MysteryBlock" },
        ],
        HYDRATED,
      )
      expect(sections).toHaveLength(0)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain("MysteryBlock")
    } finally {
      warn.mockRestore()
    }
  })

  it("returns no sections for null / empty blocks", () => {
    expect(buildWatchHomeSectionsFromExperience(null, HYDRATED)).toEqual([])
    expect(buildWatchHomeSectionsFromExperience([], HYDRATED)).toEqual([])
  })

  it("derives the section id from the block index when sectionKey is null (rail identity)", () => {
    // sectionKey is nullable in admin's schema; the section id becomes the rail's
    // React key, so the index-derived fallback must be exercised.
    const sections = buildWatchHomeSectionsFromExperience(
      [{ __typename: "WatchHomeHeroBlock" }, mediaBlock({ sectionKey: null })],
      HYDRATED,
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].id).toBe("home-experience-section-1")
  })

  it("disambiguates a sectionKey two blocks share (rail identity)", () => {
    // Admin does not enforce uniqueness: the prod watch-home Experience ships
    // "Seven Days With Jesus" and "Creation to Christ" both keyed
    // `media-collection-15`, which collided React keys on the Home rail list.
    const sections = buildWatchHomeSectionsFromExperience(
      [
        mediaBlock({ sectionKey: "media-collection-15", title: "Seven Days" }),
        mediaBlock({ sectionKey: "media-collection-15", title: "Creation" }),
      ],
      HYDRATED,
    )
    expect(sections).toHaveLength(2)
    expect(sections[0].id).toBe("media-collection-15")
    expect(sections[1].id).not.toBe(sections[0].id)
  })

  it("keeps ids unique across every rail of a duplicate-heavy Experience", () => {
    const sections = buildWatchHomeSectionsFromExperience(
      [
        mediaBlock({ sectionKey: "dup" }),
        mediaBlock({ sectionKey: null }),
        mediaBlock({ sectionKey: "dup" }),
        mediaBlock({ sectionKey: "dup" }),
      ],
      HYDRATED,
    )
    const ids = sections.map((section) => section.id)
    expect(ids).toHaveLength(4)
    expect(new Set(ids).size).toBe(4)
  })

  it("gives a dropped block's sectionKey to the surviving twin", () => {
    // A zero-card block never renders, so it must not push a later real rail off
    // the authored key — only rails that survive reserve an id.
    const sections = buildWatchHomeSectionsFromExperience(
      [
        mediaBlock({ sectionKey: "dup", items: [{ coreId: "not-hydrated" }] }),
        mediaBlock({ sectionKey: "dup" }),
      ],
      HYDRATED,
    )
    expect(sections).toHaveLength(1)
    expect(sections[0].id).toBe("dup")
  })
})

describe("AE1/AE3 — prod-shaped Experience → 8 rails with exact meta chips", () => {
  it("renders 8 MediaCollection rails, skipping the hero placeholder and SectionBlock", () => {
    const blocks = [
      { __typename: "WatchHomeHeroBlock" },
      ...Array.from({ length: 8 }, (_, i) =>
        mediaBlock({
          sectionKey: `row-${i}`,
          // Alternate a series and a single so we can assert both chip shapes.
          items: [{ coreId: i % 2 === 0 ? "core-series" : "core-single" }],
          mediaCollectionVariant: i === 0 ? "carousel" : "grid",
        }),
      ),
      { __typename: "SectionBlock" },
    ]
    const sections = buildWatchHomeSectionsFromExperience(blocks, HYDRATED)
    expect(sections).toHaveLength(8)
    // First block is a carousel rail; the rest are grids.
    expect(sections[0].layout).toBe("rail")
    expect(sections[1].layout).toBe("grid")
    // Exact meta chips: series → "N episodes", single → duration (AE3).
    expect(sections[0].cards[0].metaLabel).toBe("2 episodes")
    expect(sections[1].cards[0].metaLabel).toBe("1:00:00")
  })
})

describe("experienceItemCoreIds (KTD3 divergence input, KTD10)", () => {
  it("collects unique, valid coreIds across MediaCollection blocks only", () => {
    const ids = experienceItemCoreIds([
      mediaBlock({
        items: [{ coreId: "a" }, { coreId: "b" }, { coreId: "a" }],
      }),
      mediaBlock({ items: [{ coreId: "b" }, { coreId: "c" }] }),
      { __typename: "SectionBlock", items: [{ coreId: "ignored" }] },
    ])
    expect(ids.sort()).toEqual(["a", "b", "c"])
  })

  it("drops KTD10-unsafe ids before they reach the top-up union", () => {
    const ids = experienceItemCoreIds([
      mediaBlock({
        items: [{ coreId: "ok_id" }, { coreId: "bad/id" }, { coreId: null }],
      }),
    ])
    expect(ids).toEqual(["ok_id"])
  })
})

describe("resolveWatchHomeModel (R7, R8)", () => {
  const configModel: WatchHomeModel = {
    featured: [{ id: "hero-1" } as WatchHomeModel["featured"][number]],
    sections: [{ id: "config-row" } as WatchHomeSection],
    missingData: [],
  }
  const experienceSections = [{ id: "exp-row" } as WatchHomeSection]

  it("uses the Experience rails when there is >=1, keeping config-sourced featured", () => {
    const { model, usedExperience } = resolveWatchHomeModel({
      configModel,
      experienceSections,
    })
    expect(usedExperience).toBe(true)
    expect(model.sections).toBe(experienceSections)
    // Featured stays config-sourced (banner is client-owned, R7).
    expect(model.featured).toBe(configModel.featured)
  })

  it("falls back to the whole config model when zero Experience rails (R8)", () => {
    const { model, usedExperience } = resolveWatchHomeModel({
      configModel,
      experienceSections: [],
    })
    expect(usedExperience).toBe(false)
    expect(model).toBe(configModel)
  })
})
