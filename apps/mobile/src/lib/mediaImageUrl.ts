// SYNC: mirrors apps/web/src/lib/media-image-url.ts and apps/tv's
// experienceHydration.ts rewriteSeedPosterUrl. The watch web app origin serving
// its bundled poster assets — absolute (not the relative static base) so posters
// load in dev builds too. Prod-pinned across envs.
const WATCH_ASSET_BASE = "https://watch.jesusfilm.org/watch"

// A MediaCollection item's `imageOverrideUrl` is a curated vertical-poster seed
// like `https://www.jesusfilm.org/images/thumbnails/{coreId}-vertical.png` that
// 404s on that host. Rewrite it to the watch origin (the SAME poster web/TV
// renders); any other URL passes through unchanged.
export function rewriteSeedPosterUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null
  const match = url.match(
    /^https?:\/\/(?:www\.)?jesusfilm\.org(\/images\/.*)$/i,
  )
  return match?.[1] ? `${WATCH_ASSET_BASE}${match[1]}` : url
}
