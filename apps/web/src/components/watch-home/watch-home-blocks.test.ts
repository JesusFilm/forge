import { describe, expect, it } from "vitest"
import type { Section } from "@/components/sections"
import { filterWatchHomeBelowFoldBlocks } from "./watch-home-blocks"

function block(kind: string, id: string): Section {
  return { __typename: kind, id } as unknown as Section
}

describe("filterWatchHomeBelowFoldBlocks", () => {
  it("removes only the leading legacy hero block", () => {
    const blocks = [
      block("VideoHeroBlock", "hero"),
      block("NavigationCarouselBlock", "nav"),
      block("MediaCollectionBlock", "collection"),
    ]

    expect(filterWatchHomeBelowFoldBlocks(blocks)).toEqual([
      blocks[1],
      blocks[2],
    ])
  })

  it("keeps navigation blocks when there is no legacy hero", () => {
    const blocks = [
      block("NavigationCarouselBlock", "nav"),
      block("MediaCollectionBlock", "collection"),
    ]

    expect(filterWatchHomeBelowFoldBlocks(blocks)).toEqual(blocks)
  })
})
