import { describe, expect, it } from "vitest"
import {
  parseAllowedHosts,
  SourceUrlRejectedError,
  validateSourceUrl,
} from "./source-url.js"

const ALLOWED = ["stream.mux.com"]

describe("parseAllowedHosts", () => {
  it("splits, trims, lowercases, and drops empty entries", () => {
    expect(parseAllowedHosts(" Stream.Mux.Com ,, 127.0.0.1 ")).toEqual([
      "stream.mux.com",
      "127.0.0.1",
    ])
  })

  it("returns an empty list for undefined", () => {
    expect(parseAllowedHosts(undefined)).toEqual([])
  })
})

describe("validateSourceUrl (production)", () => {
  // The full rejection matrix required by plan decision 10.
  it.each([
    ["suffix spoof", "https://stream.mux.com.evil.com/x.m3u8"],
    ["loopback", "https://127.0.0.1/x"],
    ["link-local metadata", "https://169.254.169.254/x"],
    ["file smuggle", "file:///etc/passwd"],
    ["data smuggle", "data:text/html,x"],
    ["http downgrade", "http://stream.mux.com/x"],
  ])("rejects %s: %s", (_label, url) => {
    expect(() => validateSourceUrl(url, ALLOWED, true)).toThrow(
      SourceUrlRejectedError,
    )
  })

  it("rejects unparseable URLs", () => {
    expect(() => validateSourceUrl("not a url", ALLOWED, true)).toThrow(
      SourceUrlRejectedError,
    )
  })

  it("accepts the exact allowlisted https host", () => {
    const validated = validateSourceUrl(
      "https://stream.mux.com/abc.m3u8",
      ALLOWED,
      true,
    )
    expect(validated.url.hostname).toBe("stream.mux.com")
    expect(validated.loopbackHttp).toBe(false)
  })

  it("matches hostnames case-insensitively", () => {
    expect(
      validateSourceUrl("https://STREAM.MUX.COM/abc.m3u8", ALLOWED, true)
        .loopbackHttp,
    ).toBe(false)
  })

  it("never allows http in production, even for an allowlisted 127.0.0.1", () => {
    expect(() =>
      validateSourceUrl(
        "http://127.0.0.1:8080/clip.mp4",
        ["stream.mux.com", "127.0.0.1"],
        true,
      ),
    ).toThrow(SourceUrlRejectedError)
  })
})

describe("validateSourceUrl (non-production loopback)", () => {
  it("allows http://127.0.0.1 ONLY when 127.0.0.1 is explicitly allowlisted", () => {
    const validated = validateSourceUrl(
      "http://127.0.0.1:8080/clip.mp4",
      ["127.0.0.1"],
      false,
    )
    expect(validated.loopbackHttp).toBe(true)
  })

  it("rejects http://127.0.0.1 when 127.0.0.1 is NOT in the allowlist", () => {
    expect(() =>
      validateSourceUrl("http://127.0.0.1:8080/clip.mp4", ALLOWED, false),
    ).toThrow(SourceUrlRejectedError)
  })

  it("rejects http for non-loopback hosts outside production too", () => {
    expect(() =>
      validateSourceUrl("http://stream.mux.com/x.m3u8", ALLOWED, false),
    ).toThrow(SourceUrlRejectedError)
    expect(() =>
      validateSourceUrl("http://localhost:8080/x.mp4", ["localhost"], false),
    ).toThrow(SourceUrlRejectedError)
  })

  it("classifies rejections as deterministic (retryable false)", () => {
    try {
      validateSourceUrl("file:///etc/passwd", ALLOWED, false)
      expect.unreachable("should have thrown")
    } catch (error) {
      expect(error).toBeInstanceOf(SourceUrlRejectedError)
      expect((error as SourceUrlRejectedError).reason).toBe("source_rejected")
      expect((error as SourceUrlRejectedError).retryable).toBe(false)
    }
  })
})
