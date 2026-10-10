// Public entry language preference redirects run in apps/web/src/proxy.ts,
// which reads the picker cookie before rewriting the request. These helpers
// remain available for variant-aware page decisions without duplicating the
// proxy's public-path redirect policy.
//
// This file is retained because:
//   - `shouldRedirectForPreference` is the variant-aware version of the
//     decision logic the proxy can't make without an extra GraphQL call.
//     Future variant-aware callers (a paid-feature gate, an admin tool,
//     or a re-introduced page-level redirect when ISR cost matters less)
//     can compose against it without re-deriving the rule.
//   - The tests (`language-preference.test.ts`) lock in the playable-variant
//     contract so a future caller doesn't have to re-discover its edge cases.
//
// If a future audit shows these helpers are still unused and unlikely to
// be needed, delete the file + tests rather than leaving dead exports.
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
