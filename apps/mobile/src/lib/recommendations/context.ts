/**
 * The two independent axes a slate is validated for: the UI locale (metadata
 * language) and the audio language slug (playback dub). Admin never substitutes
 * one for the other, so the client must name both explicitly.
 */

/** The For You locale of the English metadata retry (KTD11). */
export const ENGLISH_FOR_YOU_LOCALE = "en"

/** The language-entity slug for English audio (Web's `en` mapping). */
export const DEFAULT_AUDIO_LANGUAGE_SLUG = "english"

/** Admin's `audioLanguageSlug` shape (Web's route schema). */
export const AUDIO_LANGUAGE_SLUG_PATTERN = /^[a-z0-9-]{1,64}$/

export type RecommendationContext = {
  locale: string
  audioLanguageSlug: string
}

function validSlug(value: string | null | undefined): string | null {
  const slug = value?.trim()
  return slug && AUDIO_LANGUAGE_SLUG_PATTERN.test(slug) ? slug : null
}

/**
 * KTD11, KTD12: the metadata locale is the table's For You locale for the UI
 * catalog. The audio is the saved pick, else the phone's default audio, else
 * English. A value Admin would reject is skipped, never sent.
 */
export function resolveRecommendationContext(input: {
  /** The viewer's saved audio pick. */
  audioLanguageSlug: string | null | undefined
  /** `AdminLanguageForms.forYouLocale` of the forms in use. */
  forYouLocale: string
  /** `defaultAudioLanguage()?.slug`: the phone's first language. */
  defaultAudioSlug: string | null | undefined
}): RecommendationContext {
  const locale = input.forYouLocale.trim()
  return {
    locale: locale === "" ? ENGLISH_FOR_YOU_LOCALE : locale,
    audioLanguageSlug:
      validSlug(input.audioLanguageSlug) ??
      validSlug(input.defaultAudioSlug) ??
      DEFAULT_AUDIO_LANGUAGE_SLUG,
  }
}
