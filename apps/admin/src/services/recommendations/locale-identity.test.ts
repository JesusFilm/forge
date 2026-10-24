import { describe, expect, it } from "vitest"
import { resolveRecommendationLocaleIdentity } from "./locale-identity"

describe("recommendation locale identity", () => {
  it("uses the owner-approved Simplified default for generic Chinese", () => {
    expect(resolveRecommendationLocaleIdentity("zh", "mandarin-china")).toEqual(
      {
        transcriptLocale: "zh",
        presentationLocale: "zh-hans",
        audioLanguageSlug: "mandarin-china",
      },
    )
  })
  it.each([
    ["zh-Hans", "zh-hans"],
    ["zh-Hant", "zh-hant"],
    ["zh-hans", "zh-hans"],
    ["zh-hant", "zh-hant"],
  ])(
    "resolves %s text against shared zh transcripts without changing Mandarin audio",
    (locale, presentationLocale) => {
      expect(
        resolveRecommendationLocaleIdentity(locale, "mandarin-china"),
      ).toEqual({
        transcriptLocale: "zh",
        presentationLocale,
        audioLanguageSlug: "mandarin-china",
      })
    },
  )
  it.each([
    ["en", "gbii"],
    ["fr", "french-african"],
    ["te", "telugu"],
    ["es-419", "spanish-latin-american"],
  ])(
    "preserves the existing %s transcript/display context with exact %s audio",
    (locale, audioLanguageSlug) => {
      expect(
        resolveRecommendationLocaleIdentity(locale, audioLanguageSlug),
      ).toEqual({
        transcriptLocale: locale,
        presentationLocale: locale,
        audioLanguageSlug,
      })
    },
  )
})
