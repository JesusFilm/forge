import { WATCH_HOME_FEATURED_RAIL, WATCH_HOME_HERO_SOURCE_IDS } from "./config"
import {
  buildVideoByCoreIdIndex,
  buildWatchHomeModelFromVideos,
  resolveFeaturedTitle,
  type WatchHomeChildRelationInput,
  type WatchHomeVideoInput,
} from "./model"

function video(
  coreId: string,
  overrides: Partial<WatchHomeVideoInput> = {},
): WatchHomeVideoInput {
  return {
    documentId: `doc-${coreId}`,
    coreId,
    slug: `${coreId}-slug`,
    label: "COLLECTION",
    durationSeconds: null,
    images: [{ mobileCinematicHigh: `https://images.example/${coreId}.jpg` }],
    locales: [
      {
        title: `Title ${coreId}`,
        description: `Description ${coreId}`,
        snippet: null,
        imageAlt: `Alt ${coreId}`,
      },
    ],
    children: [],
    ...overrides,
  }
}

function childRel(coreId: string): WatchHomeChildRelationInput {
  return { child: video(coreId, { label: "EPISODE", durationSeconds: 300 }) }
}

const heroVideos = WATCH_HOME_HERO_SOURCE_IDS.map((id) => video(id))

describe("buildWatchHomeModelFromVideos — featured", () => {
  it("produces featured cards from the hero source ids in config order", () => {
    const model = buildWatchHomeModelFromVideos({ videos: heroVideos })

    expect(model.featured.map((card) => card.sourceId)).toEqual([
      ...WATCH_HOME_HERO_SOURCE_IDS,
    ])
    expect(model.featured.map((card) => card.coreId)).toEqual([
      ...WATCH_HOME_HERO_SOURCE_IDS,
    ])
  })

  it("omits an unresolved hero coreId and records it in missingData", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: heroVideos.filter((v) => v.coreId !== "2_GOJ-0-0"),
    })

    expect(model.featured.map((card) => card.sourceId)).toEqual([
      "1_jf-0-0",
      "GOMattCollection",
      "LUMOCollection",
    ])
    expect(model.missingData).toContainEqual(
      expect.objectContaining({
        sectionId: WATCH_HOME_FEATURED_RAIL.id,
        sourceId: "2_GOJ-0-0",
        field: "record",
      }),
    )
  })

  it("keeps slug/coreId routing data and never carries a stream field", () => {
    const model = buildWatchHomeModelFromVideos({ videos: heroVideos })
    const card = model.featured[0]

    expect(card.slug).toBe("1_jf-0-0-slug")
    expect(card.coreId).toBe("1_jf-0-0")
    expect(card).not.toHaveProperty("hls")
    expect(card).not.toHaveProperty("playbackId")
  })
})

describe("buildWatchHomeModelFromVideos — sections", () => {
  it("omits a section whose cards all fail to resolve", () => {
    // "11_Advent" absent → home-collection-bibleproject-advent resolves zero
    // cards and must not appear in the output.
    const model = buildWatchHomeModelFromVideos({ videos: heroVideos })

    expect(
      model.sections.find(
        (s) => s.id === "home-collection-bibleproject-advent",
      ),
    ).toBeUndefined()
    expect(model.missingData).toContainEqual(
      expect.objectContaining({
        sectionId: "home-collection-bibleproject-advent",
        sourceId: "11_Advent",
        field: "record",
      }),
    )
  })

  it("keeps the resolved cards of a partially resolved section", () => {
    // Only 2 of home-video-gospels' 6 showcase sources resolve.
    const model = buildWatchHomeModelFromVideos({
      videos: [video("1_jf-0-0"), video("GOMattCollection")],
    })
    const gospels = model.sections.find((s) => s.id === "home-video-gospels")

    expect(gospels).toBeDefined()
    expect(gospels?.cards.map((card) => card.sourceId)).toEqual([
      "1_jf-0-0",
      "GOMattCollection",
    ])
  })

  it("returns no sections (and no featured) for an empty video set", () => {
    const model = buildWatchHomeModelFromVideos({ videos: [] })

    expect(model.featured).toEqual([])
    expect(model.sections).toEqual([])
  })

  it("builds primary-collection sections from one level of children", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [
        video("11_Advent", {
          children: [childRel("11_Advent_ep1"), childRel("11_Advent_ep2")],
        }),
      ],
    })
    const advent = model.sections.find(
      (s) => s.id === "home-collection-bibleproject-advent",
    )

    expect(advent?.cards.map((card) => card.coreId)).toEqual([
      "11_Advent_ep1",
      "11_Advent_ep2",
    ])
    expect(advent?.cards[0]?.parentCoreId).toBe("11_Advent")
    expect(advent?.cards[0]?.parentSlug).toBe("11_Advent-slug")
  })

  it("self-filters and dedupes children reads (KTD5 fix-tolerance)", () => {
    const self = video("11_Advent")
    const model = buildWatchHomeModelFromVideos({
      videos: [
        {
          ...self,
          children: [
            { child: self }, // self-reference (the inverted-relation shape)
            childRel("11_Advent_ep1"),
            childRel("11_Advent_ep1"), // duplicate
          ],
        },
      ],
    })
    const advent = model.sections.find(
      (s) => s.id === "home-collection-bibleproject-advent",
    )

    expect(advent?.cards.map((card) => card.coreId)).toEqual(["11_Advent_ep1"])
  })

  // Covers cardEntriesForSource's untested slice branch: collectionLumo
  // (limitChildren 1) must yield its first child as the card, never the parent
  // collection. The parent branch (limitChildren 0) is exercised above.
  it("slices a limitChildren source to its first child, not the parent", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [
        video("LUMOCollection", {
          children: [
            childRel("LUMO_ep1"),
            childRel("LUMO_ep2"),
            childRel("LUMO_ep3"),
          ],
        }),
      ],
    })
    const lumoVertical = model.sections.find(
      (s) => s.id === "home-collection-showcase-grid-vertical",
    )

    expect(lumoVertical?.cards.map((card) => card.coreId)).toEqual(["LUMO_ep1"])
    expect(lumoVertical?.cards[0]?.parentCoreId).toBe("LUMOCollection")
  })
})

