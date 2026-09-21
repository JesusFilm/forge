import { describe, expect, it } from "vitest"
import {
  assertRecommendationHumanAdmission,
  isEligibleHumanRequest,
} from "./recommendation-human-admission"

describe("recognized machine admission", () => {
  it.each<Record<string, string>>([
    { "user-agent": "Applebot/0.1" },
    { "user-agent": "Googlebot/2.1" },
    { "user-agent": "HeadlessChrome/123" },
    { "user-agent": "meta-externalagent/1.1" },
    { "user-agent": "Meta-ExternalFetcher/1.1" },
    {
      "user-agent":
        "Mozilla/5.0 Chrome/145.0.0.0 Safari/537.36 (compatible; meta-externalagent/1.1)",
    },
    { purpose: "prefetch" },
    { "sec-purpose": "prefetch;prerender" },
  ])("rejects recognized machines %j", (headers) => {
    const request = { headers: new Headers(headers) }
    expect(isEligibleHumanRequest(request)).toBe(false)
    expect(() => assertRecommendationHumanAdmission(request)).toThrow()
  })
  it.each<Record<string, string>>([
    {},
    { "user-agent": "Mozilla/5.0 Chrome/123 Safari/537.36" },
    { "user-agent": "Mozilla/5.0 Mobile/15E148 [FBAN/FBIOS;FBAV/530.0]" },
  ])(
    "admits unknown/browser traffic without claiming proof of humanity %j",
    (headers) => {
      const request = { headers: new Headers(headers) }
      expect(isEligibleHumanRequest(request)).toBe(true)
      expect(() => assertRecommendationHumanAdmission(request)).not.toThrow()
    },
  )
})
