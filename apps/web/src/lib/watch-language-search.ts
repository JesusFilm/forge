import {
  WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY,
  type WatchLanguageSearchAliasAuthority,
} from "./watch-language-search-aliases"

const SEARCH_WORD_SEPARATOR = /[\s,.;:!?()[\]{}"'/\\|_-]+/u

export type WatchLanguageSearchCandidate = {
  slug: string
  /**
   * Exact source language slug allowed to own reviewed aliases. `null` keeps a
   * locale-derived routing slug searchable without granting alias ownership;
   * omission means `slug` itself is the exact source slug.
   */
  aliasOwnerSlug?: string | null
  displayName: string | null | undefined
  nativeName?: string | null
  disabled?: boolean
}

export type WatchLanguageSearchMatcher = (
  candidate: WatchLanguageSearchCandidate,
) => number | null

function searchMatchTierForText(
  value: string | null | undefined,
  query: string,
): number | null {
  const text = value?.trim().toLowerCase()
  if (!text || !text.includes(query)) return null
  if (text.startsWith(query)) return 0
  if (
    text.split(SEARCH_WORD_SEPARATOR).some((word) => word.startsWith(query))
  ) {
    return 1
  }
  return 2
}

function lowestSearchMatchTier(
  values: readonly (string | null | undefined)[],
  query: string,
): number | null {
  let lowestTier: number | null = null

  for (const value of values) {
    const tier = searchMatchTierForText(value, query)
    if (tier === 0) return 0
    if (tier != null && (lowestTier == null || tier < lowestTier)) {
      lowestTier = tier
    }
  }

  return lowestTier
}

function lowerSearchMatchTier(
  currentTier: number | null,
  candidateTier: number | null,
): number | null {
  if (candidateTier == null) return currentTier
  if (currentTier == null) return candidateTier
  return Math.min(currentTier, candidateTier)
}

/**
 * Build one matcher for a user's current query, then reuse it across every
 * option in the caller-owned availability list.
 *
 * Exact public slugs identify languages. Reviewed aliases only improve how a
 * supplied option is found; they never create an option or infer identity from
 * BCP-47.
 */
export function createWatchLanguageSearchMatcher(
  query: string,
  aliasAuthority: WatchLanguageSearchAliasAuthority = WATCH_LANGUAGE_SEARCH_ALIAS_AUTHORITY,
): WatchLanguageSearchMatcher {
  const normalizedQuery = query.trim().toLowerCase()
  const exactAliasQuery = aliasAuthority.exactAliases.has(normalizedQuery)

  return (candidate) => {
    if (!normalizedQuery) return 0

    const aliasOwnerSlug =
      candidate.aliasOwnerSlug === undefined
        ? candidate.slug
        : candidate.aliasOwnerSlug
    const aliases =
      aliasOwnerSlug &&
      Object.hasOwn(aliasAuthority.aliasesBySlug, aliasOwnerSlug)
        ? aliasAuthority.aliasesBySlug[aliasOwnerSlug]
        : undefined
    const ownsExactAlias = aliases?.some(
      (alias) => alias.trim().toLowerCase() === normalizedQuery,
    )

    if (exactAliasQuery && (candidate.disabled || !ownsExactAlias)) return null

    let directTier = searchMatchTierForText(
      candidate.displayName,
      normalizedQuery,
    )
    directTier = lowerSearchMatchTier(
      directTier,
      searchMatchTierForText(candidate.nativeName, normalizedQuery),
    )
    directTier = lowerSearchMatchTier(
      directTier,
      searchMatchTierForText(candidate.slug, normalizedQuery),
    )
    if (directTier !== 0) {
      directTier = lowerSearchMatchTier(
        directTier,
        searchMatchTierForText(
          candidate.slug.replace(/-/g, " "),
          normalizedQuery,
        ),
      )
    }

    const aliasMatchTier = candidate.disabled
      ? null
      : lowestSearchMatchTier(aliases ?? [], normalizedQuery)
    const aliasTier = aliasMatchTier == null ? null : aliasMatchTier + 3

    if (directTier == null) return aliasTier
    if (aliasTier == null) return directTier
    return Math.min(directTier, aliasTier)
  }
}
