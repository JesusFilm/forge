import { normalizeWatchSearchTitle } from "./typesense-watch-search-ranking"

export type WatchSearchCanonicalIntentCatalogEntry = {
  languageSlug: string
  aliases: readonly string[]
  targetCanonicalVideoId: string
}

export type WatchSearchCanonicalIntent = {
  targetCanonicalVideoId: string
}

type WatchSearchCanonicalIntentResolver = (
  query: string,
  languageSlug: string | null,
) => WatchSearchCanonicalIntent | null

function normalizedAliasKey(query: string, languageSlug: string): string {
  return `${languageSlug}\u0000${normalizeWatchSearchTitle(query).normalized}`
}

export function createWatchSearchCanonicalIntentResolver(
  entries: readonly WatchSearchCanonicalIntentCatalogEntry[],
): WatchSearchCanonicalIntentResolver {
  const intentsByAlias = new Map<string, WatchSearchCanonicalIntent>()

  for (const entry of entries) {
    const languageSlug = entry.languageSlug.trim().toLocaleLowerCase("en")
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(languageSlug)) {
      throw new Error("Canonical intent language slug must be non-empty")
    }
    if (!/^core:\S+$/.test(entry.targetCanonicalVideoId)) {
      throw new Error("Canonical intent target must use stable Core identity")
    }
    if (entry.aliases.length === 0) {
      throw new Error("Canonical intent entry must declare at least one alias")
    }

    for (const alias of entry.aliases) {
      const normalizedAlias = normalizeWatchSearchTitle(alias).normalized
      if (!normalizedAlias) {
        throw new Error("Canonical intent alias must be non-empty")
      }
      const key = normalizedAliasKey(normalizedAlias, languageSlug)
      if (intentsByAlias.has(key)) {
        throw new Error(
          `Canonical intent collision for ${languageSlug}:${normalizedAlias}`,
        )
      }
      intentsByAlias.set(
        key,
        Object.freeze({
          targetCanonicalVideoId: entry.targetCanonicalVideoId,
        }),
      )
    }
  }

  return (query, languageSlug) => {
    if (!languageSlug) return null
    const normalizedLanguageSlug = languageSlug.trim().toLocaleLowerCase("en")
    if (!normalizedLanguageSlug) return null
    return (
      intentsByAlias.get(normalizedAliasKey(query, normalizedLanguageSlug)) ??
      null
    )
  }
}

const resolveReviewedWatchSearchCanonicalIntent =
  createWatchSearchCanonicalIntentResolver([
    {
      languageSlug: "english",
      aliases: ["Jesus for kids", "Jesus for children"],
      targetCanonicalVideoId: "core:1_cl-0-0",
    },
  ])

export function resolveWatchSearchCanonicalIntent(
  query: string,
  languageSlug: string | null,
): WatchSearchCanonicalIntent | null {
  return resolveReviewedWatchSearchCanonicalIntent(query, languageSlug)
}
