import { describe, expect, it } from "vitest"
import {
  buildDevotionsAugustCollection,
  computeAggregateStatus,
  formatCellDate,
  formatCellRowLabel,
  formatCellShortDate,
} from "./video-pipeline-model"

describe("buildDevotionsAugustCollection", () => {
  it("returns exactly 31 cells dated Aug 1 through Aug 31 in order", () => {
    const collection = buildDevotionsAugustCollection()

    expect(collection.cells).toHaveLength(31)
    expect(collection.cells[0]?.date).toBe("2026-08-01")
    expect(collection.cells[30]?.date).toBe("2026-08-31")
    expect(collection.cells.map((cell) => cell.date)).toEqual(
      Array.from(
        { length: 31 },
        (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`,
      ),
    )
  })

  it("gives every cell a unique id", () => {
    const collection = buildDevotionsAugustCollection()
    const ids = new Set(collection.cells.map((cell) => cell.id))

    expect(ids.size).toBe(collection.cells.length)
  })

  it("tags the container 'Basic'", () => {
    const collection = buildDevotionsAugustCollection()

    expect(collection.title).toBe("Devotions - August")
    expect(collection.label).toBe("basic")
    expect(collection.labelDisplay).toBe("Basic")
  })

  it("gives every cell the plain 'Devotional' title (date carries the day)", () => {
    const collection = buildDevotionsAugustCollection()

    expect(collection.cells.every((cell) => cell.title === "Devotional")).toBe(
      true,
    )
  })

  it("includes at least one cell for every (mobileGenerated, desktopGenerated) combination", () => {
    const collection = buildDevotionsAugustCollection()
    const combinations = new Set(
      collection.cells.map(
        (cell) => `${cell.mobileGenerated}:${cell.desktopGenerated}`,
      ),
    )

    expect(combinations).toEqual(
      new Set(["true:true", "true:false", "false:true", "false:false"]),
    )
  })
})

describe("computeAggregateStatus", () => {
  it("returns 'generated' only when both mobile and desktop are generated", () => {
    expect(
      computeAggregateStatus({ mobileGenerated: true, desktopGenerated: true }),
    ).toBe("generated")
  })

  it("returns 'none' when neither aspect is generated", () => {
    expect(
      computeAggregateStatus({
        mobileGenerated: false,
        desktopGenerated: false,
      }),
    ).toBe("none")
  })

  it("returns 'none' when only mobile is generated", () => {
    expect(
      computeAggregateStatus({
        mobileGenerated: true,
        desktopGenerated: false,
      }),
    ).toBe("none")
  })

  it("returns 'none' when only desktop is generated", () => {
    expect(
      computeAggregateStatus({
        mobileGenerated: false,
        desktopGenerated: true,
      }),
    ).toBe("none")
  })
})

describe("formatCellDate", () => {
  it("renders a human-readable date", () => {
    expect(formatCellDate("2026-08-03")).toBe("August 3, 2026")
  })

  it("handles the first and last day of the month", () => {
    expect(formatCellDate("2026-08-01")).toBe("August 1, 2026")
    expect(formatCellDate("2026-08-31")).toBe("August 31, 2026")
  })
})

describe("formatCellShortDate", () => {
  it("renders an abbreviated month with no year", () => {
    expect(formatCellShortDate("2026-08-03")).toBe("Aug 3")
  })

  it("handles the first and last day of the month", () => {
    expect(formatCellShortDate("2026-08-01")).toBe("Aug 1")
    expect(formatCellShortDate("2026-08-31")).toBe("Aug 31")
  })
})

describe("formatCellRowLabel", () => {
  it("renders 'Aug D - Title' for the expanded detail list", () => {
    expect(
      formatCellRowLabel({ date: "2026-08-01", title: "Devotional" }),
    ).toBe("Aug 1 - Devotional")
  })
})
