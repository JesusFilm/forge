/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { emblaApi, emblaHandlers, emblaState, useEmblaCarouselMock } =
  vi.hoisted(() => {
    const handlers: Record<string, Set<() => void>> = {
      reInit: new Set(),
      select: new Set(),
    }
    const state = { selectedSnap: 0, snapCount: 3 }
    const api = {
      canScrollNext: vi.fn(() => true),
      canScrollPrev: vi.fn(() => false),
      off: vi.fn((event: string, handler: () => void) => {
        handlers[event]?.delete(handler)
        return api
      }),
      on: vi.fn((event: string, handler: () => void) => {
        handlers[event]?.add(handler)
        return api
      }),
      scrollNext: vi.fn(),
      scrollPrev: vi.fn(),
      scrollTo: vi.fn((snap: number) => {
        state.selectedSnap = snap
      }),
      scrollSnapList: vi.fn(() =>
        Array.from({ length: state.snapCount }, (_, index) => index),
      ),
      selectedScrollSnap: vi.fn(() => state.selectedSnap),
    }
    return {
      emblaApi: api,
      emblaHandlers: handlers,
      emblaState: state,
      useEmblaCarouselMock: vi.fn((_options?: Record<string, unknown>) => [
        vi.fn(),
        api,
      ]),
    }
  })

vi.mock("embla-carousel-react", () => ({
  default: useEmblaCarouselMock,
}))

import type { RouteVideo } from "@/lib/content"
import type { EnrichedMediaItem } from "@/lib/enrichment"

import { MediaCollection } from "./MediaCollection"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))
  emblaState.selectedSnap = 0
  emblaState.snapCount = 3
  emblaHandlers.reInit.clear()
  emblaHandlers.select.clear()
  emblaApi.canScrollNext.mockReturnValue(true)
  emblaApi.canScrollPrev.mockReturnValue(false)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
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

