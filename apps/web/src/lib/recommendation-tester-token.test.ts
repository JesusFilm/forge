import { SignJWT } from "jose"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createRecommendationTesterLink,
  exchangeRecommendationTesterLink,
  readRecommendationTesterCookie,
  TESTER_ACTIVATION_SECONDS,
  TESTER_SESSION_SECONDS,
} from "./recommendation-tester-token"

const config = {
  secret: "local-test-secret-".repeat(4),
  origin: "https://watch.example",
}
const testerId = "37a72bda-b57b-4171-93aa-688d0fba94a7"
const now = new Date("2026-09-21T12:00:00Z")
const issuedAt = Math.floor(now.getTime() / 1000)
async function activation() {
  const url = new URL(await createRecommendationTesterLink(config, testerId))
  return url.hash.slice(1)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(now)
})
afterEach(() => vi.useRealTimers())

describe("recommendation tester credentials", () => {
  it("issues a fragment-only link and exchanges it for a separate cookie", async () => {
    const url = new URL(await createRecommendationTesterLink(config, testerId))
    expect(url.pathname).toBe("/watch/api/recommendations/tester")
    expect(url.search).toBe("")
    const token = url.hash.slice(1)
    const session = await exchangeRecommendationTesterLink(token, config)
    expect(session?.maxAge).toBe(TESTER_SESSION_SECONDS)
    expect(session?.cookie).not.toBe(token)
    expect(await readRecommendationTesterCookie(session?.cookie, config)).toBe(
      testerId,
    )
    expect(await readRecommendationTesterCookie(token, config)).toBeNull()
    expect(
      await exchangeRecommendationTesterLink(session!.cookie, config),
    ).toBeNull()
  })

  it("expires activation at 24 hours and bounds repeated exchanges to the original seven days", async () => {
    const token = await activation()
    vi.setSystemTime(now.getTime() + 12 * 60 * 60 * 1000)
    const session = await exchangeRecommendationTesterLink(token, config)
    expect(session?.maxAge).toBe(TESTER_SESSION_SECONDS - 12 * 60 * 60)
    vi.setSystemTime(now.getTime() + TESTER_ACTIVATION_SECONDS * 1000)
    expect(await exchangeRecommendationTesterLink(token, config)).toBeNull()
    expect(await readRecommendationTesterCookie(session?.cookie, config)).toBe(
      testerId,
    )
    vi.setSystemTime(now.getTime() + TESTER_SESSION_SECONDS * 1000)
    expect(
      await readRecommendationTesterCookie(session?.cookie, config),
    ).toBeNull()
  })

  it("rejects tampering, other deployments, rotated secrets, and unconfigured access", async () => {
    const token = await activation()
    const session = await exchangeRecommendationTesterLink(token, config)
    const tampered = token.split(".")
    tampered[1] = Buffer.from(JSON.stringify({ sub: "forged" })).toString(
      "base64url",
    )
    expect(
      await exchangeRecommendationTesterLink(tampered.join("."), config),
    ).toBeNull()
    for (const invalid of [
      { ...config, origin: "https://other.example" },
      { ...config, secret: "different-test-secret-".repeat(4) },
      { origin: config.origin },
      { ...config, secret: "short" },
    ]) {
      expect(await exchangeRecommendationTesterLink(token, invalid)).toBeNull()
      expect(
        await readRecommendationTesterCookie(session?.cookie, invalid),
      ).toBeNull()
    }
    for (const value of [undefined, "", "garbage", "x".repeat(1025)]) {
      expect(await readRecommendationTesterCookie(value, config)).toBeNull()
    }
  })

  it.each([
    { scope: "other-feature" },
    { aud: "watch-recommendation-tester:session" },
    { sub: "nisal@example.test" },
    { iat: issuedAt + 1 },
    { iat: undefined },
    { exp: undefined },
    { exp: issuedAt + TESTER_ACTIVATION_SECONDS + 1 },
    { exp: issuedAt },
  ])("rejects signed but invalid claims: %j", async (override) => {
    const token = await new SignJWT({
      iss: config.origin,
      aud: "watch-recommendation-tester:activation",
      sub: testerId,
      scope: "forge.watch.homepageRecommendations",
      iat: issuedAt,
      exp: issuedAt + TESTER_ACTIVATION_SECONDS,
      ...override,
    })
      .setProtectedHeader({
        alg: "HS256",
        typ: "watch-recommendation-tester+jwt",
      })
      .sign(new TextEncoder().encode(config.secret))
    expect(await exchangeRecommendationTesterLink(token, config)).toBeNull()
  })

  it("rejects a valid signature under a different algorithm", async () => {
    const token = await new SignJWT({
      iss: config.origin,
      aud: "watch-recommendation-tester:activation",
      sub: testerId,
      scope: "forge.watch.homepageRecommendations",
      iat: issuedAt,
      exp: issuedAt + TESTER_ACTIVATION_SECONDS,
    })
      .setProtectedHeader({
        alg: "HS384",
        typ: "watch-recommendation-tester+jwt",
      })
      .sign(new TextEncoder().encode(config.secret))
    expect(await exchangeRecommendationTesterLink(token, config)).toBeNull()
  })

  it("only issues links for secure canonical origins or local development", async () => {
    for (const origin of [
      "http://watch.example",
      "https://user:pass@watch.example",
      "https://watch.example/path",
      "https://watch.example/?query=1",
    ]) {
      await expect(
        createRecommendationTesterLink({ ...config, origin }, testerId),
      ).rejects.toThrow()
    }
    await expect(
      createRecommendationTesterLink(
        { ...config, origin: "http://localhost:3194" },
        testerId,
      ),
    ).resolves.toContain("http://localhost:3194/")
    await expect(
      createRecommendationTesterLink(config, "arbitrary-user"),
    ).rejects.toThrow()
  })
})
