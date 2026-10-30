import { CATEGORIES } from "./categories"
import {
  findNativeSearchAction,
  nativeSearchActions,
  nativeSearchSuggestions,
} from "./nativeSearchSuggestions"

describe("nativeSearchSuggestions", () => {
  it("offers the existing topics without requiring history or content requests", () => {
    const suggestions = nativeSearchSuggestions([], 1)
    expect(suggestions.map(({ query }) => query)).toEqual(
      CATEGORIES.map(({ searchTerm }) => searchTerm),
    )
    expect(
      suggestions.every(({ card }) => card.subtitle === "Browse topic"),
    ).toBe(true)
  })

  it("puts bounded, unique, nonempty recent searches before topics", () => {
    const suggestions = nativeSearchSuggestions(
      ["faith", "", "  ", "faith", "hope", "family", "jesus", "bible", "sixth"],
      1,
    )
    expect(suggestions.slice(0, 5).map(({ query }) => query)).toEqual([
      "faith",
      "hope",
      "family",
      "jesus",
      "bible",
    ])
    expect(suggestions[0].card).toEqual({
      id: "search-action:recent:1:0",
      title: "faith",
      subtitle: "Recent search",
    })
    expect(suggestions[5].query).toBe(CATEGORIES[0].searchTerm)
    expect(new Set(suggestions.map(({ card }) => card.id)).size).toBe(
      suggestions.length,
    )
  })

  it("keeps user-entered text out of native action IDs", () => {
    const suggestions = nativeSearchSuggestions(["a private query"], 1)
    expect(suggestions[0].card.id).not.toContain("private")
    expect(
      findNativeSearchAction(
        nativeSearchActions("idle", true, suggestions),
        suggestions[0].card.id,
      ),
    ).toMatchObject({ kind: "search", query: "a private query" })
    expect(
      findNativeSearchAction(
        nativeSearchActions("idle", true, suggestions),
        "search-action:recent:99",
      ),
    ).toBeNull()
    expect(
      findNativeSearchAction(
        nativeSearchActions("idle", true, suggestions),
        "a private query",
      ),
    ).toBeNull()
    expect(
      findNativeSearchAction(
        nativeSearchActions("idle", true, suggestions),
        "video-id",
      ),
    ).toBeNull()
  })
})

describe("native search error actions", () => {
  it("projects a recoverable error with a fixed opaque action ID", () => {
    const actions = nativeSearchActions(
      "error",
      false,
      nativeSearchSuggestions(["jesus"], 1),
    )
    expect(actions).toEqual([
      {
        kind: "retry",
        card: {
          id: "search-action:retry",
          title: "Try again",
          subtitle: "Search unavailable",
        },
      },
    ])
    expect(findNativeSearchAction(actions, "search-action:retry")).toEqual(
      actions[0],
    )
    expect(findNativeSearchAction(actions, "search-action:recent:0")).toBeNull()
    expect(findNativeSearchAction(actions, "video-id")).toBeNull()
  })

  it.each(["loading", "empty", "ready", "idle"] as const)(
    "leaves %s content presentation unchanged and ignores stale retry",
    (state) => {
      const actions = nativeSearchActions(
        state,
        false,
        nativeSearchSuggestions([], 1),
      )
      expect(actions).toEqual([])
      expect(findNativeSearchAction(actions, "search-action:retry")).toBeNull()
    },
  )

  it("returns to existing suggestions when a failed query is cleared", () => {
    const suggestions = nativeSearchSuggestions(["jesus"], 1)
    const actions = nativeSearchActions("error", true, suggestions)
    expect(actions).toHaveLength(suggestions.length)
    expect(actions[0]).toMatchObject({ kind: "search", query: "jesus" })
    expect(findNativeSearchAction(actions, "search-action:retry")).toBeNull()
  })
})

test("a delayed recent selection cannot change meaning after history reorders", () => {
  const original = nativeSearchActions(
    "idle",
    true,
    nativeSearchSuggestions(["jesus", "bible"], 1),
  )
  const refreshed = nativeSearchActions(
    "idle",
    true,
    nativeSearchSuggestions(["bible", "jesus"], 2),
  )
  expect(findNativeSearchAction(refreshed, original[0].card.id)).toBeNull()
  expect(findNativeSearchAction(refreshed, refreshed[0].card.id)).toMatchObject(
    { kind: "search", query: "bible" },
  )
  expect(refreshed.map(({ card }) => card.id).join(" ")).not.toMatch(
    /jesus|bible/,
  )
})

test("native topics omit recent queries ignoring case/space without renumbering IDs", () => {
  const suggestions = nativeSearchSuggestions(
    ["  BIBLE Stories  ", "parables"],
    7,
  )
  expect(suggestions.slice(0, 2).map(({ card }) => card.id)).toEqual([
    "search-action:recent:7:0",
    "search-action:recent:7:1",
  ])
  const topics = suggestions.filter(
    ({ card }) => card.subtitle === "Browse topic",
  )
  expect(topics.map(({ query }) => query)).toEqual(
    CATEGORIES.slice(2).map(({ searchTerm }) => searchTerm),
  )
  expect(topics[0].card.id).toBe("search-action:topic:2")
  expect(topics[topics.length - 1].card.id).toBe("search-action:topic:5")
})
