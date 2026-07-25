import { describe, expect, it } from "vitest"

import { normalizePublicShareableOrigin } from "./url"
import { resolveWatchShareUrl, resolveWatchShareUrlFromPathname } from "./share"

const publicPath = "/watch/the-call.html"

describe("resolveWatchShareUrl", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.2:3000",
    "http://192.168.1.20:3000",
    "http://169.254.1.2:3000",
    "http://forge.local:3000",
    "http://forge.local.:3000",
    "http://tenant.localhost:3000",
    "http://localhost.:3000",
    "http://[::1]:3000",
    "http://[fd00::1]:3000",
  ])("uses the indexed public origin for %s", (origin) => {
    expect(
      resolveWatchShareUrl({
        origin,
        videoSlug: "the-call",
        languageSlug: "english",
      }),
    ).toBe(`https://www.jesusfilm.org${publicPath}`)
  })

  it("preserves and normalizes a configured public origin", () => {
    expect(
      resolveWatchShareUrl({
        origin: "https://preview.example/some/path?ignored=1",
        videoSlug: "the-call",
        languageSlug: "english",
      }),
    ).toBe(`https://preview.example${publicPath}`)
  })

  it("falls back when a direct caller supplies an invalid origin", () => {
    expect(
      resolveWatchShareUrl({
        origin: "not-a-url",
        videoSlug: "the-call",
        languageSlug: "english",
      }),
    ).toBe(`https://www.jesusfilm.org${publicPath}`)
  })

  it("falls back instead of preserving credentials", () => {
    expect(
      resolveWatchShareUrl({
        origin: "https://user:pass@preview.example",
        videoSlug: "the-call",
        languageSlug: "english",
      }),
    ).toBe(`https://www.jesusfilm.org${publicPath}`)
  })

  it.each([
    { videoSlug: "", languageSlug: "english" },
    { videoSlug: "The-Call", languageSlug: "english" },
    { videoSlug: "the-call", languageSlug: "" },
    { videoSlug: "the-call", languageSlug: "en/us" },
  ])("returns null for invalid content identity: %o", (identity) => {
    expect(
      resolveWatchShareUrl({
        origin: "http://localhost:3000",
        ...identity,
      }),
    ).toBeNull()
  })

  it("keeps international and public-language collision URLs explicit", () => {
    expect(
      resolveWatchShareUrl({
        origin: "https://www.jesusfilm.org",
        videoSlug: "the-call",
        languageSlug: "romanian",
      }),
    ).toBe("https://www.jesusfilm.org/watch/the-call.html/romanian.html")
    expect(
      resolveWatchShareUrl({
        origin: "https://www.jesusfilm.org",
        videoSlug: "russian",
        languageSlug: "english",
      }),
    ).toBe("https://www.jesusfilm.org/watch/russian.html/english.html")
  })
})

describe("resolveWatchShareUrlFromPathname", () => {
  it("resolves a standalone pathname with the Watch base path", () => {
    expect(
      resolveWatchShareUrlFromPathname({
        origin: "http://localhost:3000",
        pathname: "/watch/the-call.html/english.html",
      }),
    ).toBe(`https://www.jesusfilm.org${publicPath}`)
  })

  it("shares contextual episodes by their standalone child identity", () => {
    expect(
      resolveWatchShareUrlFromPathname({
        origin: "http://localhost:3000",
        pathname: "/watch/lumo-the-gospel-of-john.html/the-call/english.html",
      }),
    ).toBe(`https://www.jesusfilm.org${publicPath}`)
  })

  it("preserves known non-video Watch routes on the public origin", () => {
    expect(
      resolveWatchShareUrlFromPathname({
        origin: "http://localhost:3000",
        pathname: "/watch",
      }),
    ).toBe("https://www.jesusfilm.org/watch")
    expect(
      resolveWatchShareUrlFromPathname({
        origin: "http://localhost:3000",
        pathname: "/watch/english.html",
      }),
    ).toBe("https://www.jesusfilm.org/watch/english.html")
  })

  it("returns null for unknown Watch routes", () => {
    expect(
      resolveWatchShareUrlFromPathname({
        origin: "http://localhost:3000",
        pathname: "/watch/not/a/recognized/route",
      }),
    ).toBeNull()
  })
})

describe("normalizePublicShareableOrigin", () => {
  it("accepts and normalizes public HTTP(S) origins", () => {
    expect(normalizePublicShareableOrigin("https://www.jesusfilm.org")).toBe(
      "https://www.jesusfilm.org",
    )
    expect(normalizePublicShareableOrigin("http://preview.example/path")).toBe(
      "http://preview.example",
    )
  })

  it("rejects credentials and non-HTTP protocols", () => {
    expect(
      normalizePublicShareableOrigin("https://user:pass@example.com"),
    ).toBeNull()
    expect(normalizePublicShareableOrigin("ftp://example.com")).toBeNull()
  })
})
