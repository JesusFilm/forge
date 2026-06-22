import {
  applyKey,
  buildActionRow,
  buildLetterRows,
  buildLinearKeys,
  GRID_COLUMNS,
  GRID_KEY_DIMS,
  LINEAR_KEY_DIMS,
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

describe("buildLinearKeys", () => {
  it("is 26 letters followed by the action row (shift · space · delete · search)", () => {
    const keys = buildLinearKeys(false)
    expect(keys).toHaveLength(30)
    expect(
      keys
        .slice(0, 26)
        .map((k) => k.label)
        .join(""),
    ).toBe("abcdefghijklmnopqrstuvwxyz")
    expect(keys.slice(26).map((k) => k.action.kind)).toEqual([
      "shift",
      "space",
      "backspace",
      "submit",
    ])
  })

  it("flips every letter to uppercase when shifted, action row unchanged in kind", () => {
    const upper = buildLinearKeys(true)
    expect(
      upper
        .slice(0, 26)
        .map((k) => k.label)
        .join(""),
    ).toBe("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    expect(upper.slice(26).map((k) => k.action.kind)).toEqual([
      "shift",
      "space",
      "backspace",
      "submit",
    ])
  })

  it("has unique ids across the whole row", () => {
    const ids = buildLinearKeys(false).map((k) => k.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("reuses position-based letter ids (stable across case toggle)", () => {
    expect(buildLinearKeys(false).map((k) => k.id)).toEqual(
      buildLinearKeys(true).map((k) => k.id),
    )
    expect(buildLinearKeys(false)[0].id).toBe("letter-0")
  })
})

describe("key dimension tokens", () => {
  // Pin the exact values: GRID_KEY_DIMS reproduces SearchKeyboard's pixel
  // values, so a stray edit would silently shift the Android grid. Converts
  // the "byte-identical Android" guarantee from a one-time check into a CI contract.
  it("GRID_KEY_DIMS reproduces the grid's pixel values", () => {
    expect(GRID_KEY_DIMS).toEqual({
      size: 72,
      wideWidth: 154,
      radius: 12,
      labelFontSize: 26,
      iconSize: 28,
    })
  })

  it("LINEAR_KEY_DIMS holds the single-line keyboard values", () => {
    expect(LINEAR_KEY_DIMS).toEqual({
      size: 48,
      wideWidth: 72,
      radius: 10,
      labelFontSize: 20,
      iconSize: 24,
    })
  })
})
