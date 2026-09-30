/**
 * The feed language (R19, KTD7): the saved dub preference, else the device
 * map, else English. Eligibility, the pool, and Explore's recommendations
 * request all use this one slug, never the client's own `english` default.
 */

import {
  AUDIO_LANGUAGE_SLUG_PATTERN,
  DEFAULT_AUDIO_LANGUAGE_SLUG,
} from "../recommendations/context"
import { languageSlugForLocale } from "./deviceLanguageMap"

export const FEED_FALLBACK_LANGUAGE_SLUG = DEFAULT_AUDIO_LANGUAGE_SLUG

/**
 * The device locale tag, from the same `Intl` read as
 * `resolveDefaultLanguage.ts`. The whole tag is kept, because a region can
 * name another Language (`es-ES`).
 */
export function readDeviceLocale(): string | null {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale
    return typeof locale === "string" && locale.length > 0 ? locale : null
  } catch {
    return null
  }
}

export function resolveFeedLanguage(input: {
  /** `WatchPreferences.audioLanguageSlug`. */
  preferredAudioSlug: string | null | undefined
  deviceLocale: string | null | undefined
}): string {
  const preferred = input.preferredAudioSlug?.trim()
  // A slug admin would refuse must not reach the recommendations request.
  if (preferred && AUDIO_LANGUAGE_SLUG_PATTERN.test(preferred)) {
    return preferred
  }
  return (
    languageSlugForLocale(input.deviceLocale) ?? FEED_FALLBACK_LANGUAGE_SLUG
  )
}
