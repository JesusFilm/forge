// @vitest-environment jsdom
//
// The sibling LanguageInventoryPage.test.tsx stubs next/image to `null`, so it
// cannot see thumbnail sources at all. This suite renders a plain <img> instead
// and asserts only on which source each inventory surface picks.

import { act } from "react"
import type { Route } from "next"
import { setRequestLocale } from "next-intl/server"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
    sizes,
    width,
    height,
  }: {
    src: string
    alt: string
    className?: string
    sizes?: string
    width?: number
    height?: number
  }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      sizes={sizes}
      width={width}
      height={height}
    />
  ),
}))
vi.mock("@/components/ui/carousel", () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  )
  return {
    Carousel: Pass,
    CarouselContent: Pass,
    CarouselItem: Pass,
    CarouselPrevious: () => null,
    CarouselNext: () => null,
  }
})
vi.mock("../LanguageCollectionSwitcher", () => ({
  LanguageCollectionSwitcher: () => null,
}))

import { LanguageInventoryPage } from "../LanguageInventoryPage"
import type {
  WatchLanguageInventoryCard,
  WatchLanguageInventoryModel,
} from "@/lib/watch-language-inventory"

function card(
  overrides: Partial<WatchLanguageInventoryCard> & { id: string },
): WatchLanguageInventoryCard {
  return {
    coreId: overrides.id,
    slug: overrides.id,
    title: overrides.id,
    description: null,
    imageUrl: null,
    imageAlt: overrides.id,
    muxPlaybackId: null,
    label: "SHORT_FILM",
    availability: "AUDIO",
    href: "/video.html" as Route,
    watchLanguageSlug: "english",
    parentSlug: null,
    parentTitle: null,
    parentOrder: null,
    durationSeconds: 60,
    childCount: 0,
    publishedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  }
}

function model(
  overrides: Partial<WatchLanguageInventoryModel>,
): WatchLanguageInventoryModel {
  return {
    languageSlug: "english",
    languageName: "English",
    languageNativeName: "English",
    switcherLanguages: [],
    counts: {
      audioCollections: 0,
      audioVideos: 0,
      subtitleOnlyVideos: 0,
      total: 0,
    },
    promoted: [],
    audioCollections: [],
    audioVideos: [],
    subtitleOnlyVideos: [],
    collectionLanguageCounts: {},
    ...overrides,
  }
}

function sources(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("img")).map(
    (image) => image.getAttribute("src") ?? "",
  )
}

// Every surface now requests the same on-recipe derivative, so a hero
// assertion has to be scoped by ELEMENT rather than by URL.
function heroSource(container: HTMLElement): string | null {
  const hero = container.querySelector("section img")
  return hero ? hero.getAttribute("src") : null
}

