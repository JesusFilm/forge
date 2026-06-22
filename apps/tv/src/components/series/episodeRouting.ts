// Pure (React-free, jest-testable) shape-based routing for an episode-rail card press (R5):
// series-shaped → /series, else /watch. Label-only detection (cards lack childCount), so an
// unlabeled nested collection routes to /watch and leans on the watch route's series redirect (U5).
// Both targets carry an encoded seed (title+artwork, playbackId null) + selected lang slug (U4).

import { isSeriesLabel } from "../../lib/isSeriesRecord"
import { encodeWatchSeed } from "../../lib/watchSeed"

/** The episode fields routing needs — WatchEpisode satisfies this. */
export type RoutableEpisode = {
  slug: string
  title: string | null
  label: string | null
  posterUrl: string | null
}

export type EpisodeRoute = {
  pathname: "/watch/[slug]" | "/series/[slug]"
  params: {
    /** Raw (un-encoded) slug — episodeHref applies the URL encoding. */
    slug: string
    /** encodeWatchSeed output — already percent-encoded, appended as-is. */
    seed: string
    /** The series screen's selected language slug, when one exists (U4). */
    lang?: string
  }
}

export function resolveEpisodePath(
  episode: RoutableEpisode,
  opts?: { languageSlug?: string | null },
): EpisodeRoute {
  const seed = encodeWatchSeed({
    slug: episode.slug,
    title: episode.title,
    imageUrl: episode.posterUrl,
    playbackId: null,
  })
  const params: EpisodeRoute["params"] = { slug: episode.slug, seed }
  const languageSlug = opts?.languageSlug
  if (languageSlug != null && languageSlug !== "") {
    params.lang = languageSlug
  }
  return {
    pathname: isSeriesLabel(episode.label) ? "/series/[slug]" : "/watch/[slug]",
    params,
  }
}

/**
 * Build the string href the routing convention pushes (manually-encoded slug).
 * Object-form router.push would double-encode the already-encoded seed, breaking
 * decodeWatchSeed's decode-once contract on the receiving screen.
 */
export function episodeHref(route: EpisodeRoute): string {
  const base = route.pathname.replace(
    "[slug]",
    encodeURIComponent(route.params.slug),
  )
  const lang =
    route.params.lang != null
      ? `&lang=${encodeURIComponent(route.params.lang)}`
      : ""
  return `${base}?seed=${route.params.seed}${lang}`
}
