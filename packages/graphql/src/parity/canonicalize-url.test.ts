import { describe, expect, it } from "vitest"

import { CanonicalizeUrlError, canonicalizeUrl } from "./canonicalize-url"

const STRAPI = {
  schema: "strapi",
  baseOrigin: "https://cdn.example.com",
} as const
const ADMIN = {
  schema: "admin",
  baseOrigin: "https://cdn.example.com",
} as const

describe("canonicalizeUrl — strapi schema", () => {
  it("expands a root-relative path against baseOrigin", () => {
    const result = canonicalizeUrl("/images/foo.jpg", STRAPI)
    expect(result.canonical).toBe("https://cdn.example.com/images/foo.jpg")
    expect(result.raw).toBe("/images/foo.jpg")
  })

  it("passes through an already-absolute URL unchanged in form", () => {
    const result = canonicalizeUrl("https://other.example.com/foo.jpg", STRAPI)
    expect(result.canonical).toBe("https://other.example.com/foo.jpg")
    expect(result.raw).toBe("https://other.example.com/foo.jpg")
  })

  it("preserves the raw input alongside the canonical output", () => {
    const result = canonicalizeUrl("/images/x.png", STRAPI)
    expect(result.raw).toBe("/images/x.png")
    expect(result.canonical).not.toBe("/images/x.png")
  })
})

describe("canonicalizeUrl — admin schema", () => {
  it("strips a trailing slash from the pathname", () => {
    const result = canonicalizeUrl("https://cdn.example.com/foo.jpg/", ADMIN)
    expect(result.canonical).toBe("https://cdn.example.com/foo.jpg")
  })

  it("strips UTM-style query keys", () => {
    const result = canonicalizeUrl(
      "https://cdn.example.com/foo.jpg?utm_source=email&utm_campaign=launch",
      ADMIN,
    )
    expect(result.canonical).toBe("https://cdn.example.com/foo.jpg")
  })

  it("strips gclid and fbclid tracking keys", () => {
    const result = canonicalizeUrl(
      "https://cdn.example.com/foo.jpg?gclid=abc&fbclid=def",
      ADMIN,
    )
    expect(result.canonical).toBe("https://cdn.example.com/foo.jpg")
  })

  it("preserves non-tracking query keys", () => {
    const result = canonicalizeUrl(
      "https://cdn.example.com/foo.jpg?width=400&utm_source=email",
      ADMIN,
    )
    expect(result.canonical).toBe("https://cdn.example.com/foo.jpg?width=400")
  })

  it("lowercases the host", () => {
    const result = canonicalizeUrl("https://CDN.Example.COM/foo.jpg", ADMIN)
    expect(result.canonical).toBe("https://cdn.example.com/foo.jpg")
  })

  it("preserves the raw input verbatim regardless of canonicalization", () => {
    const raw = "https://cdn.example.com/foo.jpg/?utm_source=email"
    const result = canonicalizeUrl(raw, ADMIN)
    expect(result.raw).toBe(raw)
    expect(result.canonical).toBe("https://cdn.example.com/foo.jpg")
  })

  it("preserves the root pathname '/'", () => {
    const result = canonicalizeUrl("https://cdn.example.com/", ADMIN)
    expect(result.canonical).toBe("https://cdn.example.com/")
  })
})

describe("canonicalizeUrl — error / failure modes", () => {
  it("throws on empty input", () => {
    expect(() => canonicalizeUrl("", STRAPI)).toThrow(CanonicalizeUrlError)
  })

  it("returns a structured failure for a malformed absolute URL", () => {
    const result = canonicalizeUrl("not a url", STRAPI)
    expect(result.canonical).toBeNull()
    if (result.canonical === null) {
      expect(result.reason).toBe("malformed")
      expect(result.raw).toBe("not a url")
    }
  })

  it("returns a structured failure for a Strapi-relative path with an invalid base", () => {
    // baseOrigin without a scheme — `new URL("/foo", "garbage")` throws.
    const result = canonicalizeUrl("/foo.jpg", {
      schema: "strapi",
      baseOrigin: "garbage",
    })
    expect(result.canonical).toBeNull()
  })

  it("does NOT throw on malformed input — only empty input throws", () => {
    expect(() =>
      canonicalizeUrl("totally://broken url with spaces", STRAPI),
    ).not.toThrow()
  })
})