describe("LanguageInventoryPage thumbnail sources", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    setRequestLocale("en")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  // The production shape this fixes: the newer vertical series carry no
  // authored artwork on the collection or on any episode, so every surface on
  // this page previously rendered a bare gradient tile.
  it("falls back to a Mux frame on the compact row and the collection hero", () => {
    const collection = card({
      id: "vertical-series",
      href: "/series.html" as Route,
      childCount: 2,
      muxPlaybackId: null,
    })
    const episode = card({
      id: "vertical-episode",
      href: "/episode.html" as Route,
      parentSlug: "vertical-series",
      muxPlaybackId: "mux-episode-1",
    })

    act(() => {
      root.render(
        <LanguageInventoryPage
          inventory={model({
            audioCollections: [collection],
            audioVideos: [episode],
          })}
        />,
      )
    })

    const frame =
      "https://image.mux.com/mux-episode-1/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2"
    const rendered = sources(container)
    // Compact row, collection-group hero, and page hero all borrow the same
    // on-recipe derivative — no surface mints a bespoke width.
    expect(rendered).toContain(frame)
    expect(rendered.every((src) => src === frame)).toBe(true)
    expect(rendered.length).toBeGreaterThanOrEqual(3)
  })

  it("prefers authored artwork over a frame on every surface", () => {
    const episode = card({
      id: "authored-episode",
      href: "/episode.html" as Route,
      parentSlug: "series",
      imageUrl: "https://cdn.test/authored.jpg",
      muxPlaybackId: "mux-episode-1",
    })

    act(() => {
      root.render(
        <LanguageInventoryPage inventory={model({ audioVideos: [episode] })} />,
      )
    })

    const rendered = sources(container)
    expect(rendered.length).toBeGreaterThan(0)
    expect(
      rendered.every((src) => src === "https://cdn.test/authored.jpg"),
    ).toBe(true)
  })

  describe.each([
    {
      surface: "InventoryCard",
      bucket: "subtitleOnlyVideos",
      availability: "SUBTITLE_ONLY",
      interactionFrame: "language-inventory-thumbnail-frame",
    },
    {
      surface: "CompactVideoRow",
      bucket: "audioVideos",
      availability: "AUDIO",
      interactionFrame: "language-inventory-compact-thumbnail-frame",
    },
  ] as const)(
    "$surface image fallback",
    ({ bucket, availability, interactionFrame }) => {
      it.each([
        {
          scenario: "blank artwork with playback",
          imageUrl: "",
          muxPlaybackId: "mux-card-control",
          expectedSource:
            "https://image.mux.com/mux-card-control/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
        },
        {
          scenario: "null artwork with playback",
          imageUrl: null,
          muxPlaybackId: "mux-card-control",
          expectedSource:
            "https://image.mux.com/mux-card-control/thumbnail.jpg?width=448&height=252&fit_mode=smartcrop&time=2",
        },
        {
          scenario: "authored artwork with playback",
          imageUrl: "https://cdn.test/card-control.jpg",
          muxPlaybackId: "mux-card-control",
          expectedSource: "https://cdn.test/card-control.jpg",
        },
        {
          scenario: "blank artwork without playback",
          imageUrl: "",
          muxPlaybackId: null,
          expectedSource: null,
        },
        {
          scenario: "null artwork without playback",
          imageUrl: null,
          muxPlaybackId: null,
          expectedSource: null,
        },
        {
          scenario: "authored artwork without playback",
          imageUrl: "https://cdn.test/card-control.jpg",
          muxPlaybackId: null,
          expectedSource: "https://cdn.test/card-control.jpg",
        },
      ])(
        "renders the card image for $scenario",
        ({ imageUrl, muxPlaybackId, expectedSource }) => {
          const href = `/thumbnail-${bucket}.html` as Route
          act(() => {
            root.render(
              <LanguageInventoryPage
                inventory={model({
                  [bucket]: [
                    card({
                      id: `thumbnail-${bucket}`,
                      href,
                      availability,
                      imageUrl,
                      muxPlaybackId,
                    }),
                  ],
                })}
              />,
            )
          })

          // Heroes can independently emit this same frame even when the card is
          // blank. The unique href selects the affected surface, not a sibling.
          const cards = container.querySelectorAll(`a[href="${href}"]`)
          expect(cards).toHaveLength(1)
          const target = cards[0]
          expect(
            target.querySelector(`[data-testid="${interactionFrame}"]`),
          ).not.toBeNull()
          const images = target.querySelectorAll("img")
          if (expectedSource === null) {
            expect(images).toHaveLength(0)
          } else {
            expect(images).toHaveLength(1)
            // Pin WATCH_CHAPTER_CAROUSEL_RECIPE literally, independently of the
            // builder: a different derivative can trigger a cold Mux render.
            expect(images[0].getAttribute("src")).toBe(expectedSource)
          }
        },
      )
    },
  )

  // The page hero previously scanned for the first card with real artwork.
  // Once every card can synthesize a frame, that scan must still prefer the
  // authored image from a LATER card over the first card's frame.
  // Both heroes scan authored-first across every candidate. A candidate that
  // only has a playback id must not preempt real artwork later in the list.
  it("keeps the collection hero on a child's artwork over the collection's own frame", () => {
    act(() => {
      root.render(
        <LanguageInventoryPage
          inventory={model({
            audioCollections: [
              card({
                id: "series",
                href: "/series.html" as Route,
                childCount: 1,
                muxPlaybackId: "mux-collection-frame",
              }),
            ],
            audioVideos: [
              card({
                id: "authored-child",
                parentSlug: "series",
                imageUrl: "https://cdn.test/child-authored.jpg",
              }),
            ],
          })}
        />,
      )
    })

    const rendered = sources(container)
    expect(rendered).toContain("https://cdn.test/child-authored.jpg")
    expect(rendered.some((src) => src.includes("mux-collection-frame"))).toBe(
      false,
    )
  })

  it("keeps the page hero on authored artwork found after a frame-only card", () => {
    act(() => {
      root.render(
        <LanguageInventoryPage
          inventory={model({
            audioVideos: [
              card({
                id: "frame-only",
                parentSlug: "series",
                muxPlaybackId: "mux-frame-only",
              }),
              card({
                id: "authored",
                parentSlug: "series",
                imageUrl: "https://cdn.test/authored.jpg",
              }),
            ],
          })}
        />,
      )
    })

    // The frame-only card still renders its OWN frame in its own row; the
    // claim under test is only about which source the hero settles on.
    expect(heroSource(container)).toBe("https://cdn.test/authored.jpg")
    expect(
      sources(container).some((src) => src.includes("mux-frame-only")),
    ).toBe(true)
  })

  it("keeps the hero on authored artwork rather than a synthesized frame", () => {
    act(() => {
      root.render(
        <LanguageInventoryPage
          inventory={model({
            // Newest collection has only a playback id, so the first group can
            // synthesize a 448x252 frame. A later collection carries real
            // artwork, and the `priority` / `sizes="100vw"` hero must take that
            // instead of upscaling a thumbnail.
            audioCollections: [
              card({
                id: "newest",
                muxPlaybackId: "mux-newest-frame",
                publishedAt: "2026-07-31 00:00:00+00",
              }),
              card({
                id: "older",
                imageUrl: "https://cdn.test/older-authored.jpg",
                publishedAt: "2025-01-01 00:00:00+00",
              }),
            ],
            audioVideos: [
              card({
                id: "newest-episode",
                parentSlug: "newest",
                muxPlaybackId: "mux-newest-episode",
              }),
              card({
                id: "older-episode",
                parentSlug: "older",
                muxPlaybackId: "mux-older-episode",
              }),
            ],
          })}
        />,
      )
    })

    expect(heroSource(container)).toBe("https://cdn.test/older-authored.jpg")
  })

  it("renders no image at all with neither artwork nor playback", () => {
    act(() => {
      root.render(
        <LanguageInventoryPage
          inventory={model({
            audioVideos: [card({ id: "bare", parentSlug: "series" })],
          })}
        />,
      )
    })

    expect(sources(container)).toEqual([])
  })

  it.each([
    {
      markerSource: "Core ID",
      overrides: { coreId: "portrait-episode-9x16" },
    },
    {
      markerSource: "own slug",
      overrides: { slug: "portrait-episode-vertical" },
    },
    {
      markerSource: "parent slug with an unmarked localized title",
      overrides: {
        title: "Un titre localisé",
        parentSlug: "portrait-series-vertical",
      },
    },
    {
      markerSource: "localized title",
      overrides: { title: "Invitation (Vertical)" },
    },
    {
      markerSource: "parent title",
      overrides: { parentTitle: "Portrait Series (Vertical)" },
    },
  ])(
    "uses a portrait compact frame for a $markerSource marker",
    ({ overrides }) => {
      act(() => {
        root.render(
          <LanguageInventoryPage
            inventory={model({
              audioVideos: [
                card({
                  id: "portrait-episode",
                  imageUrl: "https://cdn.test/portrait-episode.jpg",
                  href: "/portrait-episode.html" as Route,
                  ...overrides,
                }),
              ],
            })}
          />,
        )
      })

      const row = container.querySelector('a[href="/portrait-episode.html"]')
      const image = row?.querySelector("img")
      const frame = image?.parentElement

      expect(row).not.toBeNull()
      expect(frame?.classList.contains("h-16")).toBe(true)
      expect(frame?.classList.contains("sm:h-14")).toBe(true)
      expect(frame?.classList.contains("aspect-[2/3]")).toBe(true)
      expect(frame?.classList.contains("w-28")).toBe(false)
      expect(frame?.classList.contains("sm:w-24")).toBe(false)
      expect(image?.classList.contains("object-center")).toBe(true)
      // Explicit intrinsic dimensions keep next/image on a two-candidate
      // srcset while still supplying the enlarged phone frame at up to 3 DPR.
      expect(image?.getAttribute("width")).toBe("64")
      expect(image?.getAttribute("height")).toBe("96")
      expect(
        row?.querySelector(
          '[data-testid="language-inventory-compact-thumbnail-frame"]',
        ),
      ).not.toBeNull()
    },
  )

  it("leaves an ordinary compact thumbnail and its interaction contract unchanged", () => {
    act(() => {
      root.render(
        <LanguageInventoryPage
          inventory={model({
            audioVideos: [
              card({
                id: "ordinary-episode",
                coreId: "ordinary-core-id",
                slug: "ordinary-episode",
                title: "Ordinary episode",
                parentSlug: "ordinary-series",
                imageUrl: "https://cdn.test/ordinary-episode.jpg",
                href: "/ordinary-episode.html" as Route,
              }),
            ],
          })}
        />,
      )
    })

    const row = container.querySelector('a[href="/ordinary-episode.html"]')
    const image = row?.querySelector("img")
    const frame = image?.parentElement

    expect(row?.getAttribute("href")).toBe("/ordinary-episode.html")
    expect(frame?.classList.contains("h-16")).toBe(true)
    expect(frame?.classList.contains("w-28")).toBe(true)
    expect(frame?.classList.contains("sm:h-14")).toBe(true)
    expect(frame?.classList.contains("sm:w-24")).toBe(true)
    expect(frame?.classList.contains("aspect-[2/3]")).toBe(false)
    expect(image?.classList.contains("object-left-top")).toBe(true)
    expect(image?.getAttribute("width")).toBe("168")
    expect(image?.getAttribute("height")).toBe("96")
    expect(
      row?.querySelector(
        '[data-testid="language-inventory-compact-thumbnail-frame"]',
      ),
    ).not.toBeNull()
  })
})
