import { describe, expect, it } from "vitest"

import type { WatchVideoMetadataModel } from "@/lib/experience-metadata"
import { projectWatchHomeVisibleContent } from "@/lib/watch-home-visible-content"
import type { WatchRouteManifest } from "@/lib/watch-route-manifest"
import {
  WATCH_STRUCTURED_DATA_ITEM_LIMIT,
  watchHomeCollectionStructuredDataJson,
  watchRelatedItemListStructuredDataJson,
  watchSeriesCollectionStructuredDataJson,
  watchVideoStructuredDataJson,
} from "@/lib/watch-structured-data"

const completeVideo: WatchVideoMetadataModel = {
  title: "Life < Jesus | Jesus Film Project",
  videoTitle: "Life < Jesus",
  structuredDataTitle: "Life < Jesus",
  description: "A page-specific story with <script> content.",
  canonicalUrl: "https://www.jesusfilm.org/watch/life.html/english.html",
  image: {
    url: "https://image.mux.com/pb/thumbnail.jpg",
    width: 1200,
    height: 630,
    alt: "Poster",
    type: "image/jpeg",
  },
  structuredDataThumbnailUrl:
    "https://image.mux.com/pb/thumbnail.jpg?width=1200",
  noIndex: false,
  inLanguage: "en",
  durationSeconds: 91.4,
  contentUrl: " https://stream.mux.com/life.m3u8\n",
  uploadDate: "2026-06-01",
  captions: [
    {
      contentUrl: "https://cdn.example/life-en.vtt",
      inLanguage: "en",
    },
    {
      contentUrl: "javascript:private",
      inLanguage: "english",
    },
  ],
}

describe("watchVideoStructuredDataJson", () => {
  it("serializes one complete, sanitized VideoObject with key moments", () => {
    const json = watchVideoStructuredDataJson(completeVideo)

    expect(json).not.toBeNull()
    expect(json).not.toContain("<")
    expect(JSON.parse(json!)).toEqual({
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: "Life < Jesus",
      description: "A page-specific story with <script> content.",
      url: "https://www.jesusfilm.org/watch/life.html/english.html",
      contentUrl: "https://stream.mux.com/life.m3u8",
      thumbnailUrl: ["https://image.mux.com/pb/thumbnail.jpg?width=1200"],
      inLanguage: "en",
      uploadDate: "2026-06-01T00:00:00.000Z",
      duration: "PT91.4S",
      publisher: {
        "@type": "Organization",
        "@id": "https://www.jesusfilm.org/#organization",
        name: "Jesus Film Project",
        url: "https://www.jesusfilm.org",
      },
      caption: [
        {
          "@type": "MediaObject",
          contentUrl: "https://cdn.example/life-en.vtt",
          encodingFormat: "text/vtt",
          inLanguage: "en",
        },
      ],
      potentialAction: {
        "@type": "SeekToAction",
        target:
          "https://www.jesusfilm.org/watch/life.html/english.html?t={seek_to_second_number}",
        "startOffset-input": "required name=seek_to_second_number",
      },
    })
    expect(json).not.toContain("embedUrl")
    expect(json).not.toContain("BreadcrumbList")
  })

  it.each([
    ["blank name", { structuredDataTitle: " " }],
    ["blank description", { description: "" }],
    ["generic thumbnail", { structuredDataThumbnailUrl: null }],
    ["missing upload date", { uploadDate: null }],
    ["non-HTTPS media", { contentUrl: "http://cdn.example/life.m3u8" }],
    ["signed media", { contentUrl: "https://cdn.example/life.m3u8?token=x" }],
    ["missing duration", { durationSeconds: null }],
    ["noIndex", { noIndex: true }],
  ])("omits incomplete VideoObject data: %s", (_label, change) => {
    expect(
      watchVideoStructuredDataJson({ ...completeVideo, ...change }),
    ).toBeNull()
  })

  it("omits SeekToAction below 30 seconds without suppressing the video", () => {
    const json = watchVideoStructuredDataJson({
      ...completeVideo,
      durationSeconds: 29.9,
    })
    expect(JSON.parse(json!)).not.toHaveProperty("potentialAction")
    expect(JSON.parse(json!).duration).toBe("PT29.9S")
  })

  it("omits an invalid language without suppressing an otherwise complete video", () => {
    const payload = JSON.parse(
      watchVideoStructuredDataJson({
        ...completeVideo,
        inLanguage: "english",
      })!,
    )
    expect(payload).not.toHaveProperty("inLanguage")
  })

  it("omits signed or non-VTT caption URLs", () => {
    const payload = JSON.parse(
      watchVideoStructuredDataJson({
        ...completeVideo,
        captions: [
          {
            contentUrl: "https://cdn.example/life-en.vtt?token=x",
            inLanguage: "en",
          },
          {
            contentUrl: "https://cdn.example/life-en.txt",
            inLanguage: "en",
          },
        ],
      })!,
    )
    expect(payload).not.toHaveProperty("caption")
  })
})

