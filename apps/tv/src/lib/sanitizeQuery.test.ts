import { sanitizeQuery } from "./sanitizeQuery"

describe("sanitizeQuery", () => {
  it("returns plain ASCII input unchanged", () => {
    expect(sanitizeQuery("bible")).toBe("bible")
  })

  it("preserves leading, internal, and trailing whitespace", () => {
    // Pure normalizer runs per-keystroke, so trimming would eat the
    // just-pressed space or collapse "hello world". Empty-query gating
    // is the firing site's job (.trim().length checks), not here.
    expect(sanitizeQuery("   hello world   ")).toBe("   hello world   ")
  })

  it("preserves an internal space mid-typing (keyboard regression)", () => {
    // Space key fires onChange(value + " "); stripping that trailing
    // space lands the next letter as "hellow" not "hello w". The old
    // .trim() implementation broke this exact path.
    expect(sanitizeQuery("hello world")).toBe("hello world")
    expect(sanitizeQuery("hello ")).toBe("hello ")
    expect(sanitizeQuery("hello w")).toBe("hello w")
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

  it("preserves whitespace-only input verbatim (firing-site rejects it)", () => {
    // Whitespace-only is NOT empty per the contract; it's preserved
    // spaces. The firing site (runSearch + debounce effect) checks
    // q.trim().length === 0 and skips the network call there.
    expect(sanitizeQuery("   ")).toBe("   ")
  })

  it("returns empty string when input is only strippable codepoints", () => {
    // ZWSP + RLO get stripped; the remaining "   " survives because
    // sanitizeQuery doesn't trim. Verifies the strippable-codepoint
    // class still gets removed even when intermixed with spaces.
    expect(sanitizeQuery("​‮")).toBe("")
    expect(sanitizeQuery("​‮   ")).toBe("   ")
  })

  it("preserves non-English Latin characters (accented letters)", () => {
    expect(sanitizeQuery("café")).toBe("café")
  })
})
