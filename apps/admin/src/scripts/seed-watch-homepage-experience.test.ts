import { WATCH_HOME_CATEGORY_CATALOG } from "@forge/watch-url-policy/watch-home-categories"
import { describe, expect, it } from "vitest"
import { BlocksSchema } from "@/domain/blocks"
import { buildWatchHomeSeedBlocks } from "./seed-watch-homepage-experience"

describe("buildWatchHomeSeedBlocks", () => {
  it("places one schema-valid all-category rail immediately after the hero", () => {
    const blocks = buildWatchHomeSeedBlocks([])
    const categoryBlocks = blocks.filter(
      (block) => block.t === "watchHomeCategoryRail",
    )

    expect(BlocksSchema.safeParse(blocks).success).toBe(true)
    expect(blocks.slice(0, 2).map((block) => block.t)).toEqual([
      "watchHomeHero",
      "watchHomeCategoryRail",
    ])
    expect(categoryBlocks).toHaveLength(1)
    expect(categoryBlocks[0]).toEqual({
      t: "watchHomeCategoryRail",
      sectionKey: "watch-home-category-rail",
      categoryIds: WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id),
    })
  })
})
