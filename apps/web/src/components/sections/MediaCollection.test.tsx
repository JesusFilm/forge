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

function makeManualItem(overrides: Record<string, unknown> = {}) {
  return {
    videoId: "v-1",
    videoSlug: "episode-one",
    titleOverride: "Episode One",
    subtitleOverride: null,
    labelOverride: null,
    collectionSize: null,
    imageUrl: null,
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
    expect(
      section
        ?.querySelector('[data-testid="media-collection-grid"]')
        ?.getAttribute("class"),
    ).toContain("md:grid-cols-3")
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
    expect(link?.getAttribute("href")).toBe(
      "/watch/the-gospel-of-luke.html/english.html",
    )
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
                imageUrl:
                  "/watch/images/thumbnails/GOMattCollection-vertical.png",
              },
              {
                videoId: "v-blank",
                videoSlug: "titleless-blank",
                resolvedTitle: "   ",
                titleOverride: null,
                subtitleOverride: null,
                labelOverride: null,
                collectionSize: null,
                imageUrl:
                  "/watch/images/thumbnails/GOMarkCollection-vertical.png",
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
    expect(categoryLabel?.classList).toContain("text-xs")
    expect(categoryLabel?.classList).toContain("tracking-widest")
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
    expect(footer?.classList).toContain("text-xs")
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
                imageDominantColor: "#787e16",
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
                imageDominantColor: "#123456",
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
