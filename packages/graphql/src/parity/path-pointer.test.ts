import { describe, expect, it } from "vitest"

import { comparePointer, encodePointer } from "./path-pointer"

describe("encodePointer", () => {
  it("encodes a simple path", () => {
    expect(encodePointer(["blocks", 3, "items", 0, "url"])).toBe(
      "/blocks/3/items/0/url",
    )
  })

  it("returns empty string for the root pointer", () => {
    expect(encodePointer([])).toBe("")
  })

  it("escapes ~ as ~0", () => {
    expect(encodePointer(["foo~bar"])).toBe("/foo~0bar")
  })

  it("escapes / as ~1", () => {
    expect(encodePointer(["a/b"])).toBe("/a~1b")
  })

  it("escapes ~ before /", () => {
    // Per RFC6901: ~ must be encoded first as ~0, then / as ~1.
    // A literal "~/" must round-trip through "~0~1".
    expect(encodePointer(["~/"])).toBe("/~0~1")
  })

  it("emits numeric segments as decimal strings", () => {
    expect(encodePointer(["a", 0, 10, 100])).toBe("/a/0/10/100")
  })
})

describe("comparePointer", () => {
  it("returns 0 for equal paths", () => {
    expect(comparePointer("/a/b", "/a/b")).toBe(0)
  })

  it("sorts /blocks/2 before /blocks/10 (numeric-aware)", () => {
    expect(comparePointer("/blocks/2", "/blocks/10")).toBeLessThan(0)
  })

  it("sorts non-numeric segments lexicographically", () => {
    expect(comparePointer("/blocks/abc", "/blocks/abd")).toBeLessThan(0)
  })

  it("falls back to string compare when only one side is numeric", () => {
    // ASCII: "2" (0x32) < "a" (0x61). Digit segments compared as strings
    // sort before non-digit segments — segment-position parity matters,
    // not numeric semantics on a mixed pair.
    const cmp = comparePointer("/blocks/abc", "/blocks/2")
    expect(cmp).toBeGreaterThan(0)
  })

  it("sorts shorter prefixes before longer paths sharing the prefix", () => {
    expect(comparePointer("/blocks", "/blocks/0")).toBeLessThan(0)
  })

  it("treats the root pointer as smallest", () => {
    expect(comparePointer("", "/anything")).toBeLessThan(0)
  })

  it("orders a numeric report deterministically", () => {
    // Production-shaped scenario — verifies the contract used by the differ.
    const paths = [
      "/blocks/10",
      "/blocks/2",
      "/blocks/3",
      "/description",
      "/blocks/0/items/2",
    ]
    const sorted = [...paths].sort(comparePointer)
    expect(sorted).toEqual([
      "/blocks/0/items/2",
      "/blocks/2",
      "/blocks/3",
      "/blocks/10",
      "/description",
    ])
  })

  it("rejects -0 as a numeric segment (treats as string)", () => {
    // The sort fallback for non-canonical numeric forms must be string compare.
    // "-0" doesn't pass /^[0-9]+$/, so it falls back to string ordering.
    expect(comparePointer("/-0", "/0")).toBeLessThan(0)
  })
})
