import { isSeriesSearchResult } from "../isSeriesRecord"
import {
  buildWatchHomeSectionsFromExperience,
  mapVariant,
} from "./experienceAdapter"
import type { WatchHomeVideoInput } from "./model"

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
})
