import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { describe, expect, it } from "vitest"
import {
  attachRecommendationProfile,
  clearRecommendationProfile,
  createRecommendationProfileCookie,
  readRecommendationProfileCookie,
} from "./recommendation-session"

describe("durable recommendation profile cookie", () => {
  it("distinguishes absence, malformed substitution, and one valid opaque value", () => {
    expect(
      readRecommendationProfileCookie(new Request("https://watch.example")),
    ).toEqual({ kind: "absent" })
    expect(
      readRecommendationProfileCookie(
        new Request("https://watch.example", {
          headers: { cookie: "forge_recommendation_profile=attacker-value" },
        }),
      ),
    ).toEqual({ kind: "invalid" })

    const value = "a".repeat(43)
    expect(
      readRecommendationProfileCookie(
        new Request("https://watch.example", {
          headers: {
            cookie: `forge_recommendation_profile=${value}; forge_recommendation_profile=${value}`,
          },
        }),
      ),
    ).toEqual({ kind: "invalid" })
    expect(
      readRecommendationProfileCookie(
        new Request("https://watch.example", {
          headers: { cookie: `forge_recommendation_profile=${value}` },
        }),
      ),
    ).toEqual({
      kind: "valid",
      value,
      digest: createHash("sha256").update(value).digest("hex"),
    })
  })

  it("sets and clears a host-only protected cookie", () => {
    const profile = createRecommendationProfileCookie()
    const response = NextResponse.json({ ok: true })
    attachRecommendationProfile(response, profile)
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain("forge_recommendation_profile=")
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie.toLowerCase()).toContain("samesite=lax")
    expect(setCookie).toContain("Max-Age=15552000")
    expect(setCookie).toContain("Path=/")
    expect(setCookie).not.toContain("Domain=")

    const cleared = NextResponse.json({ ok: true })
    clearRecommendationProfile(cleared)
    expect(cleared.headers.get("set-cookie")).toContain("Max-Age=0")
  })

  it("prefers the profile bound to the latest consent receipt", () => {
    const bundledProfile = "b".repeat(43)
    const staleProfile = "s".repeat(43)
    const consent = "c".repeat(43)

    expect(
      readRecommendationProfileCookie(
        new Request("https://watch.example", {
          headers: {
            cookie: `forge_recommendation_profile=${staleProfile}; forge_recommendation_consent=v1.${consent}.${bundledProfile}`,
          },
        }),
      ),
    ).toEqual({
      kind: "valid",
      value: bundledProfile,
      digest: createHash("sha256").update(bundledProfile).digest("hex"),
    })
  })
})
