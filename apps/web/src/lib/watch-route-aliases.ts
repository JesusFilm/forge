import { SAFE_SLUG_PATTERN } from "./url-shape"

const LEGACY_EPISODE_ALIASES: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = Object.freeze({
  "lumo-the-gospel-of-john": Object.freeze({
    "wedding-in-cana": "lumo-john-1-35-2-22",
  }),
  "lumo-the-gospel-of-luke": Object.freeze({
    "birth-of-jesus": "lumo-luke-1-57-2-40",
  }),
})

export function resolveLegacyWatchEpisodeAlias(
  seriesSlug: string,
  episodeSlug: string,
): string | null {
  if (!Object.hasOwn(LEGACY_EPISODE_ALIASES, seriesSlug)) return null
  const episodeAliases = LEGACY_EPISODE_ALIASES[seriesSlug]
  if (!episodeAliases || !Object.hasOwn(episodeAliases, episodeSlug)) {
    return null
  }
  const canonicalSlug = episodeAliases[episodeSlug]
  return typeof canonicalSlug === "string" &&
    SAFE_SLUG_PATTERN.test(canonicalSlug)
    ? canonicalSlug
    : null
}
