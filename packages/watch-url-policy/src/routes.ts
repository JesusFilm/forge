import { PUBLIC_WATCH_LANGUAGE_SLUGS } from "./public-watch-language-slugs"

export { PUBLIC_WATCH_LANGUAGE_SLUGS } from "./public-watch-language-slugs"

export const DEFAULT_WATCH_LANGUAGE_SLUG = "english"

/**
 * Whether a content slug may own `/{content}.html` as its canonical English
 * URL without colliding with an existing public language home.
 */
export function isLanguageLessWatchVideoPathEligible(
  contentSlug: string,
): boolean {
  return !PUBLIC_WATCH_LANGUAGE_SLUGS.has(contentSlug)
}

/** Build `/{content}.html/{language}.html` for compatibility and internals. */
export function buildExplicitWatchVideoPath(
  contentSlug: string,
  languageSlug: string,
): string {
  return `/${contentSlug}.html/${languageSlug}.html`
}

/**
 * Build the public standalone path. Eligible English omits its language;
 * international and collision-owned routes remain language-explicit.
 */
export function buildCanonicalWatchVideoPath(
  contentSlug: string,
  languageSlug: string,
): string {
  if (
    languageSlug === DEFAULT_WATCH_LANGUAGE_SLUG &&
    isLanguageLessWatchVideoPathEligible(contentSlug)
  ) {
    return `/${contentSlug}.html`
  }
  return buildExplicitWatchVideoPath(contentSlug, languageSlug)
}
