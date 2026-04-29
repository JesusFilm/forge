import { sanitizeQuery } from "./sanitizeQuery"

describe("sanitizeQuery", () => {
  it("returns plain ASCII input unchanged", () => {
    expect(sanitizeQuery("bible")).toBe("bible")
  })

  it("preserves leading, internal, and trailing whitespace", () => {
    // sanitizeQuery is a pure normalizer (NFKC + strip control /
    // directional codepoints + cap). It runs on EVERY keystroke from
    // the on-screen keyboard, so trimming would either eat the space
    // a user just pressed (before they type the next letter) or
    // collapse "hello world" → "helloworld" mid-typing. Empty-query
    // gating happens at the firing site (runSearch / debounce effect)
    // via .trim().length checks, not here.
    expect(sanitizeQuery("   hello world   ")).toBe("   hello world   ")
  })

  it("preserves an internal space mid-typing (keyboard regression)", () => {
    // The on-screen keyboard's space key fires onChange(value + " ")
    // — if sanitizeQuery stripped the trailing space the user just
    // pressed, the next letter would land directly after the prior
    // word ("hellow") instead of starting a new word ("hello w").
    // The previous .trim() implementation broke this exact path.
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
    // Whitespace-only input is NOT empty per sanitizeQuery's contract;
    // it's a string of preserved spaces. The firing site
    // (useSemanticSearch.runSearch + the debounce effect) checks
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
