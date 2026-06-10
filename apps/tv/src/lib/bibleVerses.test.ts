import {
  bookSlugForApi,
  formatScripture,
  isFetchedScripture,
} from "./bibleVerses"

describe("bookSlugForApi", () => {
  it("lowercases and strips whitespace ('1 Corinthians' → '1corinthians')", () => {
    expect(bookSlugForApi("1 Corinthians")).toBe("1corinthians")
    expect(bookSlugForApi("Psalms")).toBe("psalms")
  })

  it("rejects names that would not be a safe path segment", () => {
    expect(bookSlugForApi("../etc")).toBeNull()
    expect(bookSlugForApi("john?x=1")).toBeNull()
    expect(bookSlugForApi("Génesis")).toBeNull()
  })
})

describe("formatScripture", () => {
  it("strips inline footnotes introduced by ';N…' and ',N:N…'", () => {
    expect(formatScripture("For God so loved;2 footnote text")).toBe(
      "For God so loved",
    )
    expect(formatScripture("He said,3:4 cross-ref tail")).toBe("He said")
  })

  it("collapses newlines and trims", () => {
    expect(formatScripture("  line one\nline two \n")).toBe("line one line two")
  })
})

describe("isFetchedScripture", () => {
  it("accepts the API's { text } shape with non-empty text", () => {
    expect(isFetchedScripture({ verse: "1", text: "In the beginning" })).toBe(
      true,
    )
  })

  it("rejects null, missing text, non-string text, and empty text", () => {
    expect(isFetchedScripture(null)).toBe(false)
    expect(isFetchedScripture({ verse: "1" })).toBe(false)
    expect(isFetchedScripture({ text: 42 })).toBe(false)
    expect(isFetchedScripture({ text: "" })).toBe(false)
  })
})
