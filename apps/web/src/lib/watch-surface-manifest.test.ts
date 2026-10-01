import { describe, expect, it } from "vitest"
import {
  authoredWatchSurfaceSource,
  watchHomeHeroSource,
  watchChaptersSource,
  MAX_WATCH_SURFACE_MARKDOWN_BYTES,
} from "./watch-surface-manifest.sources"
import {
  watchSurfaceItemPath,
  watchSurfaceSource,
} from "./watch-surface-manifest"

import type { WatchHomeModel, WatchHomeHeroSlide } from "./watch-home"
import { buildWatchHomeVideoQueue } from "./watch-home-carousel-sequence"

const config = {
  surface: "watch-home",
  block: "authored",
  presentation: "authored-block",
  placement: "authored-2",
} as const

describe("trusted Watch source projections", () => {
  it("does not issue a CTA for an entirely suppressed empty MediaCollection", () => {
    expect(
      authoredWatchSurfaceSource(
        config,
        {
          __typename: "MediaCollectionBlock",
          mediaDefaultCollectionSlug: "jesus",
          mediaCtaLink: "/watch/jesus.html",
          items: [],
        },
        "english",
      )?.items,
    ).toEqual([])
  })
  it("resolves category tiles through the same locale and invalid-link policy as the rail", () => {
    expect(
      authoredWatchSurfaceSource(
        config,
        {
          __typename: "WatchHomeCategoryRailBlock",
          tiles: [
            {
              id: "one",
              title: "Jesus",
              href: "/watch/jesus.html/spanish-castilian.html",
            },
            {
              id: "external",
              title: "External",
              href: "https://other.example/watch/jesus.html",
            },
            { id: "bad", title: "Unsafe", href: "javascript:alert(1)" },
            { id: "two", title: "Birth", href: "/birth.html" },
          ],
        },
        "english",
      )?.items,
    ).toEqual([
      { position: 0, itemPath: "/watch/jesus.html/spanish-castilian.html" },
      { position: 1, itemPath: "/watch/birth.html" },
    ])
    expect(
      authoredWatchSurfaceSource(
        config,
        { __typename: "WatchHomeCategoryRailBlock", categoryIds: ["jesus"] },
        "spanish-castilian",
      )?.items,
    ).toEqual([
      { position: 0, itemPath: "/watch/jesus.html/spanish-castilian.html" },
    ])
  })
  it("measures only Bible quote resource anchors whose labels mount a resource card", () => {
    expect(
      authoredWatchSurfaceSource(
        config,
        {
          __typename: "BibleQuotesCarouselBlock",
          quotes: [
            null,
            { ctaLink: "/watch/ignored.html" },
            { ctaLabel: "Read", ctaLink: "/watch/jesus.html" },
            {
              ctaLabel: "Read elsewhere",
              ctaLink: "https://other.example/watch/jesus.html",
            },
            { ctaLabel: "Read again", ctaLink: "/watch/jesus.html" },
          ],
        },
        "english",
      )?.items,
    ).toEqual([
      { position: 0, itemPath: "/watch/jesus.html" },
      { position: 1, itemPath: "/watch/jesus.html" },
    ])
  })
  it("retains repeated target occurrences and filters unmeasured links before positions", () => {
    expect(
      watchSurfaceSource(config, [
        "/jesus.html/english.html",
        "/languages",
        "/jesus.html/english.html",
      ]).items,
    ).toEqual([
      { position: 0, itemPath: "/watch/jesus.html/english.html" },
      { position: 1, itemPath: "/watch/jesus.html/english.html" },
    ])
    expect(
      watchSurfaceItemPath(
        "https://other.example/watch/jesus.html/english.html",
      ),
    ).toBeNull()
  })
  it("bounds the exact measured prefix to 100", () => {
    expect(
      watchSurfaceSource(
        config,
        Array.from(
          { length: 101 },
          (_, index) => `/video-${index}.html/english.html`,
        ),
      ).items.at(-1)?.position,
    ).toBe(99)
  })
  it("counts the MediaCollection CTA before cards and resolves item dub languages", () => {
    const source = authoredWatchSurfaceSource(
      config,
      {
        __typename: "MediaCollectionBlock",
        mediaDefaultCollectionSlug: "jesus",
        items: [
          {
            videoSlug: "birth",
            videoDub: { language: { slug: "spanish-castilian" } },
          },
          { videoSlug: "", languageSlug: "english" },
          { videoSlug: "birth" },
        ],
      },
      "english",
    )
    expect(source?.items).toEqual([
      { position: 0, itemPath: "/watch/jesus.html" },
      { position: 1, itemPath: "/watch/birth.html/spanish-castilian.html" },
      { position: 2, itemPath: "/watch/birth.html" },
    ])
  })
  it("recurses visible container slots without accepting unsupported nested content", () => {
    const collection = {
      __typename: "MediaCollectionBlock",
      items: [{ videoSlug: "birth" }],
    }
    expect(
      authoredWatchSurfaceSource(
        config,
        {
          __typename: "ContainerBlock",
          content: [
            collection,
            { __typename: "ContainerSlotBlock" },
            collection,
          ],
        },
        "english",
      )?.items,
    ).toHaveLength(1)
    expect(
      authoredWatchSurfaceSource(
        config,
        {
          __typename: "SectionBlock",
          sectionContent: [collection, { __typename: "FutureBlock" }],
        },
        "english",
      ),
    ).toBeNull()
  })
  it("leaves dynamic collections explicit outer-boundary gaps and matches absent route context", () => {
    for (const itemsSource of ["dynamicCollections"])
      expect(
        authoredWatchSurfaceSource(
          config,
          { __typename: "MediaCollectionBlock", itemsSource },
          "english",
        ),
      ).toBeNull()
    expect(
      authoredWatchSurfaceSource(
        config,
        {
          __typename: "MediaCollectionBlock",
          itemsSource: "routeVideoChildren",
          mediaCtaLink: "/watch/jesus.html",
        },
        "english",
      )?.items,
    ).toEqual([])
  })
  it("bounds total compiled Markdown bytes for the entire authored block", () => {
    expect(
      authoredWatchSurfaceSource(
        config,
        {
          __typename: "TextBlock",
          textVariant: "promotional",
          contentParagraphs: ["x".repeat(MAX_WATCH_SURFACE_MARKDOWN_BYTES + 1)],
        },
        "english",
      ),
    ).toBeNull()
    const answer = "x".repeat(MAX_WATCH_SURFACE_MARKDOWN_BYTES / 2 + 1)
    expect(
      authoredWatchSurfaceSource(
        config,
        {
          __typename: "RelatedQuestionsBlock",
          questions: [{ answer }, { answer }],
        },
        "english",
      ),
    ).toBeNull()
  })
  it("leaves navigation-relative Markdown links unknown without a trusted page pathname", () => {
    for (const href of ["birth.html", "#section", "?lang=english"])
      expect(
        authoredWatchSurfaceSource(
          config,
          {
            __typename: "TextBlock",
            textVariant: "promotional",
            contentParagraphs: [`[Link](${href})`],
          },
          "english",
        ),
      ).toBeNull()
  })
  it("suppresses the chapter parent title when fewer than two children render", () => {
    expect(
      watchChaptersSource(
        {
          kind: "SiblingCarousel",
          currentVideoDocumentId: "current",
          canonicalParent: {
            documentId: "parent",
            slug: "jesus",
            title: null,
            children: [],
          },
        },
        1,
        "english",
      )?.items,
    ).toEqual([])
    expect(
      watchChaptersSource(
        {
          kind: "SiblingCarousel",
          currentVideoDocumentId: "current",
          canonicalParent: {
            documentId: "parent",
            slug: "jesus",
            title: null,
            children: [],
          },
          selectableParents: [
            { documentId: "a", slug: "a", title: null, children: [] },
            { documentId: "b", slug: "b", title: null, children: [] },
          ],
        },
        1,
        "english",
      )?.items,
    ).toEqual([])
  })
})

