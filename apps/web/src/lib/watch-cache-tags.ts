export const WATCH_CACHE_TAGS = {
  home: "watch:home",
  settings: "watch:settings",
  experience: "watch:experience",
  video: "watch:video",
  series: "watch:series",
  childDubLanguages: "watch:child-dub-languages",
  routeManifest: "watch:route-manifest",
  seoManifest: "watch:seo-manifest",
} as const

export type WatchCacheTag =
  (typeof WATCH_CACHE_TAGS)[keyof typeof WATCH_CACHE_TAGS]

export function uniqueWatchCacheTags(
  tags: readonly WatchCacheTag[],
): WatchCacheTag[] {
  return [...new Set(tags)]
}

export const WATCH_CACHE_TAG_GROUPS = {
  watchSetting: uniqueWatchCacheTags([
    WATCH_CACHE_TAGS.home,
    WATCH_CACHE_TAGS.settings,
    WATCH_CACHE_TAGS.experience,
    WATCH_CACHE_TAGS.video,
    WATCH_CACHE_TAGS.series,
    WATCH_CACHE_TAGS.childDubLanguages,
  ]),
  experience: uniqueWatchCacheTags([
    WATCH_CACHE_TAGS.experience,
    WATCH_CACHE_TAGS.home,
  ]),
  video: uniqueWatchCacheTags([
    WATCH_CACHE_TAGS.video,
    WATCH_CACHE_TAGS.series,
    WATCH_CACHE_TAGS.childDubLanguages,
    WATCH_CACHE_TAGS.home,
  ]),
  watchRouteManifest: uniqueWatchCacheTags([WATCH_CACHE_TAGS.routeManifest]),
  watchSeoManifest: uniqueWatchCacheTags([WATCH_CACHE_TAGS.seoManifest]),
} as const
