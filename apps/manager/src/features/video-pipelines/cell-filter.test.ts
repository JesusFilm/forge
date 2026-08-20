import { describe, expect, it } from "vitest"
import { filterCellsByQuery, toggleSetMember } from "./cell-filter"
import { buildDevotionsAugustCollection } from "./video-pipeline-model"

describe("toggleSetMember", () => {
  it("adds a value that is not present", () => {
    const result = toggleSetMember(new Set(["a"]), "b")
    expect(result).toEqual(new Set(["a", "b"]))
  })

  it("removes a value that is already present", () => {
    const result = toggleSetMember(new Set(["a", "b"]), "b")
    expect(result).toEqual(new Set(["a"]))
  })

  it("does not mutate the original set", () => {
    const original = new Set(["a"])
    toggleSetMember(original, "b")
    expect(original).toEqual(new Set(["a"]))
  })
})

describe("filterCellsByQuery", () => {
  const cells = buildDevotionsAugustCollection().cells

  it("returns every cell for an empty query", () => {
    expect(filterCellsByQuery(cells, "")).toHaveLength(31)
    expect(filterCellsByQuery(cells, "   ")).toHaveLength(31)
  })

  it("narrows to cells matching the day number", () => {
    const results = filterCellsByQuery(cells, "12")
    expect(results).toHaveLength(1)
    expect(results[0]?.date).toBe("2026-08-12")
  })

  it("matches case-insensitively against the formatted month name", () => {
    const results = filterCellsByQuery(cells, "august")
    expect(results).toHaveLength(31)
  })

  it("returns an empty array when nothing matches", () => {
    expect(filterCellsByQuery(cells, "no-such-day")).toHaveLength(0)
  })
})