it("requires exact document authority for navigation-relative hrefs in the thin helper", () => {
  for (const href of [
    "watch/birth.html",
    "birth.html",
    "#section",
    "?x=1",
    "https:watch/birth.html",
    "https:birth.html",
    "https:#section",
    "https:?q=1",
    "",
  ]) {
    expect(watchSurfaceItemPath(href, false)).toBeNull()
  }
  expect(watchSurfaceItemPath("watch/birth.html", false, "/watch")).toBe(
    "/watch/birth.html",
  )
  expect(watchSurfaceItemPath("#section", false, "/watch/spanish.html")).toBe(
    "/watch/spanish.html",
  )
  expect(
    watchSurfaceItemPath("birth.html", false, "//other.example/watch/"),
  ).toBeNull()
})

it("resolves same-scheme relative HTTPS only against an exact trusted document pathname", () => {
  expect(
    watchSurfaceItemPath("https:birth.html", false, "/watch/spanish.html"),
  ).toBe("/watch/birth.html")
  expect(
    watchSurfaceItemPath("https:#section", false, "/watch/spanish.html"),
  ).toBe("/watch/spanish.html")
  expect(watchSurfaceItemPath("https:?q=1", false, "/watch/spanish.html")).toBe(
    "/watch/spanish.html",
  )
  expect(watchSurfaceItemPath("https:watch/birth.html", false, "/watch")).toBe(
    "/watch/birth.html",
  )
  expect(
    watchSurfaceItemPath("https://www.jesusfilm.org/watch/birth.html", false),
  ).toBe("/watch/birth.html")
})

