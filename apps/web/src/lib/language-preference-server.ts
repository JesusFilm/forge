import "server-only"
import { cookies } from "next/headers"

export const LANGUAGE_PREFERENCE_COOKIE = "forge_watch_lang"

export async function readPreferredLanguageSlug(): Promise<string | null> {
  const store = await cookies()
  return store.get(LANGUAGE_PREFERENCE_COOKIE)?.value ?? null
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
    (v) =>
      v?.language?.slug === preferredSlug &&
      v?.published === true &&
      v?.hls != null,
  )
  return hasPlayable ? preferredSlug : null
}
