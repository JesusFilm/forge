import { describe, expect, it } from "vitest"
import { resolveLanguageFlagCountryId } from "./language-flags"

describe("resolveLanguageFlagCountryId", () => {
  it("uses the language code instead of the first country id", () => {
    expect(
      resolveLanguageFlagCountryId({
        bcp47: "en",
        iso3: "eng",
        countryIds: ["AD", "AE", "US"],
        countrySpeakers: { AD: 1430, AE: 777777777, US: 999999999 },
      }),
    ).toBe("US")

    expect(
      resolveLanguageFlagCountryId({
        bcp47: "ab",
        iso3: "abk",
        countryIds: ["DE", "GE", "RU"],
        countrySpeakers: { DE: 5000, GE: 777777777, RU: 4260 },
      }),
    ).toBe("GE")
  })

  it("falls back only when the country signal is unambiguous", () => {
    expect(
      resolveLanguageFlagCountryId({
        bcp47: null,
        iso3: null,
        countryIds: ["ET"],
        countrySpeakers: { ET: 285000 },
      }),
    ).toBe("ET")

    expect(
      resolveLanguageFlagCountryId({
        bcp47: null,
        iso3: null,
        countryIds: ["AE", "SA"],
        countrySpeakers: { AE: 999999999, SA: 999999999 },
      }),
    ).toBe("")
  })
})