describe("buildWatchHomeModelFromVideos — metaLabel", () => {
  it("says 'N episodes' when childCount > 0", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [
        video("1_jf-0-0", {
          children: [childRel("1_jf-ep1"), childRel("1_jf-ep2")],
        }),
        video("2_GOJ-0-0", { children: [childRel("2_GOJ-ep1")] }),
      ],
    })

    expect(model.featured[0]?.childCount).toBe(2)
    expect(model.featured[0]?.metaLabel).toBe("2 episodes")
    expect(model.featured[1]?.metaLabel).toBe("1 episode")
  })

  it("falls back to duration text when there are no children", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [
        video("1_jf-0-0", { durationSeconds: 125 }),
        video("2_GOJ-0-0", { durationSeconds: 3661 }),
      ],
    })

    expect(model.featured[0]?.metaLabel).toBe("2:05")
    expect(model.featured[1]?.metaLabel).toBe("1:01:01")
  })

  it("falls back to the label text when neither children nor duration exist", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [video("1_jf-0-0", { label: "FEATURE_FILM" })],
    })

    expect(model.featured[0]?.metaLabel).toBe("Feature film")
  })

  // Producer side of the routing contract: homeCardRouting feeds rawLabel
  // into isSeriesSearchResult, which matches uppercase wire literals only —
  // the display-text `label` must never stand in for it.
  it("carries the raw wire label alongside the display text", () => {
    const model = buildWatchHomeModelFromVideos({
      videos: [video("1_jf-0-0", { label: "COLLECTION" })],
    })

    expect(model.featured[0]?.label).toBe("Collection")
    expect(model.featured[0]?.rawLabel).toBe("COLLECTION")
  })
})

describe("resolveFeaturedTitle — injected clock", () => {
  it("selects the morning variant before 12:00", () => {
    expect(
      resolveFeaturedTitle(WATCH_HOME_FEATURED_RAIL, new Date(2026, 5, 11, 6)),
    ).toBe("Good Morning! Today's Bible Moments Await.")
    expect(
      resolveFeaturedTitle(
        WATCH_HOME_FEATURED_RAIL,
        new Date(2026, 5, 11, 11, 59),
      ),
    ).toBe("Good Morning! Today's Bible Moments Await.")
  })

  it("selects the afternoon variant from 12:00 to 16:59", () => {
    expect(
      resolveFeaturedTitle(WATCH_HOME_FEATURED_RAIL, new Date(2026, 5, 11, 12)),
    ).toBe("Good Afternoon! Bible Moments for Your Day.")
    expect(
      resolveFeaturedTitle(
        WATCH_HOME_FEATURED_RAIL,
        new Date(2026, 5, 11, 16, 59),
      ),
    ).toBe("Good Afternoon! Bible Moments for Your Day.")
  })

  // 17:00 is web's afternoon→evening overlay boundary (range 17–21), so TV's
  // evening starts there too.
  it("selects the evening variant from 17:00 onward", () => {
    expect(
      resolveFeaturedTitle(WATCH_HOME_FEATURED_RAIL, new Date(2026, 5, 11, 17)),
    ).toBe("Good Evening! Wind Down with Bible Moments.")
    expect(
      resolveFeaturedTitle(WATCH_HOME_FEATURED_RAIL, new Date(2026, 5, 11, 23)),
    ).toBe("Good Evening! Wind Down with Bible Moments.")
  })

  it("falls back to the base title when no variants are configured", () => {
    expect(
      resolveFeaturedTitle(
        { title: "Today's Video Picks" },
        new Date(2026, 5, 11, 9),
      ),
    ).toBe("Today's Video Picks")
  })
})

describe("buildVideoByCoreIdIndex — spans both levels, top-level-wins (KTD4)", () => {
  it("indexes top-level records AND their children by coreId", () => {
    const parent = video("collection-a", {
      children: [childRel("child-1"), childRel("child-2")],
    })
    const index = buildVideoByCoreIdIndex([parent])
    expect(index.get("collection-a")).toBe(parent)
    // The 20 child-only prod items must resolve — a top-level-only map drops them.
    expect(index.get("child-1")?.coreId).toBe("child-1")
    expect(index.get("child-2")?.coreId).toBe("child-2")
  })

  it("resolves a coreId present both top-level and as a child to the TOP-LEVEL record", () => {
    const asChildOf = video("outer", { children: [childRel("shared")] })
    const asTopLevel = video("shared", {
      label: "SERIES",
      children: [childRel("grandchild")],
    })
    // Child entry inserted first, top-level second → top-level overrides.
    const index = buildVideoByCoreIdIndex([asChildOf, asTopLevel])
    const resolved = index.get("shared")
    expect(resolved).toBe(asTopLevel)
    // Proof it's the top-level record: it carries its own children (the shallow
    // child copy does not), so normalizeCard would compute a real childCount.
    expect(resolved?.children).toHaveLength(1)
  })

  it("skips records with no coreId", () => {
    const noCore = video("x", { coreId: null })
    const index = buildVideoByCoreIdIndex([noCore])
    expect(index.size).toBe(0)
  })
})
