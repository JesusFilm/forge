import { describe, expect, it, vi } from "vitest"
import { observeRecommendationDelivery } from "./recommendation-delivery-observability"
import { RecommendationRouteError } from "./recommendation-route-policy"

describe("delivery operational observations", () => {
  it.each(["served", "fallback", "empty", "unavailable"])(
    "counts HTTP 200 %s envelopes even without a persisted request",
    (result) => {
      const log = vi.fn()
      observeRecommendationDelivery(
        {
          endpoint: "seeded",
          httpStatus: 200,
          delivery: { result, reason: "retrieval_timeout", items: [] },
          upstreamResult: result,
        },
        log,
      )
      expect(log).toHaveBeenCalledExactlyOnceWith(
        `event=recommendation.delivery endpoint=seeded httpStatus=200 result=${result} reason=retrieval_timeout itemCount=0 upstreamResult=${result}`,
      )
    },
  )

  it("excludes identifying delivery values and normalizes unknown upstream strings", () => {
    const log = vi.fn()
    const delivery = {
      requestId: "private-request",
      result: "untrusted-result",
      reason: "token-secret\nevent=spoofed",
      items: [
        { capability: "capability-secret", targetMediaId: "private-media" },
      ],
      personalization: { profileId: "private-profile" },
    }
    observeRecommendationDelivery(
      {
        endpoint: "seeded",
        httpStatus: 200,
        delivery,
        upstreamResult: "untrusted-upstream",
      },
      log,
    )
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "event=recommendation.delivery endpoint=seeded httpStatus=200 result=unknown reason=unknown itemCount=1 upstreamResult=unknown",
    )
  })

  it.each(["coverage_unavailable", "cooldown", "control_disabled"])(
    "keeps %s distinct from timeout and unknown outcomes",
    (reason) => {
      const log = vi.fn()
      observeRecommendationDelivery(
        {
          endpoint: "for_you",
          httpStatus: 200,
          delivery: { result: "unavailable", reason, items: [] },
          upstreamResult: "unavailable",
        },
        log,
      )
      expect(log.mock.calls[0]?.[0]).toContain(`reason=${reason} `)
    },
  )

  it.each([400, 403, 429, 502, 503])(
    "keeps HTTP %i failures separate from semantic envelopes",
    (httpStatus) => {
      const log = vi.fn()
      observeRecommendationDelivery(
        {
          endpoint: "for_you",
          httpStatus,
          error: new RecommendationRouteError(
            httpStatus,
            "private-arbitrary-code",
          ),
        },
        log,
      )
      expect(log).toHaveBeenCalledExactlyOnceWith(
        `event=recommendation.delivery endpoint=for_you httpStatus=${httpStatus} result=${httpStatus >= 500 ? "failed" : "rejected"} reason=unknown itemCount=0 upstreamResult=not_observed`,
      )
    },
  )

  it("does not expose exception text or stack traces", () => {
    const log = vi.fn()
    observeRecommendationDelivery(
      {
        endpoint: "seeded",
        httpStatus: 503,
        error: new Error("bearer-secret"),
      },
      log,
    )
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "event=recommendation.delivery endpoint=seeded httpStatus=503 result=failed reason=unknown itemCount=0 upstreamResult=not_observed",
    )
  })

  it("bounds unexpected card counts without misreporting a full six-card slate", () => {
    const log = vi.fn()
    observeRecommendationDelivery(
      {
        endpoint: "seeded",
        httpStatus: 200,
        delivery: { result: "served", items: Array(7) },
      },
      log,
    )
    expect(log.mock.calls[0]?.[0]).toContain("itemCount=out_of_range")
  })

  it("isolates logger failure", () => {
    expect(() =>
      observeRecommendationDelivery(
        {
          endpoint: "seeded",
          httpStatus: 200,
          delivery: { result: "served", items: [] },
        },
        () => {
          throw new Error("logging unavailable")
        },
      ),
    ).not.toThrow()
  })
})
