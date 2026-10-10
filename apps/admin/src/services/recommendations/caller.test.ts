import { describe, expect, it } from "vitest"
import { assertWebRecommendationCaller } from "./caller"

describe("assertWebRecommendationCaller", () => {
  it("admits only the zero-permission non-fleet consumer bearer", () => {
    expect(() =>
      assertWebRecommendationCaller({
        id: null,
        role: "CONSUMER_BEARER",
        fleet: false,
        rateLimitBucketKey: "web-key",
      }),
    ).not.toThrow()
    expect(() => assertWebRecommendationCaller(null)).toThrow(
      "Web consumer authentication required",
    )
    expect(() =>
      assertWebRecommendationCaller({ id: null, role: "WORKFLOW_TRIGGER" }),
    ).toThrow("Web consumer authentication required")
    expect(() =>
      assertWebRecommendationCaller({
        id: null,
        role: "CONSUMER_BEARER",
        fleet: true,
        rateLimitBucketKey: "fleet-key",
      }),
    ).toThrow("Web consumer authentication required")
    expect(() =>
      assertWebRecommendationCaller({
        id: null,
        role: "CONSUMER_BEARER",
        fleet: false,
      }),
    ).toThrow("Web consumer authentication required")
  })
})
