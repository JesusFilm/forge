/**
 * U9 — `isAllowedDownloadOrigin` allowlist tests.
 *
 * Covers AE5 (https-only) and the explicit edge cases from the plan:
 *  - HTTPS jesusfilm.org and subdomains allowed.
 *  - HTTPS stream.mux.com and *.mux.com allowed.
 *  - HTTPS evil.com blocked.
 *  - HTTP downgrade blocked even on otherwise-allowed host.
 *  - `javascript:` blocked (URL parses, protocol fails).
 *  - Protocol-relative `//host/path` blocked (URL parse throws).
 *  - Suffix-confusion `https://jesusfilm.org.evil.com` blocked
 *    (the `.jesusfilm.org` rule requires the leading dot).
 *  - Malformed input blocked.
 *  - Empty string blocked.
 */

import { describe, expect, it } from "vitest"

import { isAllowedDownloadOrigin } from "@/lib/download-allowlist"

describe("isAllowedDownloadOrigin — allowed origins", () => {
  it("allows https://jesusfilm.org root host", () => {
    expect(isAllowedDownloadOrigin("https://jesusfilm.org/file.mp4")).toBe(true)
  })

  it("allows arbitrary *.jesusfilm.org subdomains (incl. api-media-core)", () => {
    expect(
      isAllowedDownloadOrigin("https://api-media-core.jesusfilm.org/x.mp4"),
    ).toBe(true)
    expect(isAllowedDownloadOrigin("https://cdn.jesusfilm.org/clip.mp4")).toBe(
      true,
    )
  })

  it("allows https://stream.mux.com", () => {
    expect(isAllowedDownloadOrigin("https://stream.mux.com/abc.mp4")).toBe(true)
  })

  it("allows arbitrary *.mux.com subdomains", () => {
    expect(
      isAllowedDownloadOrigin("https://image.mux.com/playback/thumbnail.png"),
    ).toBe(true)
  })
})

describe("isAllowedDownloadOrigin — blocked origins", () => {
  it("blocks unrelated HTTPS hosts", () => {
    expect(isAllowedDownloadOrigin("https://evil.com/bad.mp4")).toBe(false)
  })

  it("blocks HTTP downgrade even on an otherwise-allowed host", () => {
    expect(isAllowedDownloadOrigin("http://jesusfilm.org/file.mp4")).toBe(false)
    expect(isAllowedDownloadOrigin("http://stream.mux.com/abc.mp4")).toBe(false)
  })

  it("blocks javascript: URLs (parse succeeds, protocol fails)", () => {
    expect(isAllowedDownloadOrigin("javascript:alert(1)")).toBe(false)
  })

  it("blocks data: URLs", () => {
    expect(isAllowedDownloadOrigin("data:text/plain;base64,SGVsbG8=")).toBe(
      false,
    )
  })

  it("blocks file: URLs", () => {
    expect(isAllowedDownloadOrigin("file:///etc/passwd")).toBe(false)
  })

  it("blocks protocol-relative URLs (URL constructor throws)", () => {
    expect(isAllowedDownloadOrigin("//evil.com/file.mp4")).toBe(false)
  })

  it("blocks suffix-confusion hosts like jesusfilm.org.evil.com", () => {
    // `.jesusfilm.org` requires the leading dot, so endsWith check refuses
    // attacker-controlled hostnames that merely contain the substring.
    expect(
      isAllowedDownloadOrigin("https://jesusfilm.org.evil.com/x.mp4"),
    ).toBe(false)
  })

  it("blocks malformed URLs", () => {
    expect(isAllowedDownloadOrigin("not a url")).toBe(false)
  })

  it("blocks the empty string", () => {
    expect(isAllowedDownloadOrigin("")).toBe(false)
  })
})