function makeManualItem(overrides: Record<string, unknown> = {}) {
  return {
    videoId: "v-1",
    videoSlug: "episode-one",
    titleOverride: "Episode One",
    subtitleOverride: null,
    labelOverride: null,
    collectionSize: null,
    imageAsset: null,
    ...overrides,
  }
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
      languageSlug: null,
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

function expectSolidWhiteInteractionFrame(outline: HTMLElement | null) {
  const outlineClasses = outline?.className ?? ""

  expect(outline).not.toBeNull()
  expect(outlineClasses).toContain("inset-0")
  expect(outlineClasses).toContain("z-[80]")
  expect(outlineClasses).toContain("rounded-[inherit]")
  expect(outlineClasses).toContain("border-4")
  expect(outlineClasses).toContain("border-white")
  expect(outlineClasses).toContain("group-hover:opacity-100")
  expect(outlineClasses).toContain("group-focus-visible:opacity-100")
  expect(outlineClasses).not.toContain("watch-home-gradient-outline")
  expect(outlineClasses).not.toContain("brand-red")
  expect(outlineClasses).not.toContain("rgba(239,68,68")
  expect(outlineClasses).not.toContain("portrait")
  expect(outlineClasses).not.toContain("landscape")
}

describe("MediaCollection VideoCard href", () => {
  it("keeps authored carousel callers on the existing default snap behavior", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            itemsSource: "manual",
            items: [makeManualItem()],
          })}
        />,
      )
    })

    expect(useEmblaCarouselMock.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "startIndex",
    )
    expect(emblaApi.scrollTo).not.toHaveBeenCalled()
  })

  it("restores, reports, and clamps an optional selected carousel snap", () => {
    const onSelectedSnapChange = vi.fn()
    act(() => {
      root.render(
        <MediaCollection
          initialSelectedSnap={8}
          onSelectedSnapChange={onSelectedSnapChange}
          data={makeData({
            itemsSource: "manual",
            items: [
              makeManualItem(),
              makeManualItem({ videoId: "v-2", videoSlug: "episode-two" }),
              makeManualItem({ videoId: "v-3", videoSlug: "episode-three" }),
            ],
          })}
        />,
      )
    })

    expect(useEmblaCarouselMock.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ startIndex: 8 }),
    )
    expect(emblaApi.scrollTo).toHaveBeenCalledWith(2, true)
    expect(onSelectedSnapChange).toHaveBeenLastCalledWith(2)

    emblaState.selectedSnap = 1
    act(() => {
      for (const handler of emblaHandlers.select) handler()
    })
    expect(onSelectedSnapChange).toHaveBeenLastCalledWith(1)

    emblaState.snapCount = 2
    emblaState.selectedSnap = 1
    emblaApi.scrollTo.mockClear()
    act(() => {
      for (const handler of emblaHandlers.reInit) handler()
    })
    expect(emblaApi.scrollTo).not.toHaveBeenCalled()
    expect(onSelectedSnapChange).toHaveBeenLastCalledWith(1)

    act(() => root.unmount())
    expect(emblaApi.off).toHaveBeenCalledWith("reInit", expect.any(Function))
    expect(emblaApi.off).toHaveBeenCalledWith("select", expect.any(Function))
  })

  it("uses shared typography tokens for card copy and section eyebrows", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            categoryLabel: "Video Bible Collection",
            itemsSource: "manual",
            items: [
              makeManualItem({
                labelOverride: "FeatureFilm",
                resolvedTitle: "Life of Jesus (Gospel of John)",
                titleOverride: null,
              }),
            ],
          })}
        />,
      )
    })

    const card = container.querySelector('[data-testid="VideoCard"]')
    const title = card?.querySelector("h3")
    const label = title?.previousElementSibling
    const eyebrow = Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent === "Video Bible Collection",
    )

    expect(label?.className).toContain("tracking-media-label")
    expect(label?.className).not.toContain("tracking-wider")
    expect(title?.className).toContain("font-media-card-title")
    expect(title?.className).not.toContain("font-bold")
    expect(eyebrow?.className).toContain("tracking-eyebrow")
    expect(eyebrow?.className).not.toContain("tracking-wider")
  })

  it("links manual items with the resolved video dub language", () => {
    act(() => {
      root.render(
        <MediaCollection
          languageSlug="spanish-castilian"
          data={makeData({
            itemsSource: "manual",
            items: [
              makeManualItem({
                videoSlug: "jesus",
                videoDub: {
                  language: {
                    slug: "spanish-castilian",
                  },
                },
              }),
            ],
          })}
        />,
      )
    })

    expect(
      container.querySelector<HTMLAnchorElement>(
        "a[href='/watch/jesus.html/spanish-castilian.html']",
      ),
    ).not.toBeNull()
    expect(
      container.querySelector<HTMLAnchorElement>(
        "a[href='/watch/jesus.html/english.html']",
      ),
    ).toBeNull()
  })

  it("falls manual item links back to the current page language", () => {
    act(() => {
      root.render(
        <MediaCollection
          languageSlug="spanish-castilian"
          data={makeData({
            itemsSource: "manual",
            items: [
              makeManualItem({
                videoSlug: "jesus",
                videoDub: null,
              }),
            ],
          })}
        />,
      )
    })

    expect(
      container.querySelector<HTMLAnchorElement>(
        "a[href='/watch/jesus.html/spanish-castilian.html']",
      ),
    ).not.toBeNull()
  })

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
    expect(
      items[0]
        ?.querySelector('[data-testid="VideoCard"] > div')
        ?.getAttribute("class"),
    ).toContain("min-h-[13rem]")
    expect(endSpacer?.getAttribute("class")).toContain("basis-auto")
    expect(endSpacer?.firstElementChild?.getAttribute("class")).toContain(
      "xl:w-24",
    )
  })

  it.each([
    {
      variant: "grid",
      expectedSlideWidth: "auto-cols-[72%]",
      expectedCardAspect: "aspect-video",
    },
    {
      variant: "collection",
      expectedSlideWidth: "auto-cols-[46%]",
      expectedCardAspect: "aspect-[2/3]",
      expectedDesktopColumns: "md:grid-cols-4",
    },
    {
      variant: "hero",
      expectedSlideWidth: "auto-cols-[72%]",
      expectedCardAspect: "aspect-video",
      expectedDesktopColumns: "md:grid-cols-2",
      expectedDesktopGap: "md:gap-5",
    },
    {
      variant: "player",
      expectedSlideWidth: "auto-cols-[72%]",
      expectedCardAspect: "aspect-video",
      expectedDesktopColumns: "md:grid-cols-2",
      expectedDesktopGap: "md:gap-5",
    },
  ])(
    "renders multi-item $variant variants as a mobile carousel and desktop grid",
    ({
      variant,
      expectedSlideWidth,
      expectedCardAspect,
      expectedDesktopColumns = "md:grid-cols-3",
      expectedDesktopGap = expectedCardAspect === "aspect-[2/3]"
        ? "md:gap-4"
        : "md:gap-5",
    }) => {
      act(() => {
        root.render(
          <MediaCollection
            data={makeData({
              mediaCollectionVariant: variant,
              itemsSource: "manual",
              items: [
                makeManualItem(),
                makeManualItem({
                  videoId: "v-2",
                  videoSlug: "episode-two",
                  titleOverride: "Episode Two",
                }),
              ],
            })}
          />,
        )
      })

      const mobileCarousel = container.querySelector(
        '[data-testid="media-collection-mobile-carousel"]',
      )
      const mobileItems = mobileCarousel?.querySelectorAll(
        '[data-testid="VideoCard"]',
      )
      const firstMobileCardFrame =
        mobileItems?.[0]?.querySelector(":scope > div")
      const grid = container.querySelector(
        '[data-testid="media-collection-grid"]',
      )

      expect(mobileCarousel?.getAttribute("role")).toBe("region")
      expect(mobileCarousel?.getAttribute("tabindex")).toBeNull()
      expect(mobileCarousel?.getAttribute("class")).toContain("overflow-x-auto")
      expect(mobileCarousel?.getAttribute("class")).toContain("snap-mandatory")
      // Snap inset must mirror the grid's px-5: without scroll-pl-5 the
      // mandatory snap fires on load and pulls the first card flush with the
      // viewport edge instead of the content column.
      expect(mobileCarousel?.getAttribute("class")).toContain("scroll-pl-5")
      expect(mobileCarousel?.getAttribute("class")).toContain(
        "md:overflow-visible",
      )
      expect(mobileItems).toHaveLength(2)
      expect(grid?.getAttribute("class")).toContain(expectedSlideWidth)
      expect(firstMobileCardFrame?.getAttribute("class")).toContain(
        expectedCardAspect,
      )
      expect(firstMobileCardFrame?.getAttribute("class")).toContain("min-h-0")
      expect(grid?.getAttribute("class")).toContain("px-5")
      expect(grid?.getAttribute("class")).toContain("md:grid-flow-row")
      expect(grid?.getAttribute("class")).toContain(expectedDesktopColumns)
      expect(grid?.getAttribute("class")).toContain(expectedDesktopGap)
      expect(grid?.getAttribute("class")).not.toContain("snap-mandatory")
    },
  )

  it("compacts mobile carousel thumbnail overlays without changing desktop sizing", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            mediaCollectionVariant: "grid",
            itemsSource: "manual",
            showItemNumbers: true,
            items: [
              makeManualItem({
                labelOverride: "Episode",
                resolvedTitle: "Episode One",
                imageAsset: {
                  previewUrl: "https://example.com/episode-one.jpg",
                },
              }),
              makeManualItem({
                videoId: "v-2",
                videoSlug: "episode-two",
                titleOverride: "Episode Two",
                labelOverride: "Episode",
                resolvedTitle: "Episode Two",
                imageAsset: {
                  previewUrl: "https://example.com/episode-two.jpg",
                },
              }),
            ],
          })}
        />,
      )
    })

    const firstCard = container.querySelector('[data-testid="VideoCard"]')
    const frame = firstCard?.querySelector(":scope > div")
    const title = firstCard?.querySelector("h3")
    const label = title?.previousElementSibling
    const copy = title?.parentElement
    const itemNumber = firstCard?.querySelector("span")
    const image = firstCard?.querySelector("img")

    expect(frame?.getAttribute("class")).toContain("min-h-0")
    expect(frame?.getAttribute("class")).toContain("md:min-h-[10rem]")
    expect(copy?.getAttribute("class")).toContain("px-2.5")
    expect(copy?.getAttribute("class")).toContain("md:px-4")
    // Phone tier floors card labels at 12px (`text-xs`) and lifts card titles
    // to 16px (`text-base`); every larger tier is unchanged. The negative pins
    // are the ones that go red if a sub-12px size comes back.
    expect(label?.getAttribute("class")).toContain("text-xs")
    expect(label?.getAttribute("class")).not.toContain("text-[10px]")
    expect(title?.getAttribute("class")).toContain("text-base")
    expect(title?.getAttribute("class")).not.toContain("text-sm")
    expect(title?.getAttribute("class")).toContain("md:text-xl")
    expect(itemNumber?.getAttribute("class")).toContain("text-3xl")
    expect(itemNumber?.getAttribute("class")).toContain("md:text-5xl")
    expect(image?.getAttribute("sizes")).toContain("72vw")
  })

  it("keeps a single non-carousel item full width on mobile", () => {
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
      section?.querySelector(
        '[data-testid="media-collection-mobile-carousel"]',
      ),
    ).toBeNull()
    const gridClasses =
      section
        ?.querySelector('[data-testid="media-collection-grid"]')
        ?.getAttribute("class") ?? ""
    expect(gridClasses).toContain("grid-cols-1")
    expect(gridClasses).not.toContain("hidden")
  })

  it("keeps a single portrait collection on its existing static grid", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({ mediaCollectionVariant: "collection" })}
          routeVideo={makeRouteVideo("the-gospel-of-john")}
        />,
      )
    })

    const section = container.querySelector(
      '[data-testid="media-collection-section"]',
    )
    expect(
      section?.querySelector(
        '[data-testid="media-collection-mobile-carousel"]',
      ),
    ).toBeNull()
    const gridClasses =
      section
        ?.querySelector('[data-testid="media-collection-grid"]')
        ?.getAttribute("class") ?? ""
    expect(gridClasses).toContain("grid-cols-2")
    expect(gridClasses).toContain("md:grid-cols-4")
  })

  it("makes a mobile rail keyboard-scrollable when it contains non-link cards", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            mediaCollectionVariant: "grid",
            itemsSource: "manual",
            items: [
              makeManualItem({ videoSlug: null }),
              makeManualItem({
                videoId: "v-2",
                videoSlug: null,
                titleOverride: "Unlinked Episode",
              }),
            ],
          })}
        />,
      )
    })

    const mobileCarousel = container.querySelector(
      '[data-testid="media-collection-mobile-carousel"]',
    )
    expect(mobileCarousel?.getAttribute("tabindex")).toBe("0")
    expect(mobileCarousel?.getAttribute("class")).toContain(
      "focus-visible:ring-2",
    )
    expect(mobileCarousel?.getAttribute("class")).not.toContain(
      "md:focus-visible:ring-0",
    )
  })

  it("renders an authored horizontal carousel without changing its layout variant", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({ thumbnailOrientation: "horizontal" })}
          routeVideo={makeRouteVideo("the-gospel-of-john")}
        />,
      )
    })

    const carouselItem = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-carousel-item"]',
    )
    const cardImage = container.querySelector<HTMLElement>(
      '[data-testid="VideoCard"] > div',
    )

    expect(carouselItem?.className).toContain("max-w-[360px]")
    expect(carouselItem?.className).not.toContain("max-w-[200px]")
    expect(cardImage?.className).toContain("aspect-video")
    expect(cardImage?.className).not.toContain("aspect-[2/3]")
  })

  it("renders an authored vertical grid without changing its layout variant", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            mediaCollectionVariant: "grid",
            thumbnailOrientation: "vertical",
          })}
          routeVideo={makeRouteVideo("the-gospel-of-john")}
        />,
      )
    })

    const grid = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-grid"]',
    )
    const cardImage = container.querySelector<HTMLElement>(
      '[data-testid="VideoCard"] > div',
    )

    expect(grid?.className).toContain("grid-cols-2")
    expect(grid?.className).toContain("md:grid-cols-4")
    expect(cardImage?.className).toContain("aspect-[2/3]")
    expect(cardImage?.className).not.toContain("aspect-video")
  })

  it.each([
    ["collection", ["text-xl"], ["text-lg", "md:text-xl"]],
    ["grid", ["text-lg", "md:text-xl"], ["text-xl"]],
  ] as const)(
    "keeps the %s card title and caption sizing contracts",
    (mediaCollectionVariant, expectedTitleClasses, excludedTitleClasses) => {
      act(() => {
        root.render(
          <MediaCollection
            data={makeData({ mediaCollectionVariant })}
            routeVideo={makeRouteVideo("the-gospel-of-john")}
          />,
        )
      })

      const caption = container.querySelector<HTMLElement>(
        '[data-slot="video-thumbnail-caption"]',
      )
      const title = container.querySelector<HTMLElement>(
        '[data-slot="video-thumbnail-title"]',
      )
      const captionClasses = caption?.className.split(/\s+/) ?? []
      const titleClasses = title?.className.split(/\s+/) ?? []

      expect(captionClasses).toContain("px-4")
      expect(captionClasses).toContain("pb-4")
      for (const className of expectedTitleClasses) {
        expect(titleClasses).toContain(className)
      }
      for (const className of excludedTitleClasses) {
        expect(titleClasses).not.toContain(className)
      }
    },
  )

  it("uses one solid white hover and focus frame on horizontal cards", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            mediaCollectionVariant: "grid",
            showItemNumbers: true,
          })}
          routeVideo={makeRouteVideo("the-gospel-of-john")}
        />,
      )
    })

    const card = container.querySelector<HTMLElement>(
      '[data-testid="VideoCard"]',
    )
    const outline = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-card-hover-outline"]',
    )

    expect(card?.textContent).toContain("1")
    expect(card?.className).toContain("focus-visible:outline-none")
    expect(card?.className).not.toContain("focus-visible:outline-2")
    expect(card?.className).not.toContain("focus-visible:outline-offset-2")
    expect(card?.className).not.toContain("focus-visible:outline-white/80")
    expectSolidWhiteInteractionFrame(outline)
  })

  it("uses the same solid white frame on vertical cards", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({ mediaCollectionVariant: "collection" })}
          routeVideo={makeRouteVideo("the-gospel-of-john")}
        />,
      )
    })

    const outline = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-card-hover-outline"]',
    )

    expectSolidWhiteInteractionFrame(outline)
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

    const card = container.querySelector('a[data-testid="VideoCard"]')
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
                videoDub: {
                  muxVideo: {
                    playbackId: "mux-authored-item",
                  },
                },
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

    const card = container.querySelector('a[data-testid="VideoCard"]')
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
      'a[data-testid="VideoCard"]',
    )
    expect(link).not.toBeNull()
    expect(link?.getAttribute("href")).toBe("/watch/the-gospel-of-john.html")
  })

  it("renders a non-link <div> wrapper when the item has no videoSlug", () => {
    act(() => {
      root.render(
        <MediaCollection data={makeData()} routeVideo={makeRouteVideo("")} />,
      )
    })

    // Empty videoSlug → href is undefined → wrapper is a <div>, not an <a>.
    expect(container.querySelector('a[data-testid="VideoCard"]')).toBeNull()
    const card = container.querySelector('div[data-testid="VideoCard"]')
    expect(card).not.toBeNull()
    expect(card?.className).not.toContain("pointer-events-none")
    expect(card?.className).not.toContain("group")
    expect(card?.className).not.toContain("focus-visible:outline-none")
    expect(card?.className).not.toContain("hover:shadow")
    expect(
      card?.querySelector(
        '[data-testid="media-collection-card-hover-outline"]',
      ),
    ).toBeNull()
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
      'a[data-testid="VideoCard"]',
    )
    expect(link?.getAttribute("href")).toBe("/watch/the-gospel-of-luke.html")
  })

  it("renders the Admin-resolved linked video title", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            itemsSource: "manual",
            mediaCollectionVariant: "grid",
            items: [
              {
                videoId: "v-1",
                videoSlug: "fresh-perspective",
                resolvedTitle: "  NUA: Fresh Perspective  ",
                titleOverride: null,
                subtitleOverride: null,
                labelOverride: "Series",
                collectionSize: null,
                imageUrl: null,
              },
            ],
          })}
        />,
      )
    })

    const card = container.querySelector<HTMLElement>(
      'a[data-testid="VideoCard"]',
    )
    expect(card?.querySelector("h3")?.textContent).toBe(
      "NUA: Fresh Perspective",
    )
    expect(card?.getAttribute("aria-label")).toBe("Show NUA: Fresh Perspective")
  })

  it("leaves null and blank linked titles visually empty without an Untitled fallback", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            itemsSource: "manual",
            mediaCollectionVariant: "grid",
            items: [
              {
                videoId: "v-null",
                videoSlug: "titleless-null",
                resolvedTitle: null,
                titleOverride: null,
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageAsset: {
                  previewUrl:
                    "/watch/images/thumbnails/GOMattCollection-vertical.png",
                },
              },
              {
                videoId: "v-blank",
                videoSlug: "titleless-blank",
                resolvedTitle: "   ",
                titleOverride: null,
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageAsset: {
                  previewUrl:
                    "/watch/images/thumbnails/GOMarkCollection-vertical.png",
                },
              },
            ],
          })}
        />,
      )
    })

    const cards = Array.from(
      container.querySelectorAll<HTMLElement>('a[data-testid="VideoCard"]'),
    )
    expect(cards).toHaveLength(2)
    expect(cards.every((card) => card.querySelector("h3") == null)).toBe(true)
    expect(
      cards.map((card) => card.querySelector("img")?.getAttribute("alt")),
    ).toEqual(["", ""])
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Show titleless-null",
      "Show titleless-blank",
    ])
    expect(cards.every((card) => card.textContent === "")).toBe(true)
    expect(container.textContent).not.toContain("Untitled")
    expect(container.textContent).not.toContain("titleless-null")
    expect(container.textContent).not.toContain("titleless-blank")
  })

  it("distinguishes titleless linked cards that share the same visible label", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            itemsSource: "manual",
            mediaCollectionVariant: "grid",
            items: [
              {
                videoId: "v-one",
                videoSlug: "titleless-one",
                resolvedTitle: null,
                titleOverride: null,
                subtitleOverride: null,
                labelOverride: "Episode",
                collectionSize: null,
                imageUrl: null,
              },
              {
                videoId: "v-two",
                videoSlug: "titleless-two",
                resolvedTitle: null,
                titleOverride: null,
                subtitleOverride: null,
                labelOverride: "Episode",
                collectionSize: null,
                imageUrl: null,
              },
            ],
          })}
        />,
      )
    })

    const cards = Array.from(
      container.querySelectorAll<HTMLElement>('a[data-testid="VideoCard"]'),
    )
    expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
      "Show Episode titleless-one",
      "Show Episode titleless-two",
    ])
    expect(cards.map((card) => card.textContent)).toEqual([
      "Episode",
      "Episode",
    ])
    expect(container.textContent).not.toContain("Untitled")
    expect(container.textContent).not.toContain("titleless-one")
    expect(container.textContent).not.toContain("titleless-two")
  })

  it("uses a shared parent collection as the localized default CTA target", () => {
    act(() => {
      root.render(
        <MediaCollection
          languageSlug="spanish-castilian"
          data={makeData({
            itemsSource: "manual",
            mediaDefaultCollectionSlug: "lumo",
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
      container.querySelector<HTMLAnchorElement>(
        "a[href='/watch/lumo.html/spanish-castilian.html']",
      ),
    ).not.toBeNull()
  })

  it("keeps the watch languages index fallback for mixed or unlinked items", () => {
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
      container.querySelector<HTMLAnchorElement>("a[href='/watch/languages']"),
    ).not.toBeNull()
  })

  it("prefers an explicitly authored CTA destination", () => {
    act(() => {
      root.render(
        <MediaCollection
          languageSlug="spanish-castilian"
          data={makeData({
            itemsSource: "manual",
            mediaCtaLink: "/watch/featured",
            mediaDefaultCollectionSlug: "lumo",
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
      container.querySelector<HTMLAnchorElement>("a[href='/watch/featured']"),
    ).not.toBeNull()
  })

  it.each([
    {
      authored:
        "/watch/creation-to-christ.html/1-the-most-high-god-and-his-creation/english.html",
      expected: "/watch/1-the-most-high-god-and-his-creation.html",
    },
    {
      authored: "/watch/lumo-the-gospel-of-john.html/lumo-john-1-1-34.html",
      expected: "/watch/lumo-john-1-1-34.html",
    },
    {
      authored:
        "/watch/lumo-the-gospel-of-john.html/lumo-john-1-1-34/romanian.html",
      expected: "/watch/lumo-john-1-1-34.html/romanian.html",
    },
  ])(
    "normalizes the authored discovery CTA $authored to $expected",
    ({ authored, expected }) => {
      act(() => {
        root.render(
          <MediaCollection
            data={makeData({
              itemsSource: "manual",
              mediaCtaLink: authored,
              items: [makeManualItem()],
            })}
          />,
        )
      })

      expect(
        container
          .querySelector<HTMLAnchorElement>(
            "[data-testid='media-collection-cta']",
          )
          ?.getAttribute("href"),
      ).toBe(expected)
    },
  )

  it("normalizes an authored root CTA to the watch base path", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            itemsSource: "manual",
            mediaCtaLink: "/",
            items: [makeManualItem()],
          })}
        />,
      )
    })

    expect(
      container
        .querySelector<HTMLAnchorElement>(
          "[data-testid='media-collection-cta']",
        )
        ?.getAttribute("href"),
    ).toBe("/watch")
  })

  it("uses the current localized collection for route video children", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData()}
          languageSlug="french"
          routeVideo={makeRouteVideo("episode-one")}
        />,
      )
    })

    expect(
      container.querySelector<HTMLAnchorElement>(
        "a[href='/watch/series.html/french.html']",
      ),
    ).not.toBeNull()
  })

  it("renders distinct authored header copy before the carousel and footer copy after it", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            categoryLabel: "New series",
            subtitle: "Short supporting title",
            mediaDescription: "Intro copy",
            footerText: "Footer copy",
            itemsSource: "manual",
            items: [makeManualItem()],
          })}
        />,
      )
    })

    const categoryLabel = Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent === "New series",
    )
    const title = container.querySelector("h2")
    const titleRow = container.querySelector(
      '[data-testid="media-collection-title-row"]',
    )
    const cta = container.querySelector('[data-testid="media-collection-cta"]')
    const supportingTitle = container.querySelector(
      '[data-testid="media-collection-supporting-title"]',
    )
    const description = container.querySelector(
      '[data-testid="media-collection-description"]',
    )
    const carousel = container.querySelector(
      '[data-testid="media-collection-carousel"]',
    )
    const footer = container.querySelector(
      '[data-testid="media-collection-footer"]',
    )

    expect(categoryLabel?.textContent).toBe("New series")
    // Section eyebrow rides the phone tier: 14px on phones, the authored 12px
    // restored from `sm:` up so every larger tier is unchanged.
    expect(categoryLabel?.classList).toContain("text-sm")
    expect(categoryLabel?.classList).toContain("sm:text-xs")
    expect(categoryLabel?.classList).toContain("tracking-eyebrow")
    expect(categoryLabel?.classList).toContain("text-red-100/60")
    expect(categoryLabel?.parentElement).toBe(titleRow)
    expect(title?.parentElement).toBe(titleRow)
    expect(cta?.parentElement).toBe(titleRow)
    expect(categoryLabel?.nextElementSibling).toBe(title)
    expect(title?.nextElementSibling).toBe(cta)
    expect(supportingTitle).not.toBeNull()
    expect(supportingTitle?.classList).toContain("pt-1")
    expect(description).not.toBeNull()
    expect(supportingTitle?.parentElement).not.toBe(titleRow)
    expect(description?.parentElement).not.toBe(titleRow)
    expect(carousel).not.toBeNull()
    expect(footer).not.toBeNull()
    // Footer copy rides the phone tier: 14px on phones, authored 12px from `sm:` up.
    expect(footer?.classList).toContain("text-sm")
    expect(footer?.classList).toContain("sm:text-xs")
    expect(footer?.classList).toContain("xl:text-sm")
    expect(supportingTitle?.textContent).toBe("Short supporting title")
    expect(description?.textContent).toBe("Intro copy")
    expect(footer?.textContent).toBe("Footer copy")
    expect(supportingTitle?.compareDocumentPosition(carousel!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(description?.compareDocumentPosition(carousel!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(carousel?.compareDocumentPosition(footer!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it("keeps supporting copy outside the title and CTA row without an eyebrow", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            categoryLabel: null,
            subtitle: "Supporting title",
            mediaDescription: "Collection description",
            itemsSource: "manual",
            items: [makeManualItem()],
          })}
        />,
      )
    })

    const titleRow = container.querySelector(
      '[data-testid="media-collection-title-row"]',
    )
    const title = container.querySelector("h2")
    const cta = container.querySelector('[data-testid="media-collection-cta"]')
    const supportingTitle = container.querySelector(
      '[data-testid="media-collection-supporting-title"]',
    )
    const description = container.querySelector(
      '[data-testid="media-collection-description"]',
    )

    expect(title?.parentElement).toBe(titleRow)
    expect(cta?.parentElement).toBe(titleRow)
    expect(title?.nextElementSibling).toBe(cta)
    expect(supportingTitle?.parentElement).not.toBe(titleRow)
    expect(description?.parentElement).not.toBe(titleRow)
  })

  it("keeps the CTA after supporting copy when the collection has no title", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            title: null,
            categoryLabel: "Featured",
            subtitle: "Supporting title",
            mediaDescription: "Collection description",
            itemsSource: "manual",
            items: [makeManualItem()],
          })}
        />,
      )
    })

    const supportingTitle = container.querySelector(
      '[data-testid="media-collection-supporting-title"]',
    )
    const description = container.querySelector(
      '[data-testid="media-collection-description"]',
    )
    const cta = container.querySelector('[data-testid="media-collection-cta"]')
    const titlelessLayout = container.querySelector(
      '[data-testid="media-collection-titleless-layout"]',
    )
    const supportingCopy = container.querySelector(
      '[data-testid="media-collection-titleless-supporting-copy"]',
    )
    const categoryLabel = Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent === "Featured",
    )

    expect(
      container.querySelector('[data-testid="media-collection-title-row"]'),
    ).toBeNull()
    expect(supportingTitle).not.toBeNull()
    expect(description).not.toBeNull()
    expect(cta).not.toBeNull()
    expect(categoryLabel?.nextElementSibling).toBe(titlelessLayout)
    expect(categoryLabel?.compareDocumentPosition(supportingTitle!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(supportingTitle?.compareDocumentPosition(description!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(supportingTitle?.compareDocumentPosition(cta!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(description?.compareDocumentPosition(cta!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(supportingCopy?.parentElement).toBe(titlelessLayout)
    expect(supportingTitle?.parentElement).toBe(supportingCopy)
    expect(description?.parentElement).toBe(supportingCopy)
    expect(cta?.parentElement).toBe(titlelessLayout)
    expect(supportingCopy?.nextElementSibling).toBe(cta)
  })

  it("keeps authored supporting copy before the grid branch", () => {
    act(() => {
      root.render(
        <MediaCollection
          data={makeData({
            categoryLabel: "Featured",
            subtitle: "Supporting grid title",
            mediaDescription: "Grid description",
            mediaCollectionVariant: "grid",
            itemsSource: "manual",
            items: [makeManualItem()],
          })}
        />,
      )
    })

    const supportingTitle = container.querySelector(
      '[data-testid="media-collection-supporting-title"]',
    )
    const description = container.querySelector(
      '[data-testid="media-collection-description"]',
    )
    const firstCard = container.querySelector('[data-testid="VideoCard"]')

    expect(supportingTitle).not.toBeNull()
    expect(description).not.toBeNull()
    expect(firstCard).not.toBeNull()
    expect(supportingTitle?.textContent).toBe("Supporting grid title")
    expect(description?.textContent).toBe("Grid description")
    expect(supportingTitle?.compareDocumentPosition(firstCard!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(description?.compareDocumentPosition(firstCard!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it.each([
    {
      name: "category only",
      categoryLabel: "Featured",
      subtitle: null,
      description: null,
      footerText: null,
    },
    {
      name: "subtitle only",
      categoryLabel: null,
      subtitle: "Supporting title",
      description: null,
      footerText: null,
    },
    {
      name: "category and subtitle",
      categoryLabel: "Featured",
      subtitle: "Supporting title",
      description: null,
      footerText: null,
    },
    {
      name: "description without subtitle",
      categoryLabel: null,
      subtitle: null,
      description: "Collection description",
      footerText: null,
    },
    {
      name: "footer only",
      categoryLabel: null,
      subtitle: null,
      description: null,
      footerText: "Closing copy",
    },
    {
      name: "empty optional fields",
      categoryLabel: "",
      subtitle: "",
      description: "",
      footerText: "",
    },
  ])(
    "renders optional authored fields without empty wrappers: $name",
    (state) => {
      act(() => {
        root.render(
          <MediaCollection
            data={makeData({
              categoryLabel: state.categoryLabel,
              subtitle: state.subtitle,
              mediaDescription: state.description,
              footerText: state.footerText,
              itemsSource: "manual",
              items: [makeManualItem()],
            })}
          />,
        )
      })

      expect(
        container.querySelector(
          '[data-testid="media-collection-supporting-title"]',
        )?.textContent ?? null,
      ).toBe(state.subtitle || null)
      expect(
        container.querySelector('[data-testid="media-collection-description"]')
          ?.textContent ?? null,
      ).toBe(state.description || null)
      expect(
        container.querySelector('[data-testid="media-collection-footer"]')
          ?.textContent ?? null,
      ).toBe(state.footerText || null)
    },
  )

  it("uses a dark warm-neutral background instead of the authored color", () => {
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
    const tint = container.querySelector<HTMLElement>(
      '[data-testid="media-collection-tint"]',
    )
    expect(section?.style.backgroundColor).toBe("rgb(26, 24, 21)")
    expect(tint?.style.background).toContain("rgba(26, 24, 21, 0.92)")
    expect(tint?.style.background).not.toContain("rgb(18, 52, 86)")
    expect(section?.className).toContain("py-10")
    expect(section?.className).toContain("md:py-16")
  })

  it.each(["carousel", "grid"])(
    "restrains the decorative %s background without desaturating cards",
    (mediaCollectionVariant) => {
      act(() => {
        root.render(
          <MediaCollection
            data={makeData({
              mediaCollectionVariant,
              itemsSource: "manual",
              items: [
                makeManualItem({
                  imageAsset: {
                    previewUrl: "https://example.com/episode-one.jpg",
                  },
                }),
              ],
            })}
          />,
        )
      })

      const defaultBackdrop = container.querySelector<HTMLElement>(
        '[data-testid="media-collection-default-backdrop"]',
      )
      const tint = container.querySelector<HTMLElement>(
        '[data-testid="media-collection-tint"]',
      )
      const card = container.querySelector<HTMLElement>(
        '[data-testid="VideoCard"]',
      )

      expect(defaultBackdrop?.className).toContain("saturate-75")
      expect(defaultBackdrop?.className).toContain("brightness-50")
      expect(defaultBackdrop?.className).not.toMatch(/saturate-(110|125)/)
      expect(tint?.className).toContain("saturate-75")
      expect(tint?.className).toContain("brightness-50")
      expect(card?.className).not.toContain("saturate-75")
      expect(card?.className).not.toContain("brightness-50")

      act(() => {
        card?.focus()
      })

      const hoverBackdrop = container.querySelector<HTMLElement>(
        '[data-testid="media-collection-hover-backdrop"]',
      )
      expect(hoverBackdrop?.className).toContain("saturate-75")
      expect(hoverBackdrop?.className).toContain("brightness-50")
      expect(hoverBackdrop?.className).not.toMatch(/saturate-(110|125)/)
    },
  )

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
                imageAsset: {
                  previewUrl: "https://example.com/poster.jpg",
                  dominantColor: "#787e16",
                },
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
                imageAsset: {
                  previewUrl: "https://example.com/still.jpg",
                  dominantColor: "#123456",
                },
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
})