function intro(
  coreId: string,
  href: string,
  videoLabel: string | null = null,
): WatchHomeHeroSlide {
  return {
    id: coreId,
    coreId,
    sourceId: coreId,
    title: coreId,
    label: "Featured",
    videoLabel,
    metaLabel: null,
    href,
    imageUrl: null,
    blurDataUrl: null,
    dominantColor: null,
    imageAlt: "",
    hls: null,
    playbackId: null,
    durationSeconds: null,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
    eyebrow: "Featured",
  }
}
function heroModel(count: number): WatchHomeModel {
  return {
    heroSlides: [],
    sections: [],
    missingData: [],
    carousel: {
      pools: [
        {
          id: "pool",
          collectionIds: ["source"],
          videos: Array.from({ length: count }, (_, index) => ({
            kind: "video" as const,
            id: `synthetic-${index}`,
            title: "Synthetic",
            label: "Segment",
            href: `/synthetic-${index}.html`,
            posterUrl: null,
            thumbnailUrl: null,
            imageAlt: "",
            src: "https://stream.example/synthetic.m3u8",
            playbackId: null,
            durationSeconds: null,
          })),
        },
      ],
    },
  }
}

describe("unbounded internal hero source with bounded active authority", () => {
  it.each([101, 1000])(
    "retains all %i trusted candidates in slot zero",
    (count) => {
      const model = heroModel(count)
      const source = watchHomeHeroSource(model)!
      expect(source.items).toHaveLength(count)
      expect(source.items.every(({ position }) => position === 0)).toBe(true)
      const renderedQueue = buildWatchHomeVideoQueue({
        pools: model.carousel.pools,
        targetVideoCount: count,
        useStoredProgress: false,
      })
      expect(new Set(source.items.map(({ itemPath }) => itemPath))).toEqual(
        new Set(
          renderedQueue.videos.map(({ href }) => watchSurfaceItemPath(href)),
        ),
      )
      expect(source.items.at(-1)?.itemPath).toBe(
        `/watch/synthetic-${count - 1}.html`,
      )
    },
  )
  it("includes eligible intro fallbacks and playable pool candidates, deduplicating exact paths across pools and query variants", () => {
    const model = heroModel(2)
    model.heroSlides = [
      intro("excluded", "/feature.html", "FEATURE_FILM"),
      intro("unknown", "/intro.html?autoplay=1"),
      intro("duplicate", "/synthetic-0.html?t=12", "SEGMENT"),
    ]
    const pool = model.carousel.pools[0]
    model.carousel = {
      pools: [
        pool,
        {
          ...pool,
          id: "duplicate-pool",
          videos: [
            { ...pool.videos[0], href: "/synthetic-0.html?autoplay=1" },
            {
              ...pool.videos[1],
              id: "no-stream",
              href: "/no-stream.html",
              src: null,
            },
            {
              ...pool.videos[1],
              id: "foreign",
              href: "https://other.example/watch/foreign.html",
            },
          ],
        },
      ],
    }
    const source = watchHomeHeroSource(model, "authored-hero-3")!
    expect(source.placement).toBe("authored-hero-3")
    expect(source.items).toEqual([
      { position: 0, itemPath: "/watch/intro.html" },
      { position: 0, itemPath: "/watch/synthetic-0.html" },
      { position: 0, itemPath: "/watch/synthetic-1.html" },
    ])
    expect(watchHomeHeroSource(heroModel(0))?.items).toEqual([])
  })
})
