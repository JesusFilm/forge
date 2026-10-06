import { describe, expect, it } from "vitest"
import {
  createWatchHumanBrowserGrant,
  createWatchHumanVerificationReceipt,
  readWatchHumanBrowserGrant,
} from "./recommendation-human-proof"

const secret = "0123456789abcdef0123456789abcdef"
const binding = {
  visitId: "550e8400-e29b-41d4-a716-446655440000",
  browserDigest: "a".repeat(64),
  seedMediaId: "video-123",
  locale: "en",
  audioLanguageSlug: "english",
}
const grant = {
  hostname: "www.jesusfilm.org",
  issuedAt: 1_791_316_800,
  expiresAt: 1_791_317_100,
}

describe("Watch human-verification proof", () => {
  it("matches the shared Admin test vector byte for byte", () => {
    const receipt = createWatchHumanVerificationReceipt(binding, grant, secret)!
    expect(receipt).toMatch(
      /^v1\.[A-Za-z0-9_-]+\.C7VfKnL5N2I0kbAenw4YRgaVRe-Xmkzx4pzjhgQAw-g$/,
    )
    expect(
      JSON.parse(Buffer.from(receipt.split(".")[1]!, "base64url").toString()),
    ).toEqual({
      ...binding,
      action: "watch_recommendations",
      ...grant,
    })
  })

  it("uses one HttpOnly browser grant across retries without trusting another browser or host", () => {
    const value = createWatchHumanBrowserGrant(
      binding.browserDigest,
      grant.hostname,
      secret,
      grant.issuedAt,
    )
    expect(value).toBeTruthy()
    const request = new Request("https://www.jesusfilm.org/watch/api", {
      headers: {
        cookie: `forge_watch_recommendation_verified_browser=${value}`,
      },
    })
    expect(
      readWatchHumanBrowserGrant(
        request,
        binding.browserDigest,
        secret,
        [grant.hostname],
        grant.issuedAt + 1,
      ),
    ).toEqual(grant)
    expect(
      readWatchHumanBrowserGrant(
        request,
        "b".repeat(64),
        secret,
        [grant.hostname],
        grant.issuedAt + 1,
      ),
    ).toBeNull()
    expect(
      readWatchHumanBrowserGrant(
        request,
        binding.browserDigest,
        secret,
        ["other.example"],
        grant.issuedAt + 1,
      ),
    ).toBeNull()
    expect(
      readWatchHumanBrowserGrant(
        request,
        binding.browserDigest,
        secret,
        [grant.hostname],
        grant.expiresAt,
      ),
    ).toBeNull()
  })

  it("rejects altered, duplicate, and weakly signed grants", () => {
    const value = createWatchHumanBrowserGrant(
      binding.browserDigest,
      grant.hostname,
      secret,
      grant.issuedAt,
    )!
    const request = (cookie: string) =>
      new Request("https://www.jesusfilm.org/watch/api", {
        headers: { cookie },
      })
    expect(
      readWatchHumanBrowserGrant(
        request(`forge_watch_recommendation_verified_browser=${value}x`),
        binding.browserDigest,
        secret,
        [grant.hostname],
        grant.issuedAt,
      ),
    ).toBeNull()
    expect(
      readWatchHumanBrowserGrant(
        request(
          `forge_watch_recommendation_verified_browser=${value}; forge_watch_recommendation_verified_browser=${value}`,
        ),
        binding.browserDigest,
        secret,
        [grant.hostname],
        grant.issuedAt,
      ),
    ).toBeNull()
    expect(
      createWatchHumanBrowserGrant(
        binding.browserDigest,
        grant.hostname,
        "weak",
      ),
    ).toBeNull()
  })
})
