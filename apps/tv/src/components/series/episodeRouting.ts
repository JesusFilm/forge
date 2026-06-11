// Pure routing decision for an episode-rail card press. Kept React-free (like
// searchResultPath.ts / seriesScreenState.ts) so it is unit-testable under
// jest-expo, which cannot load .tsx.
//
// Shape-based routing (R5): a series-shaped child opens the nested /series
// screen; everything else opens /watch. Episode cards carry `label` but NOT
// `childCount`, so detection here is label-only (isSeriesLabel) — an unlabeled
// nested collection routes to /watch and relies on the watch route's series
// redirect (U5) to land correctly.
//
// Both targets carry an encoded seed (title + artwork, playbackId null — a
// rail card knows no playable stream) for instant first paint, and the
// caller's selected language slug when one exists. U4 wires the provider that
// consumes `lang` on the watch screen; it is accepted-and-threaded now so the
// param contract is already in place.

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
 * Build the string href the app's routing convention pushes (string hrefs
 * with a manually-encoded slug — see searchResultPath and the series leaf
 * bounce). Object-form router.push would percent-encode the already-encoded
 * seed a second time, breaking decodeWatchSeed's decode-once contract on the
 * receiving screen.
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
