// SYNC: mirrors apps/web media-image-url.ts + apps/tv experienceHydration.ts.
// The watch web origin serving bundled poster assets — absolute (not the relative
// static base) so posters load in dev builds too. Prod-pinned across envs.
const WATCH_ASSET_BASE = "https://watch.jesusfilm.org/watch"

// `imageOverrideUrl` is a curated vertical-poster seed like
// jesusfilm.org/images/thumbnails/{coreId}-vertical.png that 404s on that host.
// Rewrite to the watch origin (same poster web/TV render); else pass through.
export function rewriteSeedPosterUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null
  const match = url.match(
    /^https?:\/\/(?:www\.)?jesusfilm\.org(\/images\/.*)$/i,
  )
  return match?.[1] ? `${WATCH_ASSET_BASE}${match[1]}` : url
}
