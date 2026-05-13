import "server-only"
import { cookies } from "next/headers"

import { LANGUAGE_PREFERENCE_COOKIE } from "./language-preference-constants"
import { isPlayableLanguageVariant } from "./playable-variant"

export { LANGUAGE_PREFERENCE_COOKIE }

export async function readPreferredLanguageSlug(): Promise<string | null> {
  // cookies() throws when called outside a request context (e.g. during
  // static prerender at build time). Treat any throw as "no preference" so
  // the page falls through to its normal render path instead of 500ing.
  try {
    const store = await cookies()
    return store.get(LANGUAGE_PREFERENCE_COOKIE)?.value ?? null
  } catch {
    return null
  }
}

type ShouldRedirectInput = {
  preferredSlug: string | null
  rawLocale: string
  variants: ReadonlyArray<
    | {
        language?: { slug?: string | null } | null
        published?: boolean | null
        hls?: string | null
      }
    | null
    | undefined
  >
}

export function shouldRedirectForPreference({
  preferredSlug,
  rawLocale,
  variants,
}: ShouldRedirectInput): string | null {
  if (!preferredSlug) return null
  if (preferredSlug === rawLocale) return null
  const hasPlayable = variants.some(
    (v) => isPlayableLanguageVariant(v) && v.language.slug === preferredSlug,
  )
  return hasPlayable ? preferredSlug : null
}
