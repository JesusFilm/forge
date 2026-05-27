// Static legacy-slug → canonical-slug alias table. Hand-curated from
// docs/research/jesusfilm-watch-url-patterns.md §2.1. `as const satisfies`
// keeps the literal keys statically known; CI validation cross-references
// the canonical values against admin's Language.slug corpus.

export const LANGUAGE_SLUG_ALIASES = {
  "chinese-mandarin": "mandarin-china",
} as const satisfies Record<string, string>

export type LegacyLanguageSlug = keyof typeof LANGUAGE_SLUG_ALIASES
export type CanonicalLanguageSlug =
  (typeof LANGUAGE_SLUG_ALIASES)[LegacyLanguageSlug]

const SAFE_SLUG = /^[a-z0-9-]+$/

// Uses Object.hasOwn (not bracket access) so prototype keys like __proto__
// or constructor return null instead of returning a function or non-string.
// Re-validates the resolved value against SAFE_SLUG so a future dynamic
// data source can't smuggle in a path-traversal or scheme-prefixed string.
export function tryResolveLanguageAlias(slug: string): string | null {
  if (!Object.hasOwn(LANGUAGE_SLUG_ALIASES, slug)) return null
  const canonical = LANGUAGE_SLUG_ALIASES[slug as LegacyLanguageSlug]
  return SAFE_SLUG.test(canonical) ? canonical : null
}
