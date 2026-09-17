import {
  DEFAULT_AUDIO_LANGUAGE_SLUG,
  RECOMMENDATION_UI_LOCALE,
  resolveRecommendationContext,
} from "../context"

describe("resolveRecommendationContext", () => {
  it("defaults to English metadata and English audio", () => {
    expect(resolveRecommendationContext({ audioLanguageSlug: null })).toEqual({
      locale: RECOMMENDATION_UI_LOCALE,
      audioLanguageSlug: DEFAULT_AUDIO_LANGUAGE_SLUG,
    })
    expect(RECOMMENDATION_UI_LOCALE).toBe("en")
    expect(DEFAULT_AUDIO_LANGUAGE_SLUG).toBe("english")
  })

  it("keeps the UI locale independent of the audio preference", () => {
    expect(
      resolveRecommendationContext({ audioLanguageSlug: "french" }),
    ).toEqual({ locale: "en", audioLanguageSlug: "french" })
  })

  it("falls back to English audio for a slug Admin would reject", () => {
    for (const bad of ["", "  ", "French", "fr_FR", "x".repeat(65)]) {
      expect(
        resolveRecommendationContext({ audioLanguageSlug: bad })
          .audioLanguageSlug,
      ).toBe("english")
    }
    expect(
      resolveRecommendationContext({ audioLanguageSlug: " spanish-castilian " })
        .audioLanguageSlug,
    ).toBe("spanish-castilian")
  })
})
