/** The feed language (R19, KTD7, KTD12): the saved dub, else the phone's first
 *  language via the default-audio table, else English. Eligibility, the pool and
 *  Explore's recommendations all use it, never the client's `english` default. */

import { audioSlugForLocaleTag } from "../../i18n/audioSlug"
import { defaultAudioLanguage } from "../../i18n/localeStore"
import {
  AUDIO_LANGUAGE_SLUG_PATTERN,
  DEFAULT_AUDIO_LANGUAGE_SLUG,
} from "../recommendations/context"

export const FEED_FALLBACK_LANGUAGE_SLUG = DEFAULT_AUDIO_LANGUAGE_SLUG

/** The phone's first language tag, the one the player's default audio uses.
 *  The whole tag is kept, because a region can name another Language (`es-ES`). */
export function readDeviceLocale(): string | null {
  return defaultAudioLanguage()?.tag ?? null
}

export function resolveFeedLanguage(input: {
  /** `WatchPreferences.audioLanguageSlug`. */
  preferredAudioSlug: string | null | undefined
  /** `readDeviceLocale()`. */
  deviceLocale: string | null | undefined
}): string {
  const preferred = input.preferredAudioSlug?.trim()
  // A slug admin would refuse must not reach the recommendations request.
  if (preferred && AUDIO_LANGUAGE_SLUG_PATTERN.test(preferred)) {
    return preferred
  }
  return (
    audioSlugForLocaleTag(input.deviceLocale) ?? FEED_FALLBACK_LANGUAGE_SLUG
  )
}
