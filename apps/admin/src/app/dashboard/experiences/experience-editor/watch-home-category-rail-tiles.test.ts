import { describe, expect, it } from "vitest"
import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"

import { BlocksSchema } from "@/domain/blocks"
import {
  categoryIdsFromTiles,
  categoryTileId,
  nextCustomTileId,
  railBlockPatch,
  railTileProblems,
  readRailTiles,
  type RailTile,
} from "./watch-home-category-rail-tiles"

const ALL_CATEGORY_IDS = WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id)

describe("readRailTiles", () => {
  it("derives tiles from the pre-feature categoryIds shape", () => {
    expect(
      readRailTiles({
        t: "watchHomeCategoryRail",
        categoryIds: ["jesus", "family"],
      }),
    ).toEqual([
      { id: "category:jesus", categoryId: "jesus" },
      { id: "category:family", categoryId: "family" },
    ])
  })

  it("leaves every presentation field unset when deriving, so catalog defaults keep applying", () => {
    const [tile] = readRailTiles({ categoryIds: ["jesus"] })
    expect(tile.title).toBeUndefined()
    expect(tile.href).toBeUndefined()
    expect(tile.icon).toBeUndefined()
    expect(tile.style).toBeUndefined()
  })

  it("prefers tiles over categoryIds when both are present and they disagree", () => {
    expect(
      readRailTiles({
        categoryIds: ["jesus", "family", "gospels"],
        tiles: [{ id: "custom-1", title: "Give", href: "/give" }],
      }),
    ).toEqual([{ id: "custom-1", title: "Give", href: "/give" }])
  })

  it("drops unknown ids and duplicates from the derived shape", () => {
    expect(
      readRailTiles({
        categoryIds: ["jesus", "not-a-category", "jesus", "family"],
      }).map((tile) => tile.categoryId),
    ).toEqual(["jesus", "family"])
  })

  it("keeps a tile whose category reference no longer exists, as a custom tile", () => {
    // Dropping it outright would silently delete authored copy; demoting it
    // to custom surfaces the missing-title problem in the editor instead.
    expect(
      readRailTiles({
        tiles: [{ id: "t1", categoryId: "retired-category", title: "Legacy" }],
      }),
    ).toEqual([{ id: "t1", categoryId: undefined, title: "Legacy" }])
  })

  it("drops duplicate tile ids and duplicate category references", () => {
    expect(
      readRailTiles({
        tiles: [
          { id: "a", categoryId: "jesus" },
          { id: "a", title: "Dup id", href: "/x" },
          { id: "b", categoryId: "jesus" },
          { id: "c", title: "Kept", href: "/y" },
        ],
      }).map((tile) => tile.id),
    ).toEqual(["a", "c"])
  })

  it("treats a blank string as an absent override rather than authored copy", () => {
    expect(
      readRailTiles({
        tiles: [{ id: "a", categoryId: "jesus", title: "   ", href: "" }],
      }),
    ).toEqual([
      {
        id: "a",
        categoryId: "jesus",
        title: undefined,
        href: undefined,
        icon: undefined,
        style: undefined,
      },
    ])
  })

  it("returns nothing for an absent block", () => {
    expect(readRailTiles(null)).toEqual([])
    expect(readRailTiles({})).toEqual([])
  })
})

describe("nextCustomTileId", () => {
  it("skips ids already in use rather than colliding", () => {
    expect(nextCustomTileId([])).toBe("custom-1")
    expect(
      nextCustomTileId([
        { id: "custom-1" },
        { id: "custom-2" },
        { id: "category:jesus", categoryId: "jesus" },
      ]),
    ).toBe("custom-3")
  })

  it("fills a gap left by a deleted tile", () => {
    expect(nextCustomTileId([{ id: "custom-2" }])).toBe("custom-1")
  })
})

describe("categoryIdsFromTiles", () => {
  it("mirrors only the predefined tiles, in tile order", () => {
    expect(
      categoryIdsFromTiles([
        { id: "custom-1", title: "Give", href: "/give" },
        { id: categoryTileId("family"), categoryId: "family" },
        { id: categoryTileId("jesus"), categoryId: "jesus" },
      ]),
    ).toEqual(["family", "jesus"])
  })
})

