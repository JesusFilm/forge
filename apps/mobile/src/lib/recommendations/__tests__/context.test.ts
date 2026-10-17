import { adminFormsFor } from "../../../i18n/adminLanguage"
import {
  DEFAULT_AUDIO_LANGUAGE_SLUG,
  ENGLISH_FOR_YOU_LOCALE,
  resolveRecommendationContext,
} from "../context"

function context(
  audioLanguageSlug: string | null,
  forYouLocale: string,
  defaultAudioSlug: string | null,
) {
  return resolveRecommendationContext({
    audioLanguageSlug,
    forYouLocale,
    defaultAudioSlug,
  })
}

describe("resolveRecommendationContext", () => {
  it("uses English metadata and English audio when nothing else is known", () => {
    expect(context(null, "en", null)).toEqual({
      locale: "en",
      audioLanguageSlug: "english",
    })
    expect(ENGLISH_FOR_YOU_LOCALE).toBe("en")
    expect(DEFAULT_AUDIO_LANGUAGE_SLUG).toBe("english")
  })

  // KTD11: the table's For You locale, not the catalog tag. `tl` pools live
  // under `fil`.
  it("takes the For You locale from the table", () => {
    for (const [tag, locale] of [
      ["ru", "ru"],
      ["tl", "fil"],
    ] as const) {
      expect(context(null, adminFormsFor(tag).forYouLocale, null).locale).toBe(
        locale,
      )
    }
  })

  // KTD12: a Hausa phone with no pick asks for Hausa audio, as the player does.
  it("takes the phone's default audio when there is no saved pick", () => {
    expect(context(null, "en", "hausa")).toEqual({
      locale: "en",
      audioLanguageSlug: "hausa",
    })
  })

  it("prefers the saved pick over the phone's default audio", () => {
    expect(context("english", "ru", "russian")).toEqual({
      locale: "ru",
      audioLanguageSlug: "english",
    })
  })

  it("skips a slug Admin would reject, then falls back to the phone's audio, then English", () => {
    for (const bad of ["", "  ", "French", "fr_FR", "x".repeat(65)]) {
      expect(context(bad, "en", "hausa").audioLanguageSlug).toBe("hausa")
      expect(
        resolveRecommendationContext({
          audioLanguageSlug: bad,
          forYouLocale: "en",
          defaultAudioSlug: bad,
        }).audioLanguageSlug,
      ).toBe("english")
    }
    expect(
      resolveRecommendationContext({
        audioLanguageSlug: " spanish-castilian ",
        forYouLocale: "es",
        defaultAudioSlug: null,
      }).audioLanguageSlug,
    ).toBe("spanish-castilian")
  })

  it("never sends a blank locale", () => {
    expect(context(null, "  ", null).locale).toBe("en")
  })
})
