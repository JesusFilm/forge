import { describe, expect, it } from "vitest"
import { buildSearchUrl } from "./search-url"

describe("buildSearchUrl", () => {
  it("sets ?q= on an otherwise-empty URL", () => {
    const result = buildSearchUrl("/", new URLSearchParams(), "forgiveness")
    expect(result).toBe("/?q=forgiveness")
  })

  it("preserves existing query params when adding q", () => {
    const result = buildSearchUrl(
      "/jesus/en",
      new URLSearchParams("utm=abc"),
      "love",
    )
    // URLSearchParams ordering is insertion-order; utm was first.
    expect(result).toBe("/jesus/en?utm=abc&q=love")
  })

  it("preserves existing query params when clearing q", () => {
    const result = buildSearchUrl("/", new URLSearchParams("q=foo&utm=bar"), "")
    expect(result).toBe("/?utm=bar")
  })

  it("returns bare pathname when clearing the only param", () => {
    const result = buildSearchUrl("/", new URLSearchParams("q=foo"), "")
    expect(result).toBe("/")
  })

  it("returns bare pathname when given empty params and empty query", () => {
    const result = buildSearchUrl("/", new URLSearchParams(), "")
    expect(result).toBe("/")
  })

  it("url-encodes spaces and special characters", () => {
    const result = buildSearchUrl("/", new URLSearchParams(), "peace & love")
    // URLSearchParams uses + for spaces and percent-encodes the ampersand.
    expect(result).toBe("/?q=peace+%26+love")
  })

  it("trims whitespace-only queries to empty and strips q", () => {
    const result = buildSearchUrl("/", new URLSearchParams("q=foo"), "   ")
    expect(result).toBe("/")
  })

  it("does not duplicate q when existingParams already has one", () => {
    const result = buildSearchUrl(
      "/",
      new URLSearchParams("q=stale&utm=abc"),
      "fresh",
    )
    expect(result).toBe("/?q=fresh&utm=abc")
  })

  it("does not duplicate q when existingParams already has one (q last)", () => {
    const result = buildSearchUrl(
      "/",
      new URLSearchParams("utm=abc&q=stale"),
      "fresh",
    )
    // URLSearchParams.set() updates in place, preserving insertion order.
    expect(result).toBe("/?utm=abc&q=fresh")
  })
})
