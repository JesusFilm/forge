import {
  applyKey,
  buildActionRow,
  buildLetterRows,
  GRID_COLUMNS,
} from "./keyGrid"

describe("buildLetterRows", () => {
  it("lays 26 letters into 6-column rows (6,6,6,6,2)", () => {
    const rows = buildLetterRows(false)
    expect(rows.map((r) => r.length)).toEqual([6, 6, 6, 6, 2])
    expect(rows.flat()).toHaveLength(26)
    expect(
      rows
        .flat()
        .map((k) => k.label)
        .join(""),
    ).toBe("abcdefghijklmnopqrstuvwxyz")
  })

  it("honors a custom column count", () => {
    const rows = buildLetterRows(false, 7)
    expect(rows.map((r) => r.length)).toEqual([7, 7, 7, 5])
    expect(rows[0]).toHaveLength(GRID_COLUMNS + 1)
  })

  it("renders lowercase by default and uppercase when shifted", () => {
    expect(buildLetterRows(false).flat()[0].label).toBe("a")
    expect(buildLetterRows(true).flat()[0].label).toBe("A")
  })

  it("each letter dispatches its own displayed (cased) character", () => {
    for (const key of buildLetterRows(false).flat()) {
      expect(key.action).toEqual({ kind: "char", char: key.label })
    }
    for (const key of buildLetterRows(true).flat()) {
      expect(key.action).toEqual({ kind: "char", char: key.label })
      expect(key.label).toMatch(/^[A-Z]$/)
    }
  })

  it("uses position-based ids stable across the case toggle", () => {
    // Same id at the same grid position regardless of case, so a shift
    // toggle changes the label in place without remounting the cell.
    const lower = buildLetterRows(false)
      .flat()
      .map((k) => k.id)
    const upper = buildLetterRows(true)
      .flat()
      .map((k) => k.id)
    expect(lower).toEqual(upper)
    expect(lower[0]).toBe("letter-0")
    expect(new Set(lower).size).toBe(lower.length)
  })
})

describe("buildActionRow", () => {
  it("is shift · space · delete · search, with space wide", () => {
    const row = buildActionRow(false)
    expect(row.map((k) => k.action.kind)).toEqual([
      "shift",
      "space",
      "backspace",
      "submit",
    ])
    expect(row.find((k) => k.action.kind === "space")?.wide).toBe(true)
    for (const key of row) expect(key.accessibilityLabel).toBeTruthy()
  })

  it("the shift key shows the case it switches TO", () => {
    expect(buildActionRow(false).find((k) => k.id === "shift")?.label).toBe(
      "ABC",
    )
    expect(buildActionRow(true).find((k) => k.id === "shift")?.label).toBe(
      "abc",
    )
  })

  it("ids across letters + action row are unique", () => {
    const ids = [
      ...buildLetterRows(false).flat(),
      ...buildActionRow(false),
    ].map((k) => k.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("applyKey", () => {
  it("appends the (already-cased) char to the query", () => {
    expect(applyKey("ab", { kind: "char", char: "c" })).toBe("abc")
    expect(applyKey("AB", { kind: "char", char: "C" })).toBe("ABC")
    expect(applyKey("", { kind: "char", char: "a" })).toBe("a")
  })

  it("appends a space only when the query is non-empty (no leading space)", () => {
    expect(applyKey("ab", { kind: "space" })).toBe("ab ")
    expect(applyKey("", { kind: "space" })).toBeNull()
  })

  it("drops the last char on backspace, no-op on empty", () => {
    expect(applyKey("abc", { kind: "backspace" })).toBe("ab")
    expect(applyKey("a", { kind: "backspace" })).toBe("")
    expect(applyKey("", { kind: "backspace" })).toBeNull()
  })

  it("returns null for submit and shift (no value change)", () => {
    expect(applyKey("ab", { kind: "submit" })).toBeNull()
    expect(applyKey("ab", { kind: "shift" })).toBeNull()
    expect(applyKey("", { kind: "shift" })).toBeNull()
  })
})
