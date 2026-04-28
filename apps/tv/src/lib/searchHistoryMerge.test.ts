import { SEARCH_HISTORY_MAX, mergeRecent } from "./searchHistoryMerge"

describe("mergeRecent", () => {
  it("places a new query at the front of an empty list", () => {
    expect(mergeRecent([], "bible")).toEqual(["bible"])
  })

  it("places a new query at the front of an existing list", () => {
    expect(mergeRecent(["parables"], "bible")).toEqual(["bible", "parables"])
  })

  it("moves an existing query to the front (dedupe)", () => {
    expect(mergeRecent(["bible", "parables"], "parables")).toEqual([
      "parables",
      "bible",
    ])
  })

  it("dedupes case-insensitively", () => {
    expect(mergeRecent(["Bible"], "bible")).toEqual(["bible"])
    expect(mergeRecent(["PARABLES", "Bible"], "bible")).toEqual([
      "bible",
      "PARABLES",
    ])
  })

  it("caps at SEARCH_HISTORY_MAX entries", () => {
    const start = Array.from({ length: SEARCH_HISTORY_MAX }, (_, i) => `q${i}`)
    const next = mergeRecent(start, "new")
    expect(next.length).toBe(SEARCH_HISTORY_MAX)
    expect(next[0]).toBe("new")
    // Oldest entry (last in the previous list) was dropped.
    expect(next).not.toContain(`q${SEARCH_HISTORY_MAX - 1}`)
  })

  it("does not mutate the input array", () => {
    const start = ["a", "b", "c"]
    const next = mergeRecent(start, "b")
    expect(start).toEqual(["a", "b", "c"])
    expect(next).toEqual(["b", "a", "c"])
  })
})
