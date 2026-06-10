import { describe, expect, it } from "vitest"
import {
  WATCH_RENDER_CACHE_REVALIDATE_SECONDS,
  WATCH_CACHE_TAG_GROUPS,
  WATCH_CACHE_TAGS,
  uniqueWatchCacheTags,
} from "./watch-cache-tags"

describe("watch cache tags", () => {
  it("exports stable coarse tags for watch caches", () => {
    expect(WATCH_CACHE_TAGS).toEqual({
      home: "watch:home",
      settings: "watch:settings",
      experience: "watch:experience",
      video: "watch:video",
      series: "watch:series",
      childDubLanguages: "watch:child-dub-languages",
      routeManifest: "watch:route-manifest",
    })
  })

  it("keeps route-render cache TTL aligned with the static route TTL", () => {
    expect(WATCH_RENDER_CACHE_REVALIDATE_SECONDS).toBe(3600)
  })

  it("dedupes grouped tag lists while preserving order", () => {
    expect(
      uniqueWatchCacheTags([
        WATCH_CACHE_TAGS.video,
        WATCH_CACHE_TAGS.series,
        WATCH_CACHE_TAGS.video,
      ]),
    ).toEqual([WATCH_CACHE_TAGS.video, WATCH_CACHE_TAGS.series])
  })

  it("groups semantic webhook models into the caches they can affect", () => {
    expect(WATCH_CACHE_TAG_GROUPS.watchSetting).toEqual([
      WATCH_CACHE_TAGS.home,
      WATCH_CACHE_TAGS.settings,
      WATCH_CACHE_TAGS.experience,
      WATCH_CACHE_TAGS.video,
      WATCH_CACHE_TAGS.series,
      WATCH_CACHE_TAGS.childDubLanguages,
    ])
    expect(WATCH_CACHE_TAG_GROUPS.experience).toEqual([
      WATCH_CACHE_TAGS.experience,
      WATCH_CACHE_TAGS.home,
    ])
    expect(WATCH_CACHE_TAG_GROUPS.video).toEqual([
      WATCH_CACHE_TAGS.video,
      WATCH_CACHE_TAGS.series,
      WATCH_CACHE_TAGS.childDubLanguages,
      WATCH_CACHE_TAGS.home,
    ])
    expect(WATCH_CACHE_TAG_GROUPS.watchRouteManifest).toEqual([
      WATCH_CACHE_TAGS.routeManifest,
    ])
  })
})
