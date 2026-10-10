import { print } from "graphql"
import { describe, expect, it } from "vitest"

import { watchHomeVideoFragment } from "@/lib/fragments/watch-home"

describe("WatchHomeVideo GraphQL selection", () => {
  it("keeps both locales blocks to the fields the home model actually reads", () => {
    const printed = print(watchHomeVideoFragment)

    // Two locales blocks: the parent video and the nested children.child video.
    // Both must stay narrowed together — a field re-added to only one still
    // ships on the wire.
    const localeBlocks = printed.match(
      /locales\([^)]*\)\s*\{[^}]*\}/g,
    ) as RegExpMatchArray | null

    expect(localeBlocks).not.toBeNull()
    expect(localeBlocks).toHaveLength(2)

    for (const block of localeBlocks ?? []) {
      expect(block).toMatch(/\btitle\b/)
      expect(block).toMatch(/\bimageAlt\b/)
      // The hero stopped rendering a secondary paragraph, so nothing on the
      // /watch home path reads these. Re-adding either refetches bytes that
      // cross the RSC boundary unread — no type error, no render change, and
      // no other assertion in the suite would notice.
      expect(block).not.toMatch(/\bdescription\b/)
      expect(block).not.toMatch(/\bsnippet\b/)
    }
  })
})
