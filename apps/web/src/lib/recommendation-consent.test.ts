import { describe, expect, it } from "vitest"
import { NextResponse } from "next/server"
import {
  RECOMMENDATION_CONSENT_CONTRACT,
  RECOMMENDATION_CONSENT_COOKIE,
  attachRecommendationConsent,
  bindRecommendationConsentProfile,
  createRecommendationConsentCookie,
  readRecommendationConsentCookie,
} from "./recommendation-consent"

describe("recommendation consent receipt", () => {
  it("uses one opaque protected receipt and rejects ambiguous duplicates", () => {
    expect(RECOMMENDATION_CONSENT_CONTRACT).toBe("recommendation-consent-v1")
    const receipt = createRecommendationConsentCookie()
    expect(receipt.value).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(receipt.digest).toMatch(/^[a-f0-9]{64}$/)

    expect(
      readRecommendationConsentCookie(
        new Request("https://watch.example", {
          headers: {
            cookie: `${RECOMMENDATION_CONSENT_COOKIE}=${receipt.value}`,
          },
        }),
      ),
    ).toEqual({ kind: "valid", ...receipt })
    expect(
      readRecommendationConsentCookie(
        new Request("https://watch.example", {
          headers: {
            cookie: `${RECOMMENDATION_CONSENT_COOKIE}=${receipt.value}; ${RECOMMENDATION_CONSENT_COOKIE}=${receipt.value}`,
          },
        }),
      ),
    ).toEqual({ kind: "invalid" })

    const response = NextResponse.json({ ok: true })
    attachRecommendationConsent(response, receipt)
    const setCookie = response.headers.get("set-cookie") ?? ""
    expect(setCookie).toContain(`${RECOMMENDATION_CONSENT_COOKIE}=`)
    expect(setCookie).toContain("HttpOnly")
    expect(setCookie).toContain("Secure")
    expect(setCookie.toLowerCase()).toContain("samesite=lax")
    expect(setCookie).toContain("Max-Age=15552000")
    expect(setCookie).not.toContain("Domain=")
  })

  it("binds a profile to one production-safe receipt without changing consent authority", () => {
    const receipt = createRecommendationConsentCookie()
    const profileValue = "p".repeat(43)
    const bundled = bindRecommendationConsentProfile(receipt, profileValue)

    expect(bundled.value).toBe(`v1.${receipt.value}.${profileValue}`)
    expect(bundled.digest).toBe(receipt.digest)
    expect(
      readRecommendationConsentCookie(
        new Request("https://watch.example", {
          headers: {
            cookie: `${RECOMMENDATION_CONSENT_COOKIE}=${bundled.value}`,
          },
        }),
      ),
    ).toEqual({ kind: "valid", ...bundled })
  })
})
