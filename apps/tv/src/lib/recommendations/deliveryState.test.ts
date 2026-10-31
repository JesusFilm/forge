import { recommendationDeliveryState } from "./deliveryState"

describe("recommendation coverage and reliability", () => {
  it.each([1, 2, 3, 4, 5, 6])("keeps a valid %i-card slate", (count) => {
    expect(
      recommendationDeliveryState({
        result: "served",
        reason: null,
        items: Array.from({ length: count }),
      }),
    ).toBe("ready")
  })
  it("treats no eligible supply as empty, not a failed request", () => {
    expect(
      recommendationDeliveryState({
        result: "served",
        reason: null,
        items: [],
      }),
    ).toBe("empty")
    expect(
      recommendationDeliveryState({
        result: "unavailable",
        reason: "coverage_unavailable",
        items: [],
      }),
    ).toBe("empty")
  })
  it.each(["cooldown", "in_flight"])(
    "allows the bounded retry for %s",
    (reason) => {
      expect(
        recommendationDeliveryState({
          result: "unavailable",
          reason,
          items: [],
        }),
      ).toBe("retry")
    },
  )
  it("does not hide a server failure behind stale cards", () => {
    expect(
      recommendationDeliveryState({
        result: "unavailable",
        reason: "service_unavailable",
        items: [{}],
      }),
    ).toBe("error")
  })
})
