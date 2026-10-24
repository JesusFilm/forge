import { describe, expect, it } from "vitest"

import { WATCH_HOME_CATEGORY_CATALOG } from "./watch-home-categories"

describe("Watch home category catalog", () => {
  it("owns the current 13 categories in their default authored order", () => {
    expect(
      WATCH_HOME_CATEGORY_CATALOG.map(({ id, slug }) => ({ id, slug })),
    ).toEqual([
      { id: "jesus", slug: "jesus" },
      { id: "gospels", slug: "lumo" },
      { id: "short-videos", slug: "conversation-starters" },
      { id: "family", slug: "family" },
      { id: "relationships", slug: "relationships" },
      { id: "women", slug: "women-resources" },
      { id: "students", slug: "student-resources" },
      { id: "sports", slug: "sports" },
      { id: "good-news", slug: "evangelism" },
      { id: "hope", slug: "hope-collection" },
      { id: "training", slug: "training" },
      { id: "easter", slug: "easter" },
      { id: "christmas", slug: "christmas" },
    ])
  })

  it("keeps ids and destinations unique and staff labels non-empty", () => {
    const ids = WATCH_HOME_CATEGORY_CATALOG.map(({ id }) => id)
    const slugs = WATCH_HOME_CATEGORY_CATALOG.map(({ slug }) => slug)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const category of WATCH_HOME_CATEGORY_CATALOG) {
      expect(category.staffLabel.trim(), category.id).not.toBe("")
    }
  })
})
