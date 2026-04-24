import { sanitizeQuery } from "./sanitizeQuery"

describe("sanitizeQuery", () => {
  it("returns plain ASCII input unchanged", () => {
    expect(sanitizeQuery("bible")).toBe("bible")
  })

  it("trims leading and trailing whitespace while preserving internal spaces", () => {
    expect(sanitizeQuery("   hello world   ")).toBe("hello world")
  })

  it("preserves emoji", () => {
    expect(sanitizeQuery("prayer \u{1F64F}")).toBe("prayer \u{1F64F}")
  })

  it("strips a C0 control character (tab)", () => {
    expect(sanitizeQuery("bible	stories")).toBe("biblestories")
  })

  it("strips a C0 control character (vertical tab)", () => {
    expect(sanitizeQuery("biblestories")).toBe("biblestories")
  })

  it("strips a C1 control character (DEL)", () => {
    expect(sanitizeQuery("biblestories")).toBe("biblestories")
  })

  it("strips a C1 control character (mid-range)", () => {
    expect(sanitizeQuery("biblestories")).toBe("biblestories")
  })

  it("strips zero-width space (U+200B)", () => {
    expect(sanitizeQuery("bib​lestories")).toBe("biblestories")
  })

  it("strips zero-width joiner (U+200D)", () => {
    expect(sanitizeQuery("bible‍stories")).toBe("biblestories")
  })

  it("strips RTL override (U+202E)", () => {
    expect(sanitizeQuery("bible‮stories")).toBe("biblestories")
  })

  it("normalizes NFKC forms", () => {
    // U+FB01 ligature fi → "fi" under NFKC compatibility normalization.
    expect(sanitizeQuery("ﬁlm")).toBe("film")
  })

  it("caps length at 256 characters", () => {
    const longInput = "a".repeat(500)
    const result = sanitizeQuery(longInput)
    expect(result.length).toBe(256)
  })

  it("returns empty string when input is only whitespace", () => {
    expect(sanitizeQuery("   ")).toBe("")
  })

  it("returns empty string when input is only strippable codepoints", () => {
    // ZWSP + RLO + padding whitespace.
    expect(sanitizeQuery("​‮   ")).toBe("")
  })

  it("preserves non-English Latin characters (accented letters)", () => {
    expect(sanitizeQuery("café")).toBe("café")
  })
})