describe("collection structured data", () => {
  it("builds a bounded home list from the sequenced hero and authored media items", () => {
    const mediaItems = Array.from({ length: 14 }, (_, index) => ({
      videoId: `video-${index}`,
      videoSlug: index === 1 ? "hero-video" : `video-${index}`,
      languageSlug: index === 2 ? "spanish-castilian" : null,
      resolvedTitle: `Video ${index}`,
      titleOverride: null,
      subtitleOverride: null,
      labelOverride: null,
      collectionSize: null,
      videoDub: null,
      videoImage: null,
      imageAsset: null,
    }))
    const model = {
      heroSlides: [],
      sections: [
        {
          id: "legacy",
          eyebrow: "",
          title: "Hidden legacy section",
          description: null,
          layout: "rail",
          orientation: "horizontal",
          showSequenceNumbers: false,
          cards: [
            {
              title: "Must not appear",
              href: "/watch/hidden.html/english.html",
            },
          ],
        },
      ],
      carousel: {
        pools: [
          {
            id: "featured",
            collectionIds: [],
            videos: [
              {
                kind: "video",
                id: "hero",
                title: "Hero video",
                description: null,
                label: "Feature film",
                href: "/watch/hero-video.html/english.html",
                posterUrl: null,
                thumbnailUrl: null,
                imageAlt: "",
                src: "https://stream.mux.com/hero.m3u8",
                playbackId: "hero",
                durationSeconds: 90,
              },
            ],
          },
        ],
        muxInserts: [],
      },
      missingData: [],
    } as never
    const blocks = [
      {
        __typename: "MediaCollectionBlock",
        itemsSource: "manual",
        items: mediaItems,
      },
      {
        __typename: "VideoCarouselBlock",
        items: [
          {
            videoSlug: "inline-player",
            resolvedTitle: "Inline player",
          },
        ],
      },
    ] as never
    const visibleContent = projectWatchHomeVisibleContent({
      model,
      blocks,
      languageSlug: "english",
    })
    const json = watchHomeCollectionStructuredDataJson({
      destinations: visibleContent.destinations,
      canonicalUrl: "https://www.jesusfilm.org/watch/spanish-castilian.html",
      inLanguage: "es-ES",
      name: "Watch",
    })

    const payload = JSON.parse(json!)
    const items = payload.mainEntity.itemListElement
    expect(payload).toMatchObject({
      "@type": "CollectionPage",
      url: "https://www.jesusfilm.org/watch/spanish-castilian.html",
      inLanguage: "es-ES",
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: WATCH_STRUCTURED_DATA_ITEM_LIMIT,
      },
    })
    expect(items).toHaveLength(WATCH_STRUCTURED_DATA_ITEM_LIMIT)
    expect(items.map((item: { position: number }) => item.position)).toEqual(
      Array.from(
        { length: WATCH_STRUCTURED_DATA_ITEM_LIMIT },
        (_, index) => index + 1,
      ),
    )
    expect(items[0]).toMatchObject({
      name: "Hero video",
      url: "https://www.jesusfilm.org/watch/hero-video.html/english.html",
    })
    expect(items[2].url).toContain("/spanish-castilian.html")
    expect(json).not.toContain("Hidden legacy section")
    expect(json).not.toContain("Inline player")
  })

  it("drops container orphans that the homepage renderer does not show", () => {
    const visibleContent = projectWatchHomeVisibleContent({
      model: {
        heroSlides: [],
        sections: [],
        carousel: { pools: [], muxInserts: [] },
        missingData: [],
      } as never,
      blocks: [
        {
          __typename: "ContainerBlock",
          content: [
            {
              __typename: "MediaCollectionBlock",
              items: [
                {
                  videoSlug: "orphan",
                  resolvedTitle: "Orphan",
                  titleOverride: null,
                  subtitleOverride: null,
                  labelOverride: null,
                  collectionSize: null,
                },
              ],
            },
            { __typename: "ContainerSlotBlock" },
            {
              __typename: "MediaCollectionBlock",
              items: [
                {
                  videoSlug: "visible",
                  resolvedTitle: "Visible",
                  titleOverride: null,
                  subtitleOverride: null,
                  labelOverride: null,
                  collectionSize: null,
                },
              ],
            },
          ],
        },
      ] as never,
      languageSlug: "english",
    })

    expect(visibleContent.destinations).toEqual([
      {
        name: "Visible",
        url: "https://www.jesusfilm.org/watch/visible.html/english.html",
      },
    ])
  })

  it("omits empty and noIndex series collections", () => {
    const baseSeries = {
      title: "Series",
      description: "Description",
      snippet: null,
      noIndex: false,
      children: [],
    }
    const options = {
      series: baseSeries as never,
      languageSlug: "english",
      canonicalUrl: "https://www.jesusfilm.org/watch/series.html/english.html",
      inLanguage: "en",
      routeManifest: {
        version: "test",
        generatedAt: "2026-07-23T00:00:00.000Z",
        contentSlugs: [],
        oneSegmentSlugs: [],
        episodePairsByParent: {},
        audioLanguageSlugs: ["english"],
        audioLanguageIndexesByContent: {},
      } satisfies WatchRouteManifest,
    }
    expect(watchSeriesCollectionStructuredDataJson(options)).toBeNull()
    expect(
      watchSeriesCollectionStructuredDataJson({
        ...options,
        series: {
          ...baseSeries,
          noIndex: true,
          children: [{ slug: "episode", title: "Episode" }],
        } as never,
      }),
    ).toBeNull()
  })

  it("uses standalone child URLs and contiguous positions for a series", () => {
    const routeManifest = {
      version: "test",
      generatedAt: "2026-07-23T00:00:00.000Z",
      contentSlugs: ["episode-one", "episode-two", "episode-three"],
      oneSegmentSlugs: [],
      episodePairsByParent: {},
      audioLanguageSlugs: ["english", "spanish-castilian"],
      audioLanguageIndexesByContent: {
        "episode-one": [0],
        "episode-two": [0],
        "episode-three": [1],
      },
    } satisfies WatchRouteManifest
    const json = watchSeriesCollectionStructuredDataJson({
      series: {
        title: "Series",
        description: "Description",
        noIndex: false,
        children: [
          { slug: "episode-one", title: "Episode one" },
          { slug: null, title: "Missing" },
          { slug: "episode-one", title: "Duplicate" },
          { slug: "episode-two", title: "Episode two" },
          { slug: "episode-three", title: "Wrong language" },
        ],
      } as never,
      languageSlug: "english",
      canonicalUrl: "https://www.jesusfilm.org/watch/series.html/english.html",
      inLanguage: "en",
      routeManifest,
    })
    const items = JSON.parse(json!).mainEntity.itemListElement
    expect(items).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Episode one",
        url: "https://www.jesusfilm.org/watch/episode-one.html/english.html",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Episode two",
        url: "https://www.jesusfilm.org/watch/episode-two.html/english.html",
      },
    ])
  })
})

describe("watchRelatedItemListStructuredDataJson", () => {
  it("bounds and flattens related items without nested VideoObjects", () => {
    const children = Array.from({ length: 14 }, (_, index) => ({
      slug: `episode-${index}`,
      title: `Episode ${index}`,
      images: [],
      durationSeconds: 60.5,
    }))
    const json = watchRelatedItemListStructuredDataJson({
      blocks: [
        {
          kind: "SiblingCarousel",
          canonicalParent: { children },
        },
      ] as never,
      languageSlug: "english",
    })
    const payload = JSON.parse(json!)
    expect(payload.numberOfItems).toBe(WATCH_STRUCTURED_DATA_ITEM_LIMIT)
    expect(payload.itemListElement).toHaveLength(
      WATCH_STRUCTURED_DATA_ITEM_LIMIT,
    )
    expect(payload.itemListElement[0]).toMatchObject({
      "@type": "ListItem",
      position: 1,
      name: "Episode 0",
      url: "https://www.jesusfilm.org/watch/episode-0.html/english.html",
    })
    expect(json).not.toContain("VideoObject")
  })
})
