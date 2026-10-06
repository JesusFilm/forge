import { describe, expect, it } from "vitest"
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
})
