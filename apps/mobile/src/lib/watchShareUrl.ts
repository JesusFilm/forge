import {
  buildCanonicalWatchVideoPath,
  DEFAULT_WATCH_LANGUAGE_SLUG,
} from "@forge/watch-url-policy/routes"

/**
 * Public watch share URL: /watch/{slug}.html(/{language}.html) — the verified-
 * live format (the bare /{slug}.html without /watch/ 404s). The watch screen's
 * extensionless form was copy-paste drift; unified here (todo 014).
 */
export function buildWatchShareUrl(
  slug: string,
  languageSlug: string | null | undefined,
): string {
  const path = buildCanonicalWatchVideoPath(
    slug,
    languageSlug ?? DEFAULT_WATCH_LANGUAGE_SLUG,
  )
  return `https://www.jesusfilm.org/watch${path}`
}
