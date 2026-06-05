import { describe, expect, it } from "vitest"
import type { Section } from "@/components/sections"
import { filterWatchHomeBelowFoldBlocks } from "./watch-home-blocks"

function block(kind: string, id: string): Section {
  return { __typename: kind, id } as unknown as Section
}

describe("filterWatchHomeBelowFoldBlocks", () => {
  it("removes leading legacy hero and navigation blocks", () => {
    const blocks = [
      block("VideoHeroBlock", "hero"),
      block("NavigationCarouselBlock", "nav"),
      block("MediaCollectionBlock", "collection"),
    ]

    expect(filterWatchHomeBelowFoldBlocks(blocks)).toEqual([blocks[2]])
  })

  it("keeps later navigation blocks once body content has started", () => {
    const blocks = [
      block("MediaCollectionBlock", "collection"),
      block("NavigationCarouselBlock", "nav"),
    ]

    expect(filterWatchHomeBelowFoldBlocks(blocks)).toEqual(blocks)
  })
})