describe("railBlockPatch", () => {
  const block = {
    t: "watchHomeCategoryRail",
    sectionKey: "watch-home-category-rail",
    categoryIds: ALL_CATEGORY_IDS,
  }

  it("writes tiles and keeps categoryIds a truthful mirror of the predefined ones", () => {
    const tiles: RailTile[] = [
      { id: categoryTileId("jesus"), categoryId: "jesus", title: "Meet Jesus" },
      { id: "custom-1", title: "Give", href: "https://example.org/give" },
      { id: categoryTileId("family"), categoryId: "family" },
    ]

    expect(railBlockPatch(block, tiles)).toEqual({
      t: "watchHomeCategoryRail",
      sectionKey: "watch-home-category-rail",
      categoryIds: ["jesus", "family"],
      tiles: [
        {
          id: "category:jesus",
          categoryId: "jesus",
          title: "Meet Jesus",
        },
        { id: "custom-1", title: "Give", href: "https://example.org/give" },
        { id: "category:family", categoryId: "family" },
      ],
    })
  })

  it("trims field values, since the editor deliberately stores them as typed", () => {
    const patch = railBlockPatch(block, [
      {
        id: "custom-1 ",
        title: "  Give  ",
        href: " /give ",
        icon: " heart ",
        style: "  ",
      },
    ])

    expect(patch.tiles).toEqual([
      { id: "custom-1", title: "Give", href: "/give", icon: "heart" },
    ])
    expect(BlocksSchema.safeParse([patch]).success).toBe(true)
  })

  it("omits absent optional fields so the strict block schema still accepts the patch", () => {
    const patch = railBlockPatch(block, [
      { id: categoryTileId("jesus"), categoryId: "jesus" },
    ])
    expect(Object.keys((patch.tiles as object[])[0])).toEqual([
      "id",
      "categoryId",
    ])
  })

  it("keeps the previous mirror when every predefined tile has been removed", () => {
    // `categoryIds` is required and min(1). A rail of purely custom tiles has
    // nothing to mirror, and failing the save would be the wrong answer.
    const patch = railBlockPatch(block, [
      { id: "custom-1", title: "Give", href: "/give" },
    ])
    expect(patch.categoryIds).toEqual(ALL_CATEGORY_IDS)
    expect(BlocksSchema.safeParse([patch]).success).toBe(true)
  })

  it("produces a block the persistence schema accepts for every edit shape", () => {
    const patch = railBlockPatch(block, [
      { id: categoryTileId("jesus"), categoryId: "jesus" },
      {
        id: "custom-1",
        title: "Give",
        href: "https://example.org/give",
        icon: "heart",
        style: "forest",
      },
    ])
    expect(BlocksSchema.safeParse([patch]).success).toBe(true)
  })

  it("round-trips: patch then read gives back the same tiles", () => {
    const tiles: RailTile[] = [
      { id: categoryTileId("family"), categoryId: "family", icon: "star" },
      { id: "custom-1", title: "Give", href: "/give", style: "midnight" },
    ]
    expect(readRailTiles(railBlockPatch(block, tiles))).toEqual([
      {
        id: "category:family",
        categoryId: "family",
        title: undefined,
        href: undefined,
        icon: "star",
        style: undefined,
      },
      {
        id: "custom-1",
        categoryId: undefined,
        title: "Give",
        href: "/give",
        icon: undefined,
        style: "midnight",
      },
    ])
  })
})

describe("railTileProblems", () => {
  it("accepts a predefined tile with no overrides at all", () => {
    expect(railTileProblems({ id: "a", categoryId: "jesus" })).toEqual([])
  })

  it("requires a title and destination only on a custom tile", () => {
    expect(railTileProblems({ id: "a" })).toEqual(["title", "href"])
    expect(railTileProblems({ id: "a", title: "Give", href: "/give" })).toEqual(
      [],
    )
  })

  it("flags an unsafe destination on a predefined tile too", () => {
    expect(
      railTileProblems({
        id: "a",
        categoryId: "jesus",
        href: "javascript:alert(1)",
      }),
    ).toEqual(["href"])
  })
})
