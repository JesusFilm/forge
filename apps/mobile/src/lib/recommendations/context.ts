/**
 * The two independent axes a slate is validated for: the UI locale (metadata
 * language) and the audio language slug (playback dub). Admin never substitutes
 * one for the other, so the client must name both explicitly.
 */
import { HOME_LOCALE } from "../watchHome/config"

/** Mobile's UI is English until the string-localization work lands. */
export const RECOMMENDATION_UI_LOCALE = HOME_LOCALE

/** The language-entity slug for English audio (Web's `en` mapping). */
export const DEFAULT_AUDIO_LANGUAGE_SLUG = "english"

/** Admin's `audioLanguageSlug` shape (Web's route schema). */
export const AUDIO_LANGUAGE_SLUG_PATTERN = /^[a-z0-9-]{1,64}$/

export type RecommendationContext = {
  locale: string
  audioLanguageSlug: string
}

/**
 * The viewer's persisted audio preference wins when it is a valid slug; an
 * absent or malformed preference falls back to English rather than sending
 * a value Admin would reject.
 */
export function resolveRecommendationContext(preferences: {
  audioLanguageSlug: string | null | undefined
}): RecommendationContext {
  const preferred = preferences.audioLanguageSlug?.trim()
  return {
    locale: RECOMMENDATION_UI_LOCALE,
    audioLanguageSlug:
      preferred && AUDIO_LANGUAGE_SLUG_PATTERN.test(preferred)
        ? preferred
        : DEFAULT_AUDIO_LANGUAGE_SLUG,
  }
}
