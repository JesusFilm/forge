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
  return LEGACY_EPISODE_ALIASES[seriesSlug]?.[episodeSlug] ?? null
}
