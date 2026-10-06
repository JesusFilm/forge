import { createHmac } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { verifyWatchHumanReceipt } from "./human-verification"

const secret = "0123456789abcdef0123456789abcdef"
const payloadB64 = Buffer.from(
  JSON.stringify({
    visitId: "550e8400-e29b-41d4-a716-446655440000",
    browserDigest: "a".repeat(64),
    seedMediaId: "video-123",
    locale: "en",
    audioLanguageSlug: "english",
    action: "watch_recommendations",
    hostname: "www.jesusfilm.org",
    issuedAt: 1_791_316_800,
    expiresAt: 1_791_317_100,
  }),
).toString("base64url")
const receipt = `v1.${payloadB64}.C7VfKnL5N2I0kbAenw4YRgaVRe-Xmkzx4pzjhgQAw-g`
const input = {
  receipt,
  visitId: "550e8400-e29b-41d4-a716-446655440000",
  browserDigest: "a".repeat(64),
  seedMediaId: "video-123",
  locale: "en",
  audioLanguageSlug: "english",
  caller: {
    id: null,
    role: "CONSUMER_BEARER" as const,
    fleet: false,
    rateLimitBucketKey: "web-test-key",
  },
  now: new Date(1_791_316_801_000),
}
const config = {
  secret,
  allowedHostnames: "www.jesusfilm.org",
}

describe("Web-bound Watch human verification receipt", () => {
  it("accepts the jointly specified Web/Admin HMAC test vector", () => {
    expect(verifyWatchHumanReceipt(input, config)).toBe(true)
    expect(
      verifyWatchHumanReceipt(
        { ...input, now: new Date(1_791_316_770_000) },
        config,
      ),
    ).toBe(true)
    expect(
      verifyWatchHumanReceipt(
        { ...input, now: new Date(1_791_316_769_000) },
        config,
      ),
    ).toBe(false)
  })

  it("rejects a different visit, browser, source, Web fleet, hostname, or time", () => {
    expect(
      verifyWatchHumanReceipt({ ...input, visitId: "another-visit" }, config),
    ).toBe(false)
    expect(
      verifyWatchHumanReceipt(
        { ...input, browserDigest: "b".repeat(64) },
        config,
      ),
    ).toBe(false)
    expect(
      verifyWatchHumanReceipt(
        { ...input, seedMediaId: "another-video" },
        config,
      ),
    ).toBe(false)
    expect(
      verifyWatchHumanReceipt(
        { ...input, caller: { ...input.caller, fleet: true } },
        config,
      ),
    ).toBe(false)
    expect(
      verifyWatchHumanReceipt(input, {
        ...config,
        allowedHostnames: "watch.jesusfilm.org",
      }),
    ).toBe(false)
    expect(
      verifyWatchHumanReceipt(
        { ...input, now: new Date(1_791_317_100_000) },
        config,
      ),
    ).toBe(false)
    expect(
      verifyWatchHumanReceipt(
        { ...input, receipt: `${receipt.slice(0, -1)}A` },
        config,
      ),
    ).toBe(false)
  })

  it("never accepts the official test-key fixture hostname as live proof", () => {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    )
    payload.hostname = "turnstile-test-fixture.local"
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
    const signature = createHmac("sha256", secret)
      .update(`forge-watch-human-v1.${encoded}`, "ascii")
      .digest("base64url")
    const fixture = { ...input, receipt: `v1.${encoded}.${signature}` }
    const allowed = {
      ...config,
      allowedHostnames: "turnstile-test-fixture.local",
    }
    expect(verifyWatchHumanReceipt(fixture, allowed)).toBe(false)
    expect(
      verifyWatchHumanReceipt(fixture, {
        ...allowed,
        allowFixtureHostname: true,
      }),
    ).toBe(true)
    vi.stubEnv("NODE_ENV", "production")
    try {
      expect(
        verifyWatchHumanReceipt(fixture, {
          ...allowed,
          allowFixtureHostname: true,
        }),
      ).toBe(false)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
