import { normalizeWatchSearchTitle } from "./typesense-watch-search-ranking"

type WatchSearchCanonicalIntentCatalogEntry = {
  languageSlug: string
  aliases: readonly string[]
  targetCanonicalVideoId: string
}

type WatchSearchCanonicalIntent = {
  targetCanonicalVideoId: string
}

export class WatchSearchCanonicalIntentConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WatchSearchCanonicalIntentConfigurationError"
  }
}

type WatchSearchCanonicalIntentResolver = (
  query: string,
  languageSlug: string | null,
) => WatchSearchCanonicalIntent | null

function canonicalIntentKey(
  normalizedQuery: string,
  languageSlug: string,
): string {
  return `${languageSlug}\u0000${normalizedQuery}`
}

export function createWatchSearchCanonicalIntentResolver(
  entries: readonly WatchSearchCanonicalIntentCatalogEntry[],
): WatchSearchCanonicalIntentResolver {
  const intentsByAlias = new Map<string, WatchSearchCanonicalIntent>()

  for (const entry of entries) {
    const languageSlug = entry.languageSlug.trim().toLocaleLowerCase("en")
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(languageSlug)) {
      throw new WatchSearchCanonicalIntentConfigurationError(
        "Canonical intent language slug must be non-empty",
      )
    }
    if (!/^core:\S+$/.test(entry.targetCanonicalVideoId)) {
      throw new WatchSearchCanonicalIntentConfigurationError(
        "Canonical intent target must use stable Core identity",
      )
    }
    if (entry.aliases.length === 0) {
      throw new WatchSearchCanonicalIntentConfigurationError(
        "Canonical intent entry must declare at least one alias",
      )
    }

    for (const alias of entry.aliases) {
      const normalizedAlias = normalizeWatchSearchTitle(alias).normalized
      if (!normalizedAlias) {
        throw new WatchSearchCanonicalIntentConfigurationError(
          "Canonical intent alias must be non-empty",
        )
      }
      const key = canonicalIntentKey(normalizedAlias, languageSlug)
      if (intentsByAlias.has(key)) {
        throw new WatchSearchCanonicalIntentConfigurationError(
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
    const normalizedQuery = normalizeWatchSearchTitle(query).normalized
    return (
      intentsByAlias.get(
        canonicalIntentKey(normalizedQuery, normalizedLanguageSlug),
      ) ?? null
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
