/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { RouteVideo } from "@/lib/content"
import type { EnrichedMediaItem } from "@/lib/enrichment"

import { MediaCollection } from "./MediaCollection"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

// The component destructures these fields off `data` at runtime; the prop
// type derives from a legacy Strapi fragment, so we cast a minimal literal.
function makeData(
  overrides: Record<string, unknown> = {},
): Parameters<typeof MediaCollection>[0]["data"] {
  return {
    id: "mc-1",
    title: "Related",
    subtitle: null,
    mediaDescription: null,
    backgroundColor: null,
    categoryLabel: null,
    itemsSource: "routeVideoChildren",
    mediaCtaLink: null,
    mediaCtaLabel: null,
    showItemNumbers: false,
    mediaCollectionVariant: "carousel",
    footerText: null,
    items: [],
    ...overrides,
  } as unknown as Parameters<typeof MediaCollection>[0]["data"]
}

function makeRouteVideo(videoSlug: string): RouteVideo {
  const relatedItems: EnrichedMediaItem[] = [
    {
      id: "v-1",
      title: "Episode One",
      subtitle: "",
      label: "",
      collectionSize: "",
      imageUrl: null,
      blurDataUrl: null,
      dominantColor: null,
      videoSlug,
      muxPlaybackId: "mux-route-child",
    },
  ]
  return {
    documentId: "rv-1",
    slug: "series",
    title: "Series",
    snippet: null,
    description: null,
    noIndex: false,
    imageUrl: null,
    imageAlt: null,
    streamingUrl: null,
    relatedItems,
  }
}

function makeManualItem(overrides: Record<string, unknown> = {}) {
  return {
    videoId: "v-1",
    videoSlug: "episode-one",
    titleOverride: "Episode One",
    subtitleOverride: null,
    labelOverride: null,
    collectionSize: null,
    imageUrl: "https://cdn.example/episode-one.jpg",
    imageBlurDataUrl: "https://cdn.example/episode-one-blur.jpg",
    ...overrides,
  }
}

