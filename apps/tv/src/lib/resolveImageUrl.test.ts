import { resolveImageUrl } from "./resolveImageUrl"

// The production static-asset HOST is pinned separately, at the source, in
// resolveImageUrl.guard.test.js — that check needs Node's fs/path, which this
// tsconfig has no types for (same precedent as zeroPii.guard.test.js).
describe("resolveImageUrl — behavior", () => {
  it("prefixes a relative CMS path with the static base", () => {
    const resolved = resolveImageUrl("/images/favicon-32.png")
    expect(resolved).not.toBeNull()
    expect(resolved).toMatch(/\/images\/favicon-32\.png$/)
  })

  it("passes an absolute https URL through untouched", () => {
    const url = "https://image.mux.com/abc123/thumbnail.png"
    expect(resolveImageUrl(url)).toBe(url)
  })

  it("rejects dangerous schemes rather than rendering them", () => {
    // CMS-sourced values reach this directly, so a javascript:/data: payload
    // must not survive into an <Image source>.
    expect(resolveImageUrl("javascript:alert(1)")).toBeNull()
    expect(resolveImageUrl("data:image/png;base64,AAAA")).toBeNull()
    expect(resolveImageUrl("file:///etc/passwd")).toBeNull()
  })

  it("rejects a protocol-relative URL instead of treating it as a path", () => {
    // `//evil.example/x.png` starts with "/" but is NOT a local asset path.
    // The `!url.startsWith("//")` guard keeps it out of the prefix branch, and
    // it then fails URL parsing — so an attacker-supplied CMS value cannot be
    // rewritten into `https://www.jesusfilm.org/watch//evil.example/x.png`
    // nor loaded from evil.example.
    expect(resolveImageUrl("//evil.example/x.png")).toBeNull()
  })

  it("returns null for empty input", () => {
    expect(resolveImageUrl(null)).toBeNull()
    expect(resolveImageUrl(undefined)).toBeNull()
    expect(resolveImageUrl("")).toBeNull()
  })
})
