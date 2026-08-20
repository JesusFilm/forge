import { describe, expect, it } from "vitest"
import {
  buildAllDevotionCollections,
  buildDevotionsAugustCollection,
  computeAggregateStatus,
  findCellById,
  formatCellDate,
  formatCellRowLabel,
  formatCellShortDate,
  getCellDayOfMonth,
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

  it("gives each day its own draft devotional title, in order", () => {
    const collection = buildDevotionsAugustCollection()

    expect(collection.cells[0]?.title).toBe(
      "The night the ordinary sky wasn't ordinary",
    )
    expect(collection.cells[30]?.title).toBe(
      "His last words were a job, not a goodbye",
    )
  })

  it("gives every cell a non-empty, unique title", () => {
    const collection = buildDevotionsAugustCollection()
    const titles = collection.cells.map((cell) => cell.title)

    expect(titles.every((title) => title.trim().length > 0)).toBe(true)
    expect(new Set(titles).size).toBe(titles.length)
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

  it("marks exactly the first 7 days (Aug 1-7) as fully generated", () => {
    const collection = buildDevotionsAugustCollection()
    const generatedDates = collection.cells
      .filter((cell) => cell.mobileGenerated && cell.desktopGenerated)
      .map((cell) => cell.date)

    expect(generatedDates).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ])
  })
})

describe("buildAllDevotionCollections", () => {
  it("returns August through December, in order, each tagged 'Basic'", () => {
    const collections = buildAllDevotionCollections()

    expect(collections.map((collection) => collection.title)).toEqual([
      "Devotions - August",
      "Devotions - September",
      "Devotions - October",
      "Devotions - November",
      "Devotions - December",
    ])
    expect(
      collections.every(
        (collection) =>
          collection.label === "basic" && collection.labelDisplay === "Basic",
      ),
    ).toBe(true)
  })

  it("gives each month the correct day count and date range", () => {
    const [august, september, october, november, december] =
      buildAllDevotionCollections()

    expect(august?.cells).toHaveLength(31)
    expect(september?.cells).toHaveLength(30)
    expect(october?.cells).toHaveLength(31)
    expect(november?.cells).toHaveLength(30)
    expect(december?.cells).toHaveLength(31)

    expect(september?.cells[0]?.date).toBe("2026-09-01")
    expect(september?.cells[29]?.date).toBe("2026-09-30")
  })

  it("leaves September-December entirely not-generated (future months)", () => {
    const collections = buildAllDevotionCollections()
    const futureMonths = collections.slice(1)

    expect(
      futureMonths.every((collection) =>
        collection.cells.every(
          (cell) => !cell.mobileGenerated && !cell.desktopGenerated,
        ),
      ),
    ).toBe(true)
  })

  it("gives cell ids and dates unique across every month", () => {
    const collections = buildAllDevotionCollections()
    const allIds = collections.flatMap((collection) =>
      collection.cells.map((cell) => cell.id),
    )

    expect(new Set(allIds).size).toBe(allIds.length)
  })
})

describe("getCellDayOfMonth", () => {
  it("extracts the day number from a YYYY-MM-DD date", () => {
    expect(getCellDayOfMonth("2026-08-01")).toBe(1)
    expect(getCellDayOfMonth("2026-08-31")).toBe(31)
    expect(getCellDayOfMonth("2026-09-30")).toBe(30)
  })
})

describe("findCellById", () => {
  it("returns the matching cell", () => {
    const collection = buildDevotionsAugustCollection()

    expect(findCellById(collection, "devotion-2026-08-05")?.date).toBe(
      "2026-08-05",
    )
  })

  it("returns null for an unknown id", () => {
    const collection = buildDevotionsAugustCollection()

    expect(findCellById(collection, "not-a-real-id")).toBeNull()
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
