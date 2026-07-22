import { describe, expect, it } from "vitest"

import { hostAllowed } from "./mastra-upstream"

// Direct unit coverage of the SSRF guard — the label-boundary matrix lives
// HERE, at the function's home (Ruling 2 PR 1), never only as transitive
// proxy-suite coverage. The proxy suites keep their own wiring cases.

describe("hostAllowed — scheme floor + loopback", () => {
  it("allows an https base with no allowlist set", () => {
    expect(hostAllowed("https://mastra.internal", undefined)).toBe(true)
  })

  it("rejects an http public host (bearer-in-cleartext guard)", () => {
    expect(hostAllowed("http://evil.com", undefined)).toBe(false)
  })

  it("rejects an unparseable base URL", () => {
    expect(hostAllowed("not a url", undefined)).toBe(false)
  })

  it("allows http for localhost (local dev)", () => {
    expect(hostAllowed("http://localhost:4111", undefined)).toBe(true)
  })

  it("allows http for IPv4 loopback", () => {
    expect(hostAllowed("http://127.0.0.1:4111", undefined)).toBe(true)
  })

  it("allows http for bracketed IPv6 loopback", () => {
    expect(hostAllowed("http://[::1]:4111", undefined)).toBe(true)
  })
})

describe("hostAllowed — railway.internal label boundary", () => {
  it("allows http for a *.railway.internal host (prod private networking)", () => {
    expect(
      hostAllowed("http://example-service.railway.internal", undefined),
    ).toBe(true)
  })

  it("allows http for a *.railway.internal host with a port", () => {
    expect(
      hostAllowed("http://example-service.railway.internal:4111", undefined),
    ).toBe(true)
  })

  it("allows http for an uppercase *.RAILWAY.INTERNAL host (parser lowercases)", () => {
    expect(
      hostAllowed("http://EXAMPLE-SERVICE.RAILWAY.INTERNAL:4111", undefined),
    ).toBe(true)
  })

  it("rejects railway.internal.evil.com (suffix is a full-label match, not a substring)", () => {
    expect(hostAllowed("http://railway.internal.evil.com", undefined)).toBe(
      false,
    )
  })

  it("rejects evilrailway.internal (no dot boundary)", () => {
    expect(hostAllowed("http://evilrailway.internal", undefined)).toBe(false)
  })

  it("rejects bare railway.internal (no leading label)", () => {
    expect(hostAllowed("http://railway.internal", undefined)).toBe(false)
  })

  it("rejects .railway.internal (empty leading label)", () => {
    expect(hostAllowed("http://.railway.internal", undefined)).toBe(false)
  })

  it("rejects foo..railway.internal (empty inner label)", () => {
    expect(hostAllowed("http://foo..railway.internal", undefined)).toBe(false)
  })

  it("rejects a trailing-dot FQDN railway.internal. host (pins fail-closed)", () => {
    expect(
      hostAllowed("http://example-service.railway.internal.:4111", undefined),
    ).toBe(false)
  })
})

describe("hostAllowed — allowlist", () => {
  it("allows an https host in the allowlist", () => {
    expect(hostAllowed("https://mastra.internal", "mastra.internal")).toBe(true)
  })

  it("rejects an https host not in the allowlist", () => {
    expect(hostAllowed("https://mastra.internal", "trusted.internal")).toBe(
      false,
    )
  })

  it("rejects a loopback http host not in a set allowlist", () => {
    expect(hostAllowed("http://localhost:4111", "trusted.internal")).toBe(false)
  })

  it("allows a loopback http host in the allowlist", () => {
    expect(hostAllowed("http://localhost:4111", "localhost")).toBe(true)
  })

  it("rejects a railway.internal http host not in a set allowlist", () => {
    expect(
      hostAllowed(
        "http://example-service.railway.internal:4111",
        "trusted.internal",
      ),
    ).toBe(false)
  })

  it("allows a railway.internal http host in the allowlist", () => {
    expect(
      hostAllowed(
        "http://example-service.railway.internal:4111",
        "example-service.railway.internal",
      ),
    ).toBe(true)
  })

  it("matches allowlist entries after trimming and lowercasing (CSV hygiene)", () => {
    expect(
      hostAllowed("https://mastra.internal", " Mastra.Internal , other.host "),
    ).toBe(true)
  })
})
