// Static legacy-slug → canonical-slug alias table. Hand-curated from
// docs/research/jesusfilm-watch-url-patterns.md §2.1. `as const satisfies`
// keeps the literal keys statically known; CI validation cross-references
// the canonical values against admin's Language.slug corpus.

/** Static legacy-slug → canonical-slug alias map for the watch URL space. `as const satisfies` keeps the literal keys statically known so consumers can derive `LegacyLanguageSlug` + `CanonicalLanguageSlug` types. */
export const LANGUAGE_SLUG_ALIASES = {
  "chinese-mandarin": "mandarin-china",
} as const satisfies Record<string, string>

/** Union of legacy language slug keys (e.g. `"chinese-mandarin"`). */
export type LegacyLanguageSlug = keyof typeof LANGUAGE_SLUG_ALIASES

/** Union of canonical language slug values (e.g. `"mandarin-china"`). */
export type CanonicalLanguageSlug =
  (typeof LANGUAGE_SLUG_ALIASES)[LegacyLanguageSlug]

const SAFE_SLUG = /^[a-z0-9-]+$/

/**
 * Resolve a legacy language slug to its canonical form. Returns `null` if
 * the input is not a known alias.
 *
 * Uses `Object.hasOwn` (not bracket access) so prototype keys like
 * `__proto__` and `constructor` return `null` instead of a function or
 * non-string. Re-validates the resolved value against `SAFE_SLUG` so a
 * future dynamic data source can't smuggle in a path-traversal or
 * scheme-prefixed string.
 */
export function tryResolveLanguageAlias(slug: string): string | null {
  if (!Object.hasOwn(LANGUAGE_SLUG_ALIASES, slug)) return null
  const canonical = LANGUAGE_SLUG_ALIASES[slug as LegacyLanguageSlug]
  return SAFE_SLUG.test(canonical) ? canonical : null
}
