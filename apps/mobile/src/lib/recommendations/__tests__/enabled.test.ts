jest.mock("../../../env", () => ({
  env: { EXPO_PUBLIC_RECOMMENDATIONS_ENABLED: " False " },
}))

import {
  isRecommendationClientEnabled,
  parseRecommendationsEnabled,
} from "../enabled"

describe("parseRecommendationsEnabled", () => {
  it.each([undefined, "", "true", "1", "yes", " TRUE "])(
    "keeps the client on for %p (opt-out switch)",
    (raw) => {
      expect(parseRecommendationsEnabled(raw)).toBe(true)
    },
  )

  it.each(["false", "0", " FALSE ", "False", "0 "])(
    "turns the client off for %p",
    (raw) => {
      expect(parseRecommendationsEnabled(raw)).toBe(false)
    },
  )
})

describe("isRecommendationClientEnabled", () => {
  it("reads the inlined env value through the same parser", () => {
    expect(isRecommendationClientEnabled()).toBe(false)
  })
})
