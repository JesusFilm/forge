/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest"
import {
  clearRecommendationWithdrawalPending,
  isRecommendationWithdrawalPending,
  markRecommendationWithdrawalPending,
  requestHasRecommendationWithdrawalPending,
} from "./recommendation-withdrawal-pending"

afterEach(() => {
  clearRecommendationWithdrawalPending()
})

describe("recommendation withdrawal pending", () => {
  it("persists a browser-visible fail-closed marker until it is explicitly cleared", () => {
    expect(isRecommendationWithdrawalPending()).toBe(false)

    markRecommendationWithdrawalPending()

    expect(isRecommendationWithdrawalPending()).toBe(true)

    clearRecommendationWithdrawalPending()

    expect(isRecommendationWithdrawalPending()).toBe(false)
  })

  it("treats any request marker value or duplicate as withdrawal pending", () => {
    expect(
      requestHasRecommendationWithdrawalPending(
        new Request("https://watch.example/watch/api/recommendations", {
          headers: {
            cookie:
              "forge_recommendation_withdrawal_pending=unexpected; forge_recommendation_withdrawal_pending=1",
          },
        }),
      ),
    ).toBe(true)
    expect(
      requestHasRecommendationWithdrawalPending(
        new Request("https://watch.example/watch/api/recommendations", {
          headers: { cookie: "unrelated=1" },
        }),
      ),
    ).toBe(false)
  })
})
