import {
  acceptSheetTap,
  assembleSheetList,
  SHEET_DOUBLE_TAP_WINDOW_MS,
} from "../sheetListLogic"

type Row = {
  slug: string
  name: string | null
  native?: string | null
}

const params = (rows: Row[], activeId: string | null, query: string) => ({
  rows,
  activeId,
  query,
  getSelectionId: (r: Row) => r.slug,
  getPrimaryLabel: (r: Row) => r.name ?? r.slug,
  getSearchValues: (r: Row) => [r.name ?? r.slug, r.native],
})

describe("acceptSheetTap", () => {
  it("rejects a second tap inside the 500ms window", () => {
    expect(acceptSheetTap(1000, 1000)).toBe(false)
    expect(acceptSheetTap(1000 + SHEET_DOUBLE_TAP_WINDOW_MS - 1, 1000)).toBe(
      false,
    )
  })

  it("accepts the first tap and any tap at or past the window boundary", () => {
    expect(acceptSheetTap(0, 0)).toBe(false)
    expect(acceptSheetTap(SHEET_DOUBLE_TAP_WINDOW_MS, 0)).toBe(true)
    expect(acceptSheetTap(9999, 0)).toBe(true)
  })
})

describe("assembleSheetList", () => {
  const rows: Row[] = [
    { slug: "es", name: "Spanish", native: "Español" },
    { slug: "en", name: "English", native: "English" },
    { slug: "fr", name: "French", native: "Français" },
  ]

  it("sorts by primary label (case-insensitive)", () => {
    const { filtered } = assembleSheetList(params(rows, null, ""))
    expect(filtered.map((r) => r.slug)).toEqual(["en", "fr", "es"])
  })

  it("hoists the active row out of the list and into `active`", () => {
    const { active, filtered } = assembleSheetList(params(rows, "en", ""))
    expect(active?.slug).toBe("en")
    expect(filtered.map((r) => r.slug)).toEqual(["fr", "es"])
  })

  it("returns no active row for null or empty activeId", () => {
    expect(assembleSheetList(params(rows, null, "")).active).toBeNull()
    expect(assembleSheetList(params(rows, "", "")).active).toBeNull()
    expect(assembleSheetList(params(rows, "", "")).filtered).toHaveLength(3)
  })

  it("filters across all search values, then still excludes the active row", () => {
    const byNative = assembleSheetList(params(rows, null, "Español"))
    expect(byNative.filtered.map((r) => r.slug)).toEqual(["es"])

    const active = assembleSheetList(params(rows, "es", "es"))
    // "es" matches Spanish/Español but the active row is dropped from the list.
    expect(active.filtered.map((r) => r.slug)).toEqual([])
  })

  it("skips null search values without throwing", () => {
    const sparse: Row[] = [{ slug: "en", name: null, native: null }]
    const { filtered } = assembleSheetList(params(sparse, null, "en"))
    // Falls back to slug as the primary label, which matches "en".
    expect(filtered.map((r) => r.slug)).toEqual(["en"])
  })

  it("keys on the selection slug, never bcp47 (ko / ko-kmr do not collide)", () => {
    const langs: Row[] = [
      { slug: "ko", name: "Korean" },
      { slug: "ko-kmr", name: "Kurmanji" },
    ]
    const { active, filtered } = assembleSheetList(params(langs, "ko", ""))
    expect(active?.slug).toBe("ko")
    expect(filtered.map((r) => r.slug)).toEqual(["ko-kmr"])
  })
})
