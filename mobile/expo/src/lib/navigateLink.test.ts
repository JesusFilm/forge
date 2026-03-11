import {
  isInternalLink,
  parseInternalRoute,
  navigateLink,
} from "./navigateLink"

describe("isInternalLink", () => {
  it("returns true for relative paths", () => {
    expect(isInternalLink("/watch")).toBe(true)
    expect(isInternalLink("/watch/easter.html")).toBe(true)
    expect(isInternalLink("/")).toBe(true)
  })

  it("returns false for absolute URLs", () => {
    expect(isInternalLink("https://www.jesusfilm.org")).toBe(false)
    expect(isInternalLink("http://example.com")).toBe(false)
    expect(isInternalLink("mailto:test@example.com")).toBe(false)
  })
})

describe("parseInternalRoute", () => {
  it("parses /watch/{slug} to Experience screen", () => {
    expect(parseInternalRoute("/watch/easter")).toEqual({
      screen: "Experience",
      params: { slug: "easter" },
    })
  })

  it("strips .html extension from slug", () => {
    expect(parseInternalRoute("/watch/easter.html")).toEqual({
      screen: "Experience",
      params: { slug: "easter" },
    })
  })

  it("handles nested paths under /watch/", () => {
    expect(parseInternalRoute("/watch/easter.html/english.html")).toEqual({
      screen: "Experience",
      params: { slug: "easter" },
    })
  })

  it("returns null for unrecognized internal paths", () => {
    expect(parseInternalRoute("/")).toBeNull()
    expect(parseInternalRoute("/about")).toBeNull()
    expect(parseInternalRoute("/watch")).toBeNull()
  })
})

describe("navigateLink", () => {
  it("calls navigate for internal /watch/ links", () => {
    const navigate = jest.fn()
    navigateLink("/watch/easter", navigate)
    expect(navigate).toHaveBeenCalledWith("Experience", { slug: "easter" })
  })

  it("does not call navigate for external links", () => {
    const navigate = jest.fn()
    navigateLink("https://www.jesusfilm.org", navigate)
    expect(navigate).not.toHaveBeenCalled()
  })

  it("falls back to external for unrecognized internal paths", () => {
    const navigate = jest.fn()
    navigateLink("/about", navigate)
    expect(navigate).not.toHaveBeenCalled()
  })
})
