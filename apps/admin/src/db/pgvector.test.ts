import { describe, expect, it } from "vitest"
import { toPgArray, toPgVector } from "@/db/pgvector"

describe("toPgArray", () => {
  it("returns empty literal for empty input", () => {
    expect(toPgArray([])).toBe("{}")
  })

  it("quotes and comma-joins simple values", () => {
    expect(toPgArray(["a", "b", "c"])).toBe('{"a","b","c"}')
  })

  it("escapes embedded double quotes", () => {
    expect(toPgArray(['he said "hi"'])).toBe('{"he said \\"hi\\""}')
  })

  it("preserves spaces and commas inside values via quoting", () => {
    expect(toPgArray(["a, b", "c d"])).toBe('{"a, b","c d"}')
  })

  it("rejects brace characters", () => {
    expect(() => toPgArray(["ok", "bad{val}"])).toThrow(/unsupported character/)
  })

  it("rejects backslash characters", () => {
    expect(() => toPgArray(["a\\b"])).toThrow(/unsupported character/)
  })
})

describe("toPgVector", () => {
  it("returns empty literal for empty input", () => {
    expect(toPgVector([])).toBe("[]")
  })

  it("formats a 1536-dim float array", () => {
    const v = [0.1, -0.2, 0.3]
    expect(toPgVector(v)).toBe("[0.1,-0.2,0.3]")
  })

  it("does not wrap integers in quotes", () => {
    expect(toPgVector([1, 2, 3])).toBe("[1,2,3]")
  })
})
