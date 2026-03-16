import { Linking } from "react-native"

import {
  isInternalLink,
  parseInternalRoute,
  navigateLink,
} from "./navigateLink"

jest.mock("react-native", () => ({
  Linking: { openURL: jest.fn(() => Promise.resolve()) },
}))

beforeEach(() => {
  jest.clearAllMocks()
})

describe("isInternalLink", () => {
  it("returns true for relative paths", () => {
    expect(isInternalLink("/watch")).toBe(true)
    expect(isInternalLink("/watch/easter.html")).toBe(true)
    expect(isInternalLink("/")).toBe(true)
  })

  it("returns true for absolute app-domain URLs", () => {
    expect(isInternalLink("https://www.jesusfilm.org/watch/easter.html")).toBe(
      true,
    )
    expect(isInternalLink("https://jesusfilm.org/watch/easter")).toBe(true)
    expect(isInternalLink("https://www.jesusfilm.org")).toBe(true)
  })

  it("returns false for non-app-domain absolute URLs", () => {
    expect(isInternalLink("http://example.com")).toBe(false)
    expect(isInternalLink("https://google.com")).toBe(false)
    expect(isInternalLink("mailto:test@example.com")).toBe(false)
  })

  it("returns false for protocol-relative URLs", () => {
    expect(isInternalLink("//example.com/path")).toBe(false)
    expect(isInternalLink("//www.jesusfilm.org/watch")).toBe(false)
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

  it("parses absolute app-domain /watch/ URLs", () => {
    expect(
      parseInternalRoute("https://www.jesusfilm.org/watch/easter.html"),
    ).toEqual({
      screen: "Experience",
      params: { slug: "easter" },
    })
    expect(parseInternalRoute("https://jesusfilm.org/watch/christmas")).toEqual(
      {
        screen: "Experience",
        params: { slug: "christmas" },
      },
    )
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

  it("calls navigate for absolute app-domain /watch/ links", () => {
    const navigate = jest.fn()
    navigateLink("https://www.jesusfilm.org/watch/easter.html", navigate)
    expect(navigate).toHaveBeenCalledWith("Experience", { slug: "easter" })
    expect(Linking.openURL).not.toHaveBeenCalled()
  })

  it("does not call navigate for external links", () => {
    const navigate = jest.fn()
    navigateLink("https://example.com", navigate)
    expect(navigate).not.toHaveBeenCalled()
    expect(Linking.openURL).toHaveBeenCalledWith("https://example.com")
  })

  it("falls back to full URL for unrecognized internal paths", () => {
    const navigate = jest.fn()
    navigateLink("/about", navigate)
    expect(navigate).not.toHaveBeenCalled()
    expect(Linking.openURL).toHaveBeenCalledWith(
      "https://www.jesusfilm.org/about",
    )
  })

  it("falls back to original URL for unrecognized app-domain paths", () => {
    const navigate = jest.fn()
    navigateLink("https://www.jesusfilm.org/contact", navigate)
    expect(navigate).not.toHaveBeenCalled()
    expect(Linking.openURL).toHaveBeenCalledWith(
      "https://www.jesusfilm.org/contact",
    )
  })
})