describe("MediaCollection VideoCard href", () => {
  it("renders the carousel variant as a fixed-width horizontal rail", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData()}
          routeVideo={makeRouteVideo("the-gospel-of-john")}
        />,
      )
    })

    const carousel = container.querySelector(
      '[data-testid="media-collection-carousel"]',
    )
    const content = container.querySelector(
      '[data-testid="media-collection-carousel-content"]',
    )
    const items = container.querySelectorAll(
      '[data-testid="media-collection-carousel-item"]',
    )
    const endSpacer = container.querySelector(
      '[data-testid="media-collection-carousel-end-spacer"]',
    )

    expect(carousel?.getAttribute("role")).toBe("region")
    expect(carousel?.getAttribute("aria-label")).toBe("Related")
    expect(content?.getAttribute("class")).toContain("md:pl-16")
    expect(items).toHaveLength(1)
    expect(items[0]?.getAttribute("class")).toContain("max-w-[200px]")
    expect(endSpacer?.getAttribute("class")).toContain("basis-auto")
    expect(endSpacer?.firstElementChild?.getAttribute("class")).toContain(
      "xl:w-24",
    )
  })

  it("keeps non-carousel variants on the grid renderer", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({ mediaCollectionVariant: "grid" })}
          routeVideo={makeRouteVideo("the-gospel-of-john")}
        />,
      )
    })

    const section = container.querySelector(
      '[data-testid="media-collection-section"]',
    )
    expect(
      section?.querySelector('[data-testid="media-collection-carousel"]'),
    ).toBeNull()
    expect(section?.querySelector(".grid")?.getAttribute("class")).toContain(
      "md:grid-cols-3",
    )
  })

  it("lazy-loads a Mux animated preview for route video child cards", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData()}
          routeVideo={makeRouteVideo("the-gospel-of-john")}
        />,
      )
    })

    const preview = container.querySelector('[data-testid="mux-hover-preview"]')
    expect(preview).not.toBeNull()
    expect(preview?.getAttribute("data-active")).toBe("false")

    const card = container.querySelector('a[aria-label="VideoCard"]')
    act(() => {
      card?.dispatchEvent(new Event("pointerenter", { bubbles: false }))
    })

    const previewImage = Array.from(container.querySelectorAll("img")).find(
      (image) =>
        image.getAttribute("src")?.includes("/mux-route-child/animated.webp"),
    )
    expect(previewImage?.getAttribute("src")).toContain(
      "https://image.mux.com/mux-route-child/animated.webp?start=2&end=6&width=448&fps=8",
    )
  })

  it("lazy-loads a Mux animated preview for authored media collection items", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            itemsSource: "manual",
            items: [
              {
                videoId: "v-1",
                videoSlug: "the-gospel-of-luke",
                muxPlaybackId: "mux-authored-item",
                titleOverride: "The Gospel of Luke",
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageUrl: null,
              },
            ],
          })}
        />,
      )
    })

    const card = container.querySelector('a[aria-label="VideoCard"]')
    act(() => {
      card?.dispatchEvent(new Event("pointerenter", { bubbles: false }))
    })

    const previewImage = Array.from(container.querySelectorAll("img")).find(
      (image) =>
        image.getAttribute("src")?.includes("/mux-authored-item/animated.webp"),
    )
    expect(previewImage?.getAttribute("src")).toContain(
      "https://image.mux.com/mux-authored-item/animated.webp?start=2&end=6&width=448&fps=8",
    )
  })

  it("emits the canonical /watch/{slug}.html/{lang}.html path via the routes builder", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData()}
          routeVideo={makeRouteVideo("the-gospel-of-john")}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="VideoCard"]',
    )
    expect(link).not.toBeNull()
    expect(link?.getAttribute("href")).toBe(
      "/watch/the-gospel-of-john.html/english.html",
    )
  })

  it("renders a non-link <div> wrapper when the item has no videoSlug", () => {
    act(() => {
      root.render(
        <MediaCollection data={makeData()} routeVideo={makeRouteVideo("")} />,
      )
    })

    // Empty videoSlug → href is undefined → wrapper is a <div>, not an <a>.
    expect(container.querySelector('a[aria-label="VideoCard"]')).toBeNull()
    const card = container.querySelector('div[aria-label="VideoCard"]')
    expect(card).not.toBeNull()
    expect(card?.className).not.toContain("pointer-events-none")
  })

  it("links manual authored items when the admin payload includes a videoSlug", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            itemsSource: "manual",
            items: [
              {
                videoId: "v-1",
                videoSlug: "the-gospel-of-luke",
                titleOverride: "The Gospel of Luke",
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageUrl: null,
              },
            ],
          })}
        />,
      )
    })

    const link = container.querySelector<HTMLAnchorElement>(
      'a[aria-label="VideoCard"]',
    )
    expect(link?.getAttribute("href")).toBe(
      "/watch/the-gospel-of-luke.html/english.html",
    )
  })

  it("uses the watch videos index as the default CTA target", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            itemsSource: "manual",
            items: [
              {
                videoId: "v-1",
                videoSlug: "episode-one",
                titleOverride: "Episode One",
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageUrl: null,
              },
            ],
          })}
        />,
      )
    })

    expect(
      container.querySelector<HTMLAnchorElement>("a[href='/watch/videos']"),
    ).not.toBeNull()
  })

  it("renders both description and footer copy when both are authored", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            mediaDescription: "Intro copy",
            footerText: "Footer copy",
            itemsSource: "manual",
            items: [
              {
                videoId: "v-1",
                videoSlug: "episode-one",
                titleOverride: "Episode One",
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageUrl: null,
              },
            ],
          })}
        />,
      )
    })

    expect(container.textContent).toContain("Intro copy")
    expect(container.textContent).toContain("Footer copy")
  })

  it("uses the authored background color as the media collection tint", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            backgroundColor: "#123456",
            itemsSource: "manual",
            items: [
              {
                videoId: "v-1",
                videoSlug: "episode-one",
                titleOverride: "Episode One",
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageUrl: null,
              },
            ],
          })}
        />,
      )
    })

    const section = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-section"]',
    )
    expect(section?.style.backgroundColor).toBe("rgb(18, 52, 86)")
  })

  it("uses dominant color for the vertical card text scrim, not the whole card", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            mediaCollectionVariant: "collection",
            itemsSource: "manual",
            items: [
              {
                videoId: "v-1",
                videoSlug: "episode-one",
                titleOverride: "Episode One",
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageUrl: "https://example.com/poster.jpg",
                imageOverrideDominantColor: "#787e16",
              },
            ],
          })}
        />,
      )
    })

    const scrim = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-card-text-scrim"]',
    )
    expect(scrim?.style.background).toContain("rgb(114,120,21)")
    expect(scrim?.style.background).toContain("transparent 100%")
    expect(scrim?.className).toContain("h-[40%]")
    expect(scrim?.parentElement?.style.backgroundColor).toBe("")
  })

  it("uses dominant color for horizontal card text scrims too", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            mediaCollectionVariant: "grid",
            itemsSource: "manual",
            items: [
              {
                videoId: "v-1",
                videoSlug: "episode-one",
                titleOverride: "Episode One",
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageUrl: "https://example.com/still.jpg",
                videoImageDominantColor: "#123456",
              },
            ],
          })}
        />,
      )
    })

    const scrim = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-card-text-scrim"]',
    )
    expect(scrim?.style.background).toContain("rgb(18,52,86)")
  })

  it("renders the default artwork on a nested shared motion layer", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            mediaCollectionVariant: "grid",
            itemsSource: "manual",
            items: [makeManualItem()],
          })}
        />,
      )
    })

    const backdrop = container.querySelector(
      '[data-testid="media-collection-default-backdrop"]',
    )
    const motionLayer = container.querySelector(
      '[data-testid="media-collection-default-backdrop-motion"]',
    )
    const imageLayer = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-default-backdrop-image"]',
    )

    expect(backdrop?.className).not.toContain("animate-watch-backdrop-pan-zoom")
    expect(motionLayer?.className).toContain("animate-watch-backdrop-pan-zoom")
    expect(imageLayer?.getAttribute("style")).toContain("episode-one-blur.jpg")
    expect(imageLayer?.style.backgroundSize).toBe("200% 200%")
    expect(imageLayer?.style.backgroundPosition).toBe("center")
  })

  it("keeps crossfade and pan-zoom animations on separate layers during card changes", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            mediaCollectionVariant: "grid",
            itemsSource: "manual",
            items: [
              makeManualItem(),
              makeManualItem({
                videoId: "v-2",
                videoSlug: "episode-two",
                titleOverride: "Episode Two",
                imageUrl: "https://cdn.example/episode-two.jpg",
                imageBlurDataUrl: "https://cdn.example/episode-two-blur.jpg",
              }),
            ],
          })}
        />,
      )
    })

    const cards = container.querySelectorAll('[aria-label="VideoCard"]')
    act(() => {
      cards[0]?.dispatchEvent(new Event("pointerover", { bubbles: true }))
    })
    act(() => {
      cards[1]?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })

    const entering = container.querySelector(
      '[data-testid="media-collection-hover-backdrop"]',
    )
    const exiting = container.querySelector(
      '[data-testid="media-collection-hover-backdrop-previous"]',
    )
    const enteringMotion = container.querySelector(
      '[data-testid="media-collection-hover-backdrop-motion"]',
    )
    const enteringImage = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-hover-backdrop-image"]',
    )

    expect(entering?.className).toContain("watch-home-section-backdrop-enter")
    expect(entering?.className).not.toContain("animate-watch-backdrop-pan-zoom")
    expect(exiting?.className).toContain("watch-home-section-backdrop-exit")
    expect(enteringMotion?.className).toContain(
      "animate-watch-backdrop-pan-zoom",
    )
    expect(enteringImage?.getAttribute("style")).toContain(
      "episode-two-blur.jpg",
    )
  })

  it("does not render an animated backdrop when no item artwork resolves", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData()}
          routeVideo={makeRouteVideo("episode-one")}
        />,
      )
    })

    expect(
      container.querySelector(
        '[data-testid="media-collection-default-backdrop"]',
      ),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid$="-backdrop-motion"]'),
    ).toBeNull()
  })
})
