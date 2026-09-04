/**
 * @vitest-environment jsdom
 */

import { act, StrictMode, useEffect, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { setRequestLocale } from "next-intl/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WatchHomeModel } from "@/lib/watch-home"
import {
  addWatchHomeTvPlayedId,
  buildWatchHomeVideoQueue,
  readWatchHomeTvPlayedIds,
  readWatchHomeVerticalVideoIds,
  type WatchHomeTvCarouselVideoSlide,
} from "@/lib/watch-home-carousel-sequence"
import {
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  type WatchPlayerChromeVisibilityDetail,
} from "@/lib/watch-player-chrome-events"
import {
  WATCH_HERO_PRIMARY_ACTION_CLASS,
  WATCH_HERO_TITLE_CLASS,
} from "@/components/watch/WatchHeroOverlay"
import { WATCH_SECTION_EYEBROW_CLASS } from "@/components/watch/watch-section-styles"
import { resolveMuxHeroPosterUrlAtMaxWidth } from "@/lib/url"
import { WATCH_HERO_BODY_OVERLAP_CSS } from "@/lib/watch-hero-preview-overlap"
import {
  fitWatchHomeHeroHeight,
  WATCH_HOME_HERO_RESERVE_BELOW_MOBILE_PX,
  WATCH_HOME_HERO_RESERVE_BELOW_PX,
} from "@/lib/watch-home-hero-fit"
import { WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND } from "@/lib/watch-production-overlays"
import { WatchHomePage } from "@/components/home/WatchHomePage"

vi.mock("next/image", () => ({
  default: ({
    alt,
    className,
    loading,
    priority,
    sizes,
    src,
  }: {
    alt: string
    className?: string
    loading?: "eager" | "lazy"
    priority?: boolean
    sizes?: string
    src: string
  }) => (
    <span
      role="img"
      aria-label={alt}
      className={className}
      data-loading={priority ? "eager" : (loading ?? "lazy")}
      data-priority={priority === true ? "true" : "false"}
      data-sizes={sizes}
      data-src={src}
    />
  ),
}))

vi.mock("@forge/video-player/mux-video", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    default: React.forwardRef<
      HTMLVideoElement,
      React.VideoHTMLAttributes<HTMLVideoElement> & {
        disableTracking?: boolean
      }
    >(function MockMuxVideo(
      { disableTracking: _disableTracking, ...props },
      ref,
    ) {
      return <video ref={ref} data-testid="watch-home-tv-video" {...props} />
    }),
  }
})

const carouselApi = vi.hoisted(() => ({
  scrollTo: vi.fn(),
}))

vi.mock("@/components/ui/carousel", () => ({
  Carousel: ({
    children,
    className,
    opts,
    setApi,
  }: {
    children: ReactNode
    className?: string
    opts?: Record<string, unknown>
    setApi?: (api: typeof carouselApi) => void
  }) => {
    useEffect(() => {
      setApi?.(carouselApi)
    }, [setApi])

    return (
      <div
        data-slot="carousel"
        data-loop={opts?.loop === true ? "true" : "false"}
        className={className}
      >
        {children}
      </div>
    )
  },
  CarouselContent: ({
    children,
    className,
    viewportClassName,
  }: {
    children: ReactNode
    className?: string
    viewportClassName?: string
  }) => (
    <div data-slot="carousel-content" className={viewportClassName}>
      <div className={className}>{children}</div>
    </div>
  ),
  CarouselItem: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => (
    <div data-slot="carousel-item" className={className}>
      {children}
    </div>
  ),
  CarouselPrevious: ({
    className,
    label,
  }: {
    className?: string
    label?: string
  }) => (
    <button
      data-slot="carousel-previous"
      className={className}
      aria-label={label}
    />
  ),
  CarouselNext: ({
    className,
    label,
  }: {
    className?: string
    label?: string
  }) => (
    <button
      data-slot="carousel-next"
      className={className}
      aria-label={label}
    />
  ),
}))

function makeCard(overrides: Record<string, unknown> = {}) {
  return {
    id: "card-1",
    sourceId: "1_jf-0-0",
    coreId: "1_jf-0-0",
    title: "Jesus",
    label: "Feature film",
    metaLabel: "2:03",
    href: "/jesus.html/english.html",
    imageUrl: "https://cdn.example/jesus.jpg",
    blurDataUrl: null,
    dominantColor: null,
    imageAlt: "Jesus still",
    hls: "https://stream.example/jesus.m3u8",
    playbackId: "mux-1",
    subtitleVttSrc: null,
    subtitleLanguageBcp47: null,
    durationSeconds: 123,
    childCount: 0,
    parentCoreId: null,
    parentSlug: null,
    missingData: [],
    ...overrides,
  }
}

function makeModel(overrides: Partial<WatchHomeModel> = {}): WatchHomeModel {
  const hero = { ...makeCard(), eyebrow: "Featured" }
  return {
    heroSlides: [hero],
    carousel: {
      pools: [],
    },
    sections: [
      {
        id: "home-video-gospels",
        eyebrow: "Video Bible Collection",
        title: "Discover the full story",
        description: "Explore the collection.",
        layout: "rail",
        orientation: "horizontal",
        showSequenceNumbers: false,
        cards: [makeCard(), makeCard({ id: "card-2", title: "John" })],
      },
    ],
    missingData: [],
    ...overrides,
  }
}

function makeCarouselSlide(
  overrides: Partial<WatchHomeTvCarouselVideoSlide> = {},
): WatchHomeTvCarouselVideoSlide {
  return {
    kind: "video",
    id: "queued-1",
    title: "Queued One",
    label: "Short film",
    href: "/queued-one.html/english.html",
    posterUrl: "https://cdn.example/queued-one.jpg",
    thumbnailUrl: "https://cdn.example/queued-one-thumb.jpg",
    imageAlt: "Queued One still",
    src: "https://stream.example/queued-one.m3u8",
    playbackId: "mux-queued-one",
    subtitleVttSrc: null,
    subtitleLanguageBcp47: null,
    durationSeconds: 10,
    ...overrides,
  }
}

function makeSequencedModel(): WatchHomeModel {
  return makeModel({
    carousel: {
      pools: [
        {
          id: "pool-a",
          collectionIds: ["pool-a"],
          videos: [
            makeCarouselSlide(),
            makeCarouselSlide({
              id: "queued-2",
              title: "Queued Two",
              href: "/queued-two.html/english.html",
              src: "https://stream.example/queued-two.m3u8",
            }),
            makeCarouselSlide({
              id: "queued-3",
              title: "Queued Three",
              href: "/queued-three.html/english.html",
              src: "https://stream.example/queued-three.m3u8",
            }),
          ],
        },
      ],
    },
  })
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  setRequestLocale("en")
  window.localStorage.clear()
  window.sessionStorage.clear()
  carouselApi.scrollTo.mockClear()
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
})

describe("WatchHomePage", () => {
  it("server-renders one page heading outside the heading-free carousel", () => {
    const serverContainer = document.createElement("div")
    serverContainer.innerHTML = renderToStaticMarkup(
      <WatchHomePage model={makeModel()} />,
    )

    const carousel = serverContainer.querySelector(
      '[data-testid="watch-home-tv-carousel"]',
    )
    const activeTitle = carousel?.querySelector(
      '[data-testid="watch-home-tv-active-title"]',
    )

    expect(carousel?.getAttribute("aria-label")).toBe("Jesus")
    expect(activeTitle?.tagName).toBe("P")
    expect(activeTitle?.textContent).toBe("Jesus")
    // Structural guard for the removed secondary paragraph. The hero copy is
    // the shared WatchHeroOverlay now, so the whole block is one level: an
    // eyebrow span, the title, and the shared overlay's metadata/actions shell.
    // The stable action row sits beside this rotating copy so slide changes do
    // not remount focused controls.
    const overlayRoot = activeTitle?.parentElement
    expect(
      Array.from(overlayRoot?.children ?? []).map((el) => el.tagName),
    ).toEqual(["SPAN", "P", "DIV"])
    expect(overlayRoot?.querySelectorAll("p")).toHaveLength(1)
    expect(overlayRoot?.textContent).toBe("FeaturedJesus")
    expect(
      carousel?.querySelector('[data-testid="watch-home-tv-actions"]')
        ?.textContent,
    ).toContain("Watch Now")
    expect(carousel?.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0)
    expect(serverContainer.querySelectorAll("h1")).toHaveLength(1)
    expect(serverContainer.querySelector("h1")?.textContent).toBe(
      "Jesus Film Project Watch",
    )
  })

  it("localizes semantic carousel, card, and promo copy in Russian", async () => {
    setRequestLocale("ru")
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            sections: [
              {
                id: "home-video-gospels",
                eyebrow: "Video Bible Collection",
                title: "Discover the full story",
                description: "Explore the collection.",
                layout: "rail",
                orientation: "horizontal",
                showSequenceNumbers: false,
                cards: [
                  makeCard({
                    durationSeconds: null,
                    metaLabel: "Feature film",
                  }),
                ],
              },
            ],
          })}
        />,
      )
    })

    expect(container.textContent).toContain("Рекомендуем")
    expect(container.textContent).toContain("Полнометражный фильм")
    expect(container.textContent).toContain(
      "Помогите создать новое поколение инструментов для миссии",
    )
    expect(container.textContent).not.toContain("Featured")
    expect(container.textContent).not.toContain("Feature film")
  })

  it("renders the hero, configured sections, promo content, and card links", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeModel()} />)
    })

    expect(
      container.querySelector('[data-testid="watch-home-tv-carousel"]'),
    ).not.toBeNull()
    const carousel = container.querySelector(
      '[data-testid="watch-home-tv-carousel"]',
    )
    const slideTitle = carousel?.querySelector(
      '[data-testid="watch-home-tv-active-title"]',
    )
    expect(carousel?.getAttribute("aria-label")).toBe("Jesus")
    expect(slideTitle?.tagName).toBe("P")
    expect(slideTitle?.textContent).toBe("Jesus")
    expect(carousel?.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0)
    expect(container.querySelectorAll("h1")).toHaveLength(1)
    expect(container.querySelector("h1")?.textContent).toBe(
      "Jesus Film Project Watch",
    )
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("class"),
    ).not.toContain("mt-[calc(5.5rem+env(safe-area-inset-top,0px))]")
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("class"),
    ).not.toContain("md:mt-0")
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("class"),
    ).not.toContain("lg:mt-")
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("class"),
    ).not.toContain("svh")
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("class"),
    ).not.toContain("--watch-home-rail-height")
    // Muted default reserves room for the categories rail on mobile too;
    // `h-[66svh]` is the unmuted value.
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"] > div')
        ?.getAttribute("class"),
    ).toContain(
      `h-[max(34svh,calc(100svh_-_${WATCH_HOME_HERO_RESERVE_BELOW_MOBILE_PX}px))]`,
    )
    // Desktop starts muted, so the height is the one that reserves room for
    // the categories rail; the bare `min(100svh,56.25vw)` is the unmuted value
    // and is pinned in the muted/unmuted pairing case below.
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"] > div')
        ?.getAttribute("class"),
    ).toContain(
      `md:h-[max(34svh,min(56.25vw,calc(100svh_-_${WATCH_HOME_HERO_RESERVE_BELOW_PX}px)))]`,
    )
    expect(
      container.querySelector('[data-testid="watch-home-tv-rail"]'),
    ).toBeNull()
    expect(
      container.querySelectorAll('[data-testid="watch-home-tv-carousel-card"]'),
    ).toHaveLength(0)
    expect(
      container.querySelector('[data-testid="watch-home-tv-media-frame"]'),
    ).not.toBeNull()
    expect(container.textContent).toContain("Jesus")
    expect(container.textContent).toContain("Discover the full story")
    const sectionCta = Array.from(container.querySelectorAll("a")).find(
      (link) => link.textContent?.trim() === "Watch",
    )
    expect(Array.from(sectionCta?.parentElement?.classList ?? [])).toEqual(
      expect.arrayContaining(["flex", "items-center", "justify-between"]),
    )
    expect(sectionCta?.parentElement?.classList.contains("flex-col")).toBe(
      false,
    )
    expect(sectionCta?.classList.contains("shrink-0")).toBe(true)
    expect(container.textContent).toContain("Built for global missions")
    expect(container.textContent).not.toContain("Sign Up For Our Newsletter")
    expect(
      container
        .querySelector('[data-section-id="home-video-gospels"] .grid')
        ?.getAttribute("class"),
    ).toContain("xl:grid-cols-6")
    expect(
      container.querySelector('[data-testid="watch-home-tv-video"]'),
    ).not.toBeNull()
    expect(
      container.querySelectorAll('[data-testid="watch-home-video-timeline"]'),
    ).toHaveLength(2)
    expect(
      container.querySelectorAll('[data-testid="watch-home-current-progress"]'),
    ).toHaveLength(2)
    const muteButton = container.querySelector(
      'button[aria-label="Unmute preview"]',
    )
    const watchNowLink = container.querySelector(
      "a[href='/jesus.html/english.html?autoplay=1']",
    )
    expect(
      container.querySelectorAll('button[aria-label="Unmute preview"]'),
    ).toHaveLength(1)
    expect(muteButton?.parentElement).toBe(watchNowLink?.parentElement)
    const actionChildren = Array.from(
      watchNowLink?.parentElement?.children ?? [],
    )
    expect(actionChildren.slice(0, 2)).toEqual([watchNowLink, muteButton])
    expect(actionChildren).toHaveLength(3)
    expect(
      actionChildren[2]?.querySelector(
        '[data-testid="watch-home-video-timeline"][data-size="compact"]',
      ),
    ).not.toBeNull()
    expect(
      container.querySelectorAll("a[href='/jesus.html/english.html']"),
    ).toHaveLength(3)
    expect(
      container.querySelectorAll(
        "a[href='/jesus.html/english.html?autoplay=1']",
      ),
    ).toHaveLength(1)
    expect(
      container.querySelector("a[href='/jesus.html/english.html?autoplay=1']")
        ?.textContent,
    ).toContain("Watch Now")
    expect(
      container.querySelector('[data-testid="watch-home-share-button"]'),
    ).toBeNull()
    const cardText = container.querySelector(
      '[data-testid="watch-home-card-text-gradient"]',
    )
    const cardTitle = cardText?.querySelector("h3")
    const cardLabel = cardTitle?.previousElementSibling
    expect(cardText).not.toBeNull()
    expect(cardLabel?.className).toContain("tracking-media-label")
    expect(cardLabel?.className).not.toContain("tracking-wider")
    expect(cardTitle?.className).toContain("font-media-card-title")
    expect(cardTitle?.className).not.toContain("font-bold")
    const sectionEyebrow = container.querySelector(
      '[data-section-id="home-video-gospels"] p',
    )
    expect(sectionEyebrow?.className).toContain("tracking-eyebrow")
    expect(sectionEyebrow?.className).not.toContain("tracking-wider")
    act(() => {
      root.render(
        <WatchHomePage
          model={makeModel({
            sections: [
              {
                id: "dominant-color-section",
                eyebrow: "Featured",
                title: "Dominant Color",
                description: null,
                layout: "grid",
                orientation: "horizontal",
                showSequenceNumbers: false,
                cards: [makeCard({ dominantColor: "#123456" })],
              },
            ],
          })}
        />,
      )
    })
    expect(
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '[data-testid="watch-home-card-text-gradient"]',
        ),
      ).some((element) => element.style.background.includes("rgb(18,52,86)")),
    ).toBe(true)
    expect(container.textContent).toContain("2:03")
    const textureClassNames = Array.from(
      container.querySelectorAll("[class*='overlay.svg']"),
    ).map((element) => element.getAttribute("class") ?? "")
    expect(textureClassNames).toEqual(
      expect.arrayContaining([
        expect.stringContaining("bg-[url(/watch/images/overlay.svg)]"),
      ]),
    )
    expect(
      textureClassNames.some((className) =>
        className.includes("/assets/overlay.svg"),
      ),
    ).toBe(false)
  })

  it("renders an unlinked fallback card when href is missing", async () => {
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            heroSlides: [{ ...makeCard({ href: null }), eyebrow: "Featured" }],
            sections: [
              {
                id: "fallback",
                eyebrow: "Fallback",
                title: "Fallback Cards",
                description: null,
                layout: "grid",
                orientation: "horizontal",
                showSequenceNumbers: false,
                cards: [makeCard({ href: null, imageUrl: null })],
              },
            ],
          })}
        />,
      )
    })

    expect(
      container.querySelector("a[href='/jesus.html/english.html']"),
    ).toBeNull()
    expect(container.textContent).toContain("Fallback Cards")
    expect(
      container.querySelector('[data-testid="watch-home-card-hover-outline"]'),
    ).toBeNull()
    expect(
      container.querySelector(
        '[data-testid="watch-home-hero-thumbnail-frame"]',
      ),
    ).toBeNull()
    for (const fallback of container.querySelectorAll(
      'div[aria-label="Jesus"]',
    )) {
      expect(fallback.className).not.toContain("group")
      expect(fallback.className).not.toContain("focus-visible:outline-none")
      expect(fallback.className).not.toContain("hover:shadow")
    }
  })

  it("hides the top-right meta label for collection cards", async () => {
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            sections: [
              {
                id: "collection-cards",
                eyebrow: "Collection",
                title: "Collection Cards",
                description: null,
                layout: "grid",
                orientation: "horizontal",
                showSequenceNumbers: false,
                cards: [
                  makeCard({
                    id: "collection-card",
                    title: "Scripture Spoken Exactly as Written",
                    label: "Collection",
                    metaLabel: "61 episodes",
                    childCount: 0,
                  }),
                ],
              },
            ],
          })}
        />,
      )
    })

    const section = container.querySelector(
      '[data-section-id="collection-cards"]',
    )
    expect(section?.textContent).toContain(
      "Scripture Spoken Exactly as Written",
    )
    expect(section?.textContent).toContain("Collection")
    expect(section?.textContent).not.toContain("61 episodes")
    expect(section?.className).toContain("py-10")
    expect(section?.className).toContain("md:py-16")
  })

  it("softens section card hover by crossfading the backdrop without clearing between cards", async () => {
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            sections: [
              {
                id: "hover-test",
                eyebrow: "Hover",
                title: "Hover Backdrops",
                description: null,
                layout: "grid",
                orientation: "horizontal",
                showSequenceNumbers: false,
                cards: [
                  makeCard({
                    id: "card-1",
                    title: "Jesus",
                    imageUrl: "https://cdn.example/jesus.jpg",
                  }),
                  makeCard({
                    id: "card-2",
                    title: "John",
                    href: "/john.html/english.html",
                    imageUrl: "https://cdn.example/john.jpg",
                  }),
                  makeCard({
                    id: "card-3",
                    title: "Luke",
                    href: "/luke.html/english.html",
                    imageUrl: "https://cdn.example/luke.jpg",
                  }),
                ],
              },
            ],
          })}
        />,
      )
    })

    const section = container.querySelector(
      '[data-section-id="hover-test"]',
    ) as HTMLElement
    const cardLinks = Array.from(section.querySelectorAll("a")).filter((link) =>
      link.querySelector('[data-testid="watch-home-card-bevel"]'),
    )
    const firstCard = cardLinks.find(
      (link) => link.getAttribute("href") === "/jesus.html/english.html",
    )
    const secondCard = cardLinks.find(
      (link) => link.getAttribute("href") === "/john.html/english.html",
    )
    const thirdCard = cardLinks.find(
      (link) => link.getAttribute("href") === "/luke.html/english.html",
    )
    const findHoverBackdrop = () =>
      section.querySelector(
        '[data-testid="watch-home-section-hover-backdrop"]',
      ) as HTMLElement | null
    const defaultBackdrop = section.querySelector(
      '[data-testid="watch-home-section-default-backdrop"]',
    ) as HTMLElement

    expect(defaultBackdrop.style.backgroundImage).toContain(
      "https://cdn.example/jesus.jpg",
    )
    expect(findHoverBackdrop()).toBeNull()

    await act(async () => {
      secondCard?.dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true }),
      )
    })
    const johnBackdrop = findHoverBackdrop()
    expect(johnBackdrop?.getAttribute("class")).toContain(
      "watch-home-section-backdrop-enter",
    )
    expect(johnBackdrop?.style.backgroundImage).toContain(
      "https://cdn.example/john.jpg",
    )
    expect(
      johnBackdrop?.style.getPropertyValue("--watch-home-backdrop-opacity"),
    ).toBe("1")

    await act(async () => {
      firstCard?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })
    const jesusBackdrop = findHoverBackdrop()
    expect(jesusBackdrop).not.toBe(johnBackdrop)
    expect(jesusBackdrop?.style.backgroundImage).toContain(
      "https://cdn.example/jesus.jpg",
    )
    expect(
      (
        section.querySelector(
          '[data-testid="watch-home-section-hover-backdrop-previous"]',
        ) as HTMLElement
      ).style.backgroundImage,
    ).toContain("https://cdn.example/john.jpg")

    await act(async () => {
      thirdCard?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    })
    const lukeBackdrop = findHoverBackdrop()
    expect(lukeBackdrop).not.toBe(jesusBackdrop)
    expect(lukeBackdrop?.style.backgroundImage).toContain(
      "https://cdn.example/luke.jpg",
    )
    expect(
      Array.from(
        section.querySelectorAll(
          '[data-testid="watch-home-section-hover-backdrop-previous"]',
        ),
      ).map((element) => (element as HTMLElement).style.backgroundImage),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("https://cdn.example/john.jpg"),
        expect.stringContaining("https://cdn.example/jesus.jpg"),
      ]),
    )

    await act(async () => {
      section.dispatchEvent(
        new MouseEvent("pointerout", {
          bubbles: true,
          relatedTarget: document.body,
        }),
      )
    })

    expect(defaultBackdrop.style.backgroundImage).toContain(
      "https://cdn.example/luke.jpg",
    )
    expect(findHoverBackdrop()).toBeNull()
    expect(
      section
        .querySelector(
          '[data-testid="watch-home-section-hover-backdrop-previous"]',
        )
        ?.getAttribute("class"),
    ).toContain("watch-home-section-backdrop-exit")

    await act(async () => {
      firstCard?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })

    const focusedJesusBackdrop = findHoverBackdrop()
    expect(focusedJesusBackdrop?.style.backgroundImage).toContain(
      "https://cdn.example/jesus.jpg",
    )

    await act(async () => {
      firstCard?.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: secondCard,
        }),
      )
    })

    expect(findHoverBackdrop()?.style.backgroundImage).toContain(
      "https://cdn.example/jesus.jpg",
    )

    await act(async () => {
      secondCard?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
    })

    const focusedJohnBackdrop = findHoverBackdrop()
    expect(focusedJohnBackdrop).not.toBe(focusedJesusBackdrop)
    expect(focusedJohnBackdrop?.style.backgroundImage).toContain(
      "https://cdn.example/john.jpg",
    )
  })

  it("carries the hero preview playback time into the watch now link", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeModel()} />)
    })

    const video = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      value: 12.8,
    })
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 100,
    })

    await act(async () => {
      video.dispatchEvent(new Event("timeupdate", { bubbles: true }))
    })

    expect(
      container.querySelector(
        "a[href='/jesus.html/english.html?t=12&autoplay=1']",
      )?.textContent,
    ).toContain("Watch Now")
  })

  it("shows available subtitles while the hero preview is muted", async () => {
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            heroSlides: [
              {
                ...makeCard({
                  subtitleVttSrc: "https://cdn.example/jesus.vtt",
                  subtitleLanguageBcp47: "en",
                }),
                eyebrow: "Featured",
              },
            ],
          })}
        />,
      )
    })

    const video = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    const track = video.querySelector("track[data-subtitle-track]")
    expect(video.getAttribute("crossorigin")).toBe("anonymous")
    expect(track?.getAttribute("src")).toBe("https://cdn.example/jesus.vtt")
    expect(track?.getAttribute("srclang")).toBe("en")

    await act(async () => {
      container
        .querySelector('button[aria-label="Unmute preview"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(video.querySelector("track[data-subtitle-track]")).toBeNull()
  })

  it("advances between pooled library videos with no branded slide in the sequence", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            carousel: {
              pools: [
                {
                  id: "pool-a",
                  collectionIds: ["pool-a"],
                  videos: [
                    makeCarouselSlide(),
                    makeCarouselSlide({
                      id: "queued-2",
                      title: "Queued Two",
                      href: "/queued-two.html/english.html",
                      thumbnailUrl: "https://cdn.example/queued-two-thumb.jpg",
                      src: "https://stream.example/queued-two.m3u8",
                    }),
                    makeCarouselSlide({
                      id: "queued-3",
                      title: "Queued Three",
                      href: "/queued-three.html/english.html",
                      thumbnailUrl:
                        "https://cdn.example/queued-three-thumb.jpg",
                      src: "https://stream.example/queued-three.m3u8",
                    }),
                    makeCarouselSlide({
                      id: "queued-4",
                      title: "Queued Four",
                      href: "/queued-four.html/english.html",
                      thumbnailUrl: "https://cdn.example/queued-four-thumb.jpg",
                      src: "https://stream.example/queued-four.m3u8",
                    }),
                    makeCarouselSlide({
                      id: "queued-5",
                      title: "Queued Five",
                      href: "/queued-five.html/english.html",
                      posterUrl: "https://cdn.example/queued-five-poster.jpg",
                      thumbnailUrl: "",
                      src: "https://stream.example/queued-five.m3u8",
                    }),
                  ],
                },
              ],
            },
          })}
        />,
      )
    })

    // The rail is gone: the hero is the only carousel surface.
    expect(
      container.querySelector('[data-testid="watch-home-tv-rail"]'),
    ).toBeNull()
    expect(
      container.querySelectorAll('[data-testid="watch-home-tv-carousel-card"]'),
    ).toHaveLength(0)
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("aria-label"),
    ).toBe("Queued One")

    // feat-440: no branded insert reaches the sequence, so the takeover the
    // "Watch Short Film" button opened has no entry point left either.
    expect(container.textContent).not.toContain("Join Us")
    expect(container.textContent).not.toContain("Watch Short Film")
    expect(
      Array.from(container.querySelectorAll("a")).some((link) =>
        link.getAttribute("href")?.includes("nextstep.is/joinus"),
      ),
    ).toBe(false)
    expect(
      document.body.querySelector('[data-testid="hero-player-custom-chrome"]'),
    ).toBeNull()

    const heroVideo = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    expect(heroVideo.getAttribute("src")).toBe(
      "https://stream.example/queued-one.m3u8",
    )
    const timelines = Array.from(
      container.querySelectorAll('[data-testid="watch-home-video-timeline"]'),
    )
    expect(timelines).toHaveLength(2)
    const desktopTimeline = timelines.find(
      (timeline) => timeline.getAttribute("data-size") === "large",
    )
    const mobileTimeline = timelines.find(
      (timeline) => timeline.getAttribute("data-size") === "compact",
    )
    expect(desktopTimeline).toBeDefined()
    expect(mobileTimeline).toBeDefined()
    const actionRow = container.querySelector(
      '[data-testid="watch-home-tv-actions"]',
    )
    expect(actionRow?.contains(mobileTimeline!)).toBe(true)
    expect(actionRow?.contains(desktopTimeline!)).toBe(false)
    const desktopCircles = Array.from(
      desktopTimeline!.querySelectorAll(
        '[data-testid="watch-home-video-circle"]',
      ),
    )
    const mobileCircles = Array.from(
      mobileTimeline!.querySelectorAll(
        '[data-testid="watch-home-video-circle"]',
      ),
    )
    expect(
      desktopCircles.map((circle) => circle.getAttribute("data-offset")),
    ).toEqual(["0", "1", "2", "3"])
    expect(
      mobileCircles.map((circle) => circle.getAttribute("data-offset")),
    ).toEqual(["0", "1"])
    expect(
      desktopCircles.map((circle) =>
        circle.querySelector('[role="img"]')?.getAttribute("data-src"),
      ),
    ).toEqual([
      "https://cdn.example/queued-one-thumb.jpg",
      "https://cdn.example/queued-two-thumb.jpg",
      "https://cdn.example/queued-three-thumb.jpg",
      "https://cdn.example/queued-four-thumb.jpg",
    ])
    expect(
      mobileCircles.map((circle) =>
        circle.querySelector('[role="img"]')?.getAttribute("data-src"),
      ),
    ).toEqual([
      "https://cdn.example/queued-one-thumb.jpg",
      "https://cdn.example/queued-two-thumb.jpg",
    ])
    for (const timeline of timelines) {
      const circles = Array.from(
        timeline.querySelectorAll('[data-testid="watch-home-video-circle"]'),
      )
      expect(
        circles.every(
          (circle) =>
            circle
              .querySelector('[role="img"]')
              ?.getAttribute("data-loading") === "lazy",
        ),
      ).toBe(true)
      expect(
        circles.every(
          (circle) =>
            circle
              .querySelector('[role="img"]')
              ?.getAttribute("data-priority") === "false",
        ),
      ).toBe(true)
      const currentCircle = timeline.querySelector('[data-offset="0"]')
      expect(
        currentCircle?.querySelector("button")?.getAttribute("aria-label"),
      ).toBe("Queued One")
      expect(
        currentCircle
          ?.querySelector('[aria-current="true"] [role="img"]')
          ?.getAttribute("data-src"),
      ).toBe("https://cdn.example/queued-one-thumb.jpg")
      expect(
        currentCircle?.querySelectorAll(
          '[data-testid="watch-home-current-progress"]',
        ),
      ).toHaveLength(1)
    }
    expect(
      desktopTimeline!
        .querySelector('[role="img"]')
        ?.getAttribute("data-sizes"),
    ).toBe("48px")
    expect(
      mobileTimeline!.querySelector('[role="img"]')?.getAttribute("data-sizes"),
    ).toBe("36px")
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-overlay"]')
        ?.getAttribute("class"),
    ).toContain("pb-4 sm:pb-8 compact-landscape:pb-4")

    const queuedTwoButton = container.querySelector(
      'button[aria-label="Show Queued Two"]',
    ) as HTMLButtonElement
    queuedTwoButton.focus()
    expect(document.activeElement).toBe(queuedTwoButton)

    await act(async () => {
      queuedTwoButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(document.activeElement).toBe(queuedTwoButton)
    expect(queuedTwoButton.getAttribute("aria-label")).toBe("Queued Two")
    expect(queuedTwoButton.getAttribute("aria-current")).toBe("true")
    expect(queuedTwoButton.getAttribute("aria-disabled")).toBe("true")
    expect(queuedTwoButton.disabled).toBe(false)

    const carousel = container.querySelector(
      '[data-testid="watch-home-tv-carousel"]',
    )
    const activeTitle = carousel?.querySelector(
      '[data-testid="watch-home-tv-active-title"]',
    )
    expect(carousel?.getAttribute("aria-label")).toBe("Queued Two")
    expect(activeTitle?.tagName).toBe("P")
    expect(activeTitle?.textContent).toBe("Queued Two")
    expect(carousel?.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0)
    expect(
      (
        container.querySelector(
          '[data-testid="watch-home-tv-video"]',
        ) as HTMLVideoElement
      ).getAttribute("src"),
    ).toBe("https://stream.example/queued-two.m3u8")
    const advancedTimelines = Array.from(
      container.querySelectorAll('[data-testid="watch-home-video-timeline"]'),
    )
    const advancedDesktopTimeline = advancedTimelines.find(
      (timeline) => timeline.getAttribute("data-size") === "large",
    )
    const advancedMobileTimeline = advancedTimelines.find(
      (timeline) => timeline.getAttribute("data-size") === "compact",
    )
    expect(
      Array.from(
        advancedDesktopTimeline!.querySelectorAll(
          '[data-testid="watch-home-video-circle"]',
        ),
      ).map((circle) => circle.getAttribute("data-offset")),
    ).toEqual(["-1", "0", "1", "2", "3"])
    expect(
      Array.from(
        advancedMobileTimeline!.querySelectorAll(
          '[data-testid="watch-home-video-circle"]',
        ),
      ).map((circle) => circle.getAttribute("data-offset")),
    ).toEqual(["0", "1"])
    for (const timeline of advancedTimelines) {
      expect(
        timeline
          .querySelector('[data-offset="0"] [aria-current="true"] [role="img"]')
          ?.getAttribute("data-src"),
      ).toBe("https://cdn.example/queued-two-thumb.jpg")
    }
    expect(
      Array.from(
        advancedDesktopTimeline!.querySelectorAll(
          '[data-testid="watch-home-video-circle"] [role="img"]',
        ),
      ).map((image) => image.getAttribute("data-src")),
    ).toEqual([
      "https://cdn.example/queued-one-thumb.jpg",
      "https://cdn.example/queued-two-thumb.jpg",
      "https://cdn.example/queued-three-thumb.jpg",
      "https://cdn.example/queued-four-thumb.jpg",
      "https://cdn.example/queued-five-poster.jpg",
    ])
    expect(
      Array.from(
        advancedMobileTimeline!.querySelectorAll(
          '[data-testid="watch-home-video-circle"] [role="img"]',
        ),
      ).map((image) => image.getAttribute("data-src")),
    ).toEqual([
      "https://cdn.example/queued-two-thumb.jpg",
      "https://cdn.example/queued-three-thumb.jpg",
    ])

    // R2: with the secondary paragraph gone, the rotating copy stagger runs
    // eyebrow -> title with no dead beat where the paragraph used to animate.
    // The action row is deliberately stable so carousel advances cannot steal
    // focus from Watch Now or mute/unmute.
    // These two classes are applied only to the staggered overlay items, so
    // querying the carousel pins both the delays and the item count without
    // depending on how deeply the overlay nests them.
    const delaysFor = (className: string) =>
      Array.from(carousel?.querySelectorAll(`.${className}`) ?? []).map((el) =>
        (el as HTMLElement).style.getPropertyValue("--watch-home-copy-delay"),
      )
    // Entering runs offset by 430ms while the outgoing copy clears: 430+0/70.
    expect(delaysFor("watch-home-copy-enter")).toEqual(["430ms", "500ms"])
    expect(delaysFor("watch-home-copy-exit")).toEqual(["0ms", "35ms"])

    // The hero reveals the shell chrome on mount; it never hides it now that
    // there is no full-player takeover.
    const chromeVisibilityEvents: WatchPlayerChromeVisibilityDetail[] = []
    const handleChromeVisibility = (event: Event) => {
      chromeVisibilityEvents.push(
        (event as CustomEvent<WatchPlayerChromeVisibilityDetail>).detail,
      )
    }
    window.addEventListener(
      WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
      handleChromeVisibility,
    )
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })
    window.removeEventListener(
      WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
      handleChromeVisibility,
    )
    expect(chromeVisibilityEvents.every((detail) => detail.visible)).toBe(true)

    const standardCard = container
      .querySelector('[data-testid="watch-home-card-bevel"]')
      ?.closest("a")
    expect(standardCard?.getAttribute("class")).not.toContain("hover:scale")
    expect(
      standardCard?.querySelector('[data-testid="watch-home-card-bevel"]'),
    ).not.toBeNull()
    const standardCardHoverOutline = standardCard?.querySelector(
      '[data-testid="watch-home-card-hover-outline"]',
    )
    expect(standardCard?.getAttribute("class")).toContain(
      "focus-visible:outline-none",
    )
    expect(standardCardHoverOutline?.getAttribute("class")).toContain(
      "rounded-[inherit]",
    )
    expect(standardCardHoverOutline?.getAttribute("class")).toContain(
      "border-4",
    )
    expect(standardCardHoverOutline?.getAttribute("class")).toContain(
      "border-white",
    )
    expect(standardCardHoverOutline?.getAttribute("class")).not.toContain(
      "watch-home-gradient-outline",
    )
    expect(standardCardHoverOutline?.getAttribute("class")).not.toMatch(
      /red|gradient|shadow/,
    )
    expect(standardCardHoverOutline?.querySelector("svg")).toBeNull()
    expect(
      standardCard?.querySelectorAll(
        '[data-testid="watch-home-card-hover-outline"] span',
      ),
    ).toHaveLength(0)
    expect(
      standardCard?.querySelector('[role="img"]')?.getAttribute("class"),
    ).toContain("poster-hover-zoom")
    expect(
      Array.from(container.querySelectorAll("div"))
        .map((element) => element.getAttribute("class") ?? "")
        .some(
          (className) =>
            className.includes("max-w-[1920px]") &&
            className.includes("px-5") &&
            className.includes("md:px-16") &&
            className.includes("xl:px-24"),
        ),
    ).toBe(true)
    expect(
      Array.from(container.querySelectorAll("section, footer, div"))
        .map((element) => element.getAttribute("class") ?? "")
        .some((className) => className.includes("px-4 sm:px-6 lg:px-8")),
    ).toBe(false)
  })

  it("moves focus to the current circle when autoplay removes the focused past circle", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    const numberWords = ["One", "Two", "Three", "Four", "Five"]

    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            carousel: {
              pools: [
                {
                  id: "pool-a",
                  collectionIds: ["pool-a"],
                  videos: numberWords.map((word, index) =>
                    makeCarouselSlide({
                      id: `queued-${index + 1}`,
                      title: `Queued ${word}`,
                      href: `/queued-${index + 1}.html/english.html`,
                      src: `https://stream.example/queued-${index + 1}.m3u8`,
                    }),
                  ),
                },
              ],
            },
          })}
        />,
      )
    })

    await act(async () => {
      container
        .querySelector('button[aria-label="Show Queued Two"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    const pastButton = container.querySelector(
      '[data-testid="watch-home-video-timeline"] [data-offset="-1"] button',
    ) as HTMLButtonElement
    pastButton.focus()
    expect(document.activeElement).toBe(pastButton)

    await act(async () => {
      container
        .querySelector('[data-testid="watch-home-tv-video"]')
        ?.dispatchEvent(new Event("ended", { bubbles: true }))
    })

    const currentButton = container.querySelector(
      '[data-testid="watch-home-video-timeline"][data-size="large"] [data-offset="0"] button',
    ) as HTMLButtonElement
    expect(currentButton.getAttribute("aria-label")).toBe("Queued Three")
    expect(document.activeElement).toBe(currentButton)

    await act(async () => {
      container
        .querySelector('[data-testid="watch-home-tv-video"]')
        ?.dispatchEvent(new Event("ended", { bubbles: true }))
    })
    await act(async () => {
      container
        .querySelector('[data-testid="watch-home-tv-video"]')
        ?.dispatchEvent(new Event("ended", { bubbles: true }))
    })

    const repeatedlyRecoveredCurrentButton = container.querySelector(
      '[data-testid="watch-home-video-timeline"][data-size="large"] [data-offset="0"] button',
    ) as HTMLButtonElement
    expect(repeatedlyRecoveredCurrentButton.getAttribute("aria-label")).toBe(
      "Queued Five",
    )
    expect(document.activeElement).toBe(repeatedlyRecoveredCurrentButton)
  })

  it("resets a completed playback ring when a timeline video is selected", async () => {
    vi.useFakeTimers()

    try {
      vi.spyOn(Math, "random").mockReturnValue(0)
      await act(async () => {
        root.render(
          <WatchHomePage
            model={makeModel({
              carousel: {
                pools: [
                  {
                    id: "pool-a",
                    collectionIds: ["pool-a"],
                    videos: [
                      makeCarouselSlide(),
                      makeCarouselSlide({
                        id: "queued-2",
                        title: "Queued Two",
                      }),
                      makeCarouselSlide({
                        id: "queued-3",
                        title: "Queued Three",
                      }),
                      makeCarouselSlide({
                        id: "queued-4",
                        title: "Queued Four",
                      }),
                    ],
                  },
                ],
              },
            })}
          />,
        )
      })

      await act(async () => {
        vi.advanceTimersByTime(9_420)
      })

      await act(async () => {
        container
          .querySelector('button[aria-label="Show Queued Two"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })

      expect(
        container.querySelectorAll('[data-testid="watch-home-progress-reset"]'),
      ).toHaveLength(2)

      await act(async () => {
        vi.advanceTimersByTime(950)
      })

      expect(
        container.querySelectorAll('[data-testid="watch-home-progress-reset"]'),
      ).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it("prefetches three future timeline videos near the queue tail", async () => {
    vi.useFakeTimers()

    try {
      vi.spyOn(Math, "random").mockReturnValue(0)
      const videos = Array.from({ length: 10 }, (_, index) => {
        const number = index + 1
        return makeCarouselSlide({
          id: `queued-${number}`,
          title: `Queued ${number}`,
          href: `/queued-${number}.html/english.html`,
          thumbnailUrl: `https://cdn.example/queued-${number}-thumb.jpg`,
          src: `https://stream.example/queued-${number}.m3u8`,
        })
      })

      await act(async () => {
        root.render(
          <WatchHomePage
            model={makeModel({
              carousel: {
                pools: [{ id: "pool-a", collectionIds: ["pool-a"], videos }],
              },
            })}
          />,
        )
      })

      await act(async () => {
        container
          .querySelector('button[aria-label="Show Queued 4"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
      await act(async () => {
        container
          .querySelector('button[aria-label="Show Queued 7"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      })
      await act(async () => {
        vi.advanceTimersByTime(0)
      })

      const timelines = Array.from(
        container.querySelectorAll('[data-testid="watch-home-video-timeline"]'),
      )
      const desktopTimeline = timelines.find(
        (timeline) => timeline.getAttribute("data-size") === "large",
      )
      const mobileTimeline = timelines.find(
        (timeline) => timeline.getAttribute("data-size") === "compact",
      )
      const circleLabels = (timeline: Element) =>
        Array.from(
          timeline.querySelectorAll('[data-testid="watch-home-video-circle"]'),
        ).map((circle) =>
          circle.querySelector("button")?.getAttribute("aria-label"),
        )
      expect(circleLabels(desktopTimeline!)).toEqual([
        "Show Queued 6",
        "Queued 7",
        "Show Queued 9",
        "Show Queued 10",
        "Show Queued 8",
      ])
      expect(circleLabels(mobileTimeline!)).toEqual([
        "Queued 7",
        "Show Queued 9",
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it("continues autoplay after the final unplayed pooled video ends", async () => {
    vi.useFakeTimers()

    try {
      addWatchHomeTvPlayedId("queued-1")
      addWatchHomeTvPlayedId("queued-2")
      vi.spyOn(Math, "random").mockReturnValue(0)

      await act(async () => {
        root.render(<WatchHomePage model={makeSequencedModel()} />)
      })

      const carousel = container.querySelector(
        '[data-testid="watch-home-tv-carousel"]',
      )
      const finalUnplayedVideo = container.querySelector(
        '[data-testid="watch-home-tv-video"]',
      ) as HTMLVideoElement
      const finalUnplayedSrc = finalUnplayedVideo.getAttribute("src")

      expect(carousel?.getAttribute("aria-label")).toBe("Queued Three")
      expect(finalUnplayedSrc).toBe("https://stream.example/queued-three.m3u8")

      const muteButton = container.querySelector(
        'button[aria-label="Unmute preview"]',
      ) as HTMLButtonElement
      muteButton.focus()
      expect(document.activeElement).toBe(muteButton)

      await act(async () => {
        finalUnplayedVideo.dispatchEvent(new Event("ended", { bubbles: true }))
      })

      const replacementVideo = container.querySelector(
        '[data-testid="watch-home-tv-video"]',
      ) as HTMLVideoElement
      const replacementPlay = vi.fn(() => Promise.resolve())
      replacementVideo.play =
        replacementPlay as unknown as HTMLVideoElement["play"]

      expect(replacementVideo).not.toBe(finalUnplayedVideo)
      expect(replacementVideo.getAttribute("src")).not.toBe(finalUnplayedSrc)
      expect(carousel?.getAttribute("aria-label")).not.toBe("Queued Three")
      expect(
        container.querySelector('button[aria-label="Unmute preview"]'),
      ).toBe(muteButton)
      expect(document.activeElement).toBe(muteButton)

      await act(async () => {
        replacementVideo.dispatchEvent(new Event("canplay", { bubbles: true }))
        vi.advanceTimersByTime(1_500)
        await Promise.resolve()
      })

      expect(replacementPlay).toHaveBeenCalledTimes(1)

      const watchNow = container.querySelector(
        '[data-testid="watch-home-tv-actions"] a',
      ) as HTMLAnchorElement
      watchNow.focus()
      expect(document.activeElement).toBe(watchNow)

      await act(async () => {
        replacementVideo.dispatchEvent(new Event("ended", { bubbles: true }))
      })

      expect(
        container.querySelector('[data-testid="watch-home-tv-actions"] a'),
      ).toBe(watchNow)
      expect(document.activeElement).toBe(watchNow)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps the server-rendered opening slide independent of the random draw", () => {
    const model = makeSequencedModel()
    const markup = [0, 0.99].map((value) => {
      vi.spyOn(Math, "random").mockReturnValue(value)
      const serverContainer = document.createElement("div")
      serverContainer.innerHTML = renderToStaticMarkup(
        <WatchHomePage model={model} />,
      )
      vi.restoreAllMocks()
      return serverContainer.innerHTML
    })

    // Static HTML is shared by every visitor; a render-time draw would both
    // break hydration and make this page uncacheable.
    expect(markup[0]).toBe(markup[1])
    expect(markup[0]).toContain("Queued One")
    expect(markup[0]).not.toContain("Billions are searching")
  })

  it("opens a different library video per visit", async () => {
    const model = makeSequencedModel()
    const opened: Array<string | null> = []

    for (const value of [0, 0.5, 0.99]) {
      const visitContainer = document.createElement("div")
      document.body.appendChild(visitContainer)
      const visitRoot = createRoot(visitContainer)
      window.localStorage.clear()
      window.sessionStorage.clear()
      vi.spyOn(Math, "random").mockReturnValue(value)

      await act(async () => {
        visitRoot.render(<WatchHomePage model={model} />)
      })

      opened.push(
        visitContainer
          .querySelector('[data-testid="watch-home-tv-carousel"]')
          ?.getAttribute("aria-label") ?? null,
      )

      await act(async () => {
        visitRoot.unmount()
      })
      visitContainer.remove()
      vi.restoreAllMocks()
    }

    expect(opened).toEqual(["Queued One", "Queued Two", "Queued Three"])
  })

  it("re-arms the per-visit draw under StrictMode double mounting", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99)

    await act(async () => {
      root.render(
        <StrictMode>
          <WatchHomePage model={makeSequencedModel()} />
        </StrictMode>,
      )
    })

    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("aria-label"),
    ).toBe("Queued Three")
  })

  it("only records the video the visitor actually opened as played", async () => {
    const model = makeSequencedModel()
    const poolIds = model.carousel.pools[0].videos.map((entry) => entry.id)
    const bootstrap = buildWatchHomeVideoQueue({
      pools: model.carousel.pools,
      targetVideoCount: 7,
      useStoredProgress: false,
    }).videos[0]
    const bootstrapId = bootstrap?.id
    const bootstrapTitle = bootstrap?.title
    // Anti-vacuous: the guard only does work while the deterministic bootstrap
    // slide differs from the drawn hero, so the draw is aimed away from it.
    expect(poolIds).toContain(bootstrapId)

    const heroId = poolIds.find((id) => id !== bootstrapId)
    vi.spyOn(Math, "random").mockReturnValue(
      (poolIds.indexOf(heroId ?? "") + 0.5) / poolIds.length,
    )
    await act(async () => {
      root.render(<WatchHomePage model={model} />)
    })

    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("aria-label"),
    ).not.toBe(bootstrapTitle)
    expect(readWatchHomeTvPlayedIds()).toEqual([heroId])
  })

  function defineVideoSize(
    element: HTMLVideoElement,
    width: number,
    height: number,
  ) {
    // jsdom has no decoder, so the decoded size is the one thing a component
    // test has to stand in for. Labelled here because it is the exact signal
    // the guard reads in production.
    Object.defineProperty(element, "videoWidth", {
      configurable: true,
      value: width,
    })
    Object.defineProperty(element, "videoHeight", {
      configurable: true,
      value: height,
    })
  }

  function verticalPoolModel() {
    return makeModel({
      carousel: {
        pools: [
          {
            id: "pool-a",
            collectionIds: ["pool-a"],
            videos: [
              makeCarouselSlide({ id: "portrait-1", title: "Portrait One" }),
              makeCarouselSlide({
                id: "landscape-1",
                title: "Landscape One",
                src: "https://stream.example/landscape-one.m3u8",
              }),
            ],
          },
        ],
      },
    })
  }

  it("skips a video the browser reports as portrait and never draws it again", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    await act(async () => {
      root.render(<WatchHomePage model={verticalPoolModel()} />)
    })

    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("aria-label"),
    ).toBe("Portrait One")

    const video = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    defineVideoSize(video, 1080, 1920)

    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"))
    })

    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("aria-label"),
    ).toBe("Landscape One")
    expect(readWatchHomeVerticalVideoIds()).toEqual(["portrait-1"])

    // A later visit draws from the same pool and must not land on it again.
    await act(async () => {
      root.render(<WatchHomePage model={verticalPoolModel()} />)
    })
    const secondContainer = document.createElement("div")
    document.body.appendChild(secondContainer)
    const secondRoot = createRoot(secondContainer)
    await act(async () => {
      secondRoot.render(<WatchHomePage model={verticalPoolModel()} />)
    })
    expect(
      secondContainer
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("aria-label"),
    ).toBe("Landscape One")
    await act(async () => {
      secondRoot.unmount()
    })
    secondContainer.remove()
  })

  it("resumes after a mid-sequence portrait video instead of jumping backwards", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            carousel: {
              pools: [
                {
                  id: "pool-a",
                  collectionIds: ["pool-a"],
                  videos: [
                    makeCarouselSlide({
                      id: "landscape-1",
                      title: "Landscape One",
                    }),
                    makeCarouselSlide({
                      id: "portrait-2",
                      title: "Portrait Two",
                      src: "https://stream.example/portrait-two.m3u8",
                    }),
                    makeCarouselSlide({
                      id: "landscape-3",
                      title: "Landscape Three",
                      src: "https://stream.example/landscape-three.m3u8",
                    }),
                  ],
                },
              ],
            },
          })}
        />,
      )
    })

    const label = () =>
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("aria-label")

    expect(label()).toBe("Landscape One")

    await act(async () => {
      container
        .querySelector('button[aria-label="Show Portrait Two"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(label()).toBe("Portrait Two")

    const video = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    defineVideoSize(video, 1080, 1920)
    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"))
    })

    // Dropping the slide from the queue is not enough on its own: the active
    // id stops resolving and the hero would fall back to the first slide,
    // replaying something the visitor already saw.
    expect(label()).toBe("Landscape Three")
  })

  it("keeps a landscape video and records nothing", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    await act(async () => {
      root.render(<WatchHomePage model={verticalPoolModel()} />)
    })

    const video = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    defineVideoSize(video, 1920, 1080)

    await act(async () => {
      video.dispatchEvent(new Event("loadedmetadata"))
    })

    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("aria-label"),
    ).toBe("Portrait One")
    expect(readWatchHomeVerticalVideoIds()).toEqual([])
  })

  it("stops skipping when every video in the pool measures portrait", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            carousel: {
              pools: [
                {
                  id: "pool-a",
                  collectionIds: ["pool-a"],
                  videos: [
                    makeCarouselSlide({ id: "portrait-1", title: "P1" }),
                    makeCarouselSlide({ id: "portrait-2", title: "P2" }),
                  ],
                },
              ],
            },
          })}
        />,
      )
    })

    for (let attempt = 0; attempt < 6; attempt++) {
      const video = container.querySelector(
        '[data-testid="watch-home-tv-video"]',
      ) as HTMLVideoElement | null
      if (!video) break
      defineVideoSize(video, 1080, 1920)
      await act(async () => {
        video.dispatchEvent(new Event("loadedmetadata"))
      })
    }

    // The hero still renders something rather than emptying or looping.
    expect(
      container.querySelector('[data-testid="watch-home-tv-carousel"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="watch-home-tv-video"]'),
    ).not.toBeNull()
  })

  it("falls back to the hero slides when the video pools are empty", async () => {
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            carousel: {
              pools: [],
            },
          })}
        />,
      )
    })

    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"]')
        ?.getAttribute("aria-label"),
    ).toBe("Jesus")
    expect(container.textContent).not.toContain("Today's Video Picks")
    expect(container.textContent).not.toContain("Watch Short Film")
    expect(
      container.querySelector('[data-testid="watch-home-tv-rail"]'),
    ).toBeNull()
  })
  // jsdom has no layout engine, so these two cases can only pin the classes
  // and inline background that produce the geometry — the rendered geometry
  // itself (full-bleed media, 1920px copy rail, visible dim) was verified in a
  // real browser against the watch-page hero it is matching.
  it("dims the muted intro with the watch-page hero scrim and drops it on unmute", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    const backdrop = container.querySelector(
      '[data-testid="watch-home-tv-muted-backdrop"]',
    ) as HTMLElement
    const unmutedScrims = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          '[data-testid="watch-home-tv-unmuted-scrim"]',
        ),
      )

    // Same constant HeroPlayer paints over its own muted preview — the whole
    // point of the change is that the two surfaces cannot drift apart.
    expect(backdrop.getAttribute("style")).toContain(
      WATCH_PRODUCTION_PLAYER_OVERLAY_BACKGROUND,
    )
    expect(backdrop.className).toContain(
      "[background:var(--watch-player-muted-backdrop)]",
    )
    expect(backdrop.className).toContain("opacity-100")
    expect(backdrop.className).not.toContain("opacity-0")
    expect(unmutedScrims()).toHaveLength(2)
    for (const scrim of unmutedScrims()) {
      expect(scrim.className).toContain("opacity-0")
    }

    await act(async () => {
      container
        .querySelector('button[aria-label="Unmute preview"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(backdrop.className).toContain("opacity-0")
    expect(backdrop.className).not.toContain("opacity-100")
    for (const scrim of unmutedScrims()) {
      expect(scrim.className).toContain("opacity-100")
    }
  })

  it("reserves room for the categories rail while muted and expands on unmute", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    const heroFrame = (
      container.querySelector(
        '[data-testid="watch-home-tv-media-frame"]',
      ) as HTMLElement
    ).parentElement as HTMLElement

    // Pre-hydration height reserves room for the categories rail at both
    // breakpoints, using the same constants the measured fit falls back to.
    // Tailwind cannot interpolate, so the literals in the class are pinned
    // against the constants here.
    expect(heroFrame.className).toContain(
      `h-[max(34svh,calc(100svh_-_${WATCH_HOME_HERO_RESERVE_BELOW_MOBILE_PX}px))]`,
    )
    expect(heroFrame.className).toContain(
      `md:h-[max(34svh,min(56.25vw,calc(100svh_-_${WATCH_HOME_HERO_RESERVE_BELOW_PX}px)))]`,
    )
    expect(heroFrame.className).not.toContain("md:h-[min(100svh,56.25vw)]")

    await act(async () => {
      container
        .querySelector('button[aria-label="Unmute preview"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(heroFrame.className).toContain("md:h-[min(100svh,56.25vw)]")
    expect(heroFrame.className).toContain("h-[66svh]")
    // Unmuting drops both the reservation and any measured fit: the viewer is
    // watching, so the intro takes its full height.
    expect(heroFrame.className).not.toContain("100svh_-_")
    expect(heroFrame.style.height).toBe("")
  })

  it("shrinks the muted intro to the measured height of the rail below it", async () => {
    // WatchHomePage has no categories rail of its own (that block belongs to
    // the Experience page), and jsdom reports 0 for every rect — so both the
    // rail and its height are stood in for here. What this pins is the rule:
    // the measured height reaches the element as an inline height, beating the
    // pre-hydration class, and leaves the rail inside the viewport.
    const railHeight = 425
    const rail = document.createElement("div")
    rail.dataset.testid = "watch-home-category-rail"
    // The fit reserves the span from the body zone's top to the rail's BOTTOM,
    // so an authored block between them is counted too — a height-only stub
    // would leave that span NaN.
    rail.getBoundingClientRect = () =>
      ({ top: 0, bottom: railHeight, height: railHeight }) as DOMRect
    document.body.appendChild(rail)
    const originalMatchMedia = window.matchMedia
    // jsdom's window is shared across this file: leaving these overridden
    // leaks a fake viewport into every later test.
    const originalInnerHeight = window.innerHeight
    const originalInnerWidth = window.innerWidth
    window.matchMedia = ((query: string) => ({
      matches: query === "(min-width: 768px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 1202,
    })
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 2001,
    })

    try {
      await act(async () => {
        root.render(<WatchHomePage model={makeSequencedModel()} />)
      })
      // The first measurement is scheduled on a frame, not run synchronously
      // in the effect body (which would cascade a render).
      await act(async () => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => resolve(null)),
        )
      })

      const heroFrame = (
        container.querySelector(
          '[data-testid="watch-home-tv-media-frame"]',
        ) as HTMLElement
      ).parentElement as HTMLElement

      const expected = fitWatchHomeHeroHeight({
        viewportHeight: 1202,
        aspectHeight: Math.min(1202, 2001 * 0.5625),
        reservedBelow: railHeight,
      })
      expect(heroFrame.style.height).toBe(`${expected}px`)
      // The whole point: the rail fits under it. Before this rule the intro
      // was 864px tall here and the rail ran 87px past the fold.
      expect(expected + railHeight).toBeLessThanOrEqual(1202)
      expect(expected).toBeLessThan(864)
    } finally {
      window.matchMedia = originalMatchMedia
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      })
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      })
      rail.remove()
    }
  })

  it("posters the intro from the Mux frame, not the mobile-sized authored image", async () => {
    // makeModel() has no carousel pools, so the component builds its slides
    // through `watchHomeHeroSlidesToTvCarouselSlides` — the path under test.
    await act(async () => {
      root.render(<WatchHomePage model={makeModel()} />)
    })

    const poster = (
      container.querySelector(
        '[data-testid="watch-home-tv-visual-layer"] [role="img"]',
      ) as HTMLElement
    ).dataset.src
    const video = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement

    // The admin library stores mobile derivatives for these videos — measured
    // 640x300 — which this full-bleed surface upscales about fourfold. The Mux
    // frame is 1280x720 from the derivative the watch hero already warms.
    expect(poster).toBe(resolveMuxHeroPosterUrlAtMaxWidth("mux-1"))
    expect(poster).not.toContain("cdn.example")
    expect(video.getAttribute("poster")).toBe(poster)
  })

  it.each([
    [
      "no playback id, authored image present",
      { playbackId: null },
      "https://cdn.example/jesus.jpg",
    ],
    [
      "playback id present, authored image blank",
      { imageUrl: "" },
      "https://image.mux.com/",
    ],
  ])(
    "falls the intro poster through to the next tier — %s",
    async (_label, overrides, expectedPrefix) => {
      await act(async () => {
        root.render(
          <WatchHomePage
            model={makeModel({
              heroSlides: [
                { ...makeCard(), eyebrow: "Featured", ...overrides },
              ],
            })}
          />,
        )
      })

      const poster = (
        container.querySelector(
          '[data-testid="watch-home-tv-visual-layer"] [role="img"]',
        ) as HTMLElement
      ).dataset.src

      // A blank authored image must neither win its tier NOR suppress the Mux
      // tier below it — `??` would do both.
      expect(poster).toContain(expectedPrefix)
    },
  )

  it("renders no poster at all when every tier is blank or absent", async () => {
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            heroSlides: [
              {
                ...makeCard(),
                eyebrow: "Featured",
                playbackId: null,
                imageUrl: "",
              },
            ],
          })}
        />,
      )
    })

    // The gradient placeholder, never an <img src="">.
    expect(
      container.querySelector(
        '[data-testid="watch-home-tv-visual-layer"] [role="img"]',
      ),
    ).toBeNull()
  })

  it("re-pauses a slide that starts playing while the body already covers it", async () => {
    // The carousel advances on a wall-clock timer and starts the new <video> a
    // beat later. If that lands while the hero is covered, the fresh element is
    // momentarily paused, so the covered branch must not read it as "someone
    // else paused this" and walk away — the video would then play, unseen and
    // audible, behind the panel until the next coverage change.
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    const media = container.querySelector(
      '[data-testid="watch-home-tv-media-frame"]',
    ) as HTMLElement
    const bodyZone = container.querySelector(
      '[data-testid="watch-home-body-zone"]',
    ) as HTMLElement
    const video = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    const frame = media.parentElement as HTMLElement
    frame.getBoundingClientRect = () =>
      ({ top: 0, bottom: 500, height: 500 }) as DOMRect

    const pause = vi.fn(() => {
      Object.defineProperty(video, "paused", {
        configurable: true,
        value: true,
      })
    })
    video.pause = pause
    video.play = (() => Promise.resolve()) as HTMLVideoElement["play"]

    // Covered, and the fresh slide has not started yet.
    Object.defineProperty(video, "paused", { configurable: true, value: true })
    bodyZone.getBoundingClientRect = () =>
      ({ top: 100, bottom: 100, height: 0 }) as DOMRect
    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(pause).not.toHaveBeenCalled()

    // The carousel now starts it. Coverage has not changed, so only the
    // element's own `play` can re-open the check.
    Object.defineProperty(video, "paused", { configurable: true, value: false })
    await act(async () => {
      video.dispatchEvent(new Event("play"))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it("keeps pause ownership honest across a StrictMode remount", async () => {
    // StrictMode remounts the SAME hook instance, so pausedByScrollRef survives
    // the cleanup. A stale `true` carried into the new mount would resume a
    // video the viewer had paused themselves. This suite is the repo's only
    // deterministic detector for that shape.
    await act(async () => {
      root.render(
        <StrictMode>
          <WatchHomePage model={makeSequencedModel()} />
        </StrictMode>,
      )
    })

    const media = container.querySelector(
      '[data-testid="watch-home-tv-media-frame"]',
    ) as HTMLElement
    const bodyZone = container.querySelector(
      '[data-testid="watch-home-body-zone"]',
    ) as HTMLElement
    const video = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    const frame = media.parentElement as HTMLElement
    frame.getBoundingClientRect = () =>
      ({ top: 0, bottom: 500, height: 500 }) as DOMRect

    const play = vi.fn(() => Promise.resolve())
    video.play = play as unknown as HTMLVideoElement["play"]
    video.pause = vi.fn()
    // The viewer paused it themselves, uncovered.
    Object.defineProperty(video, "paused", { configurable: true, value: true })
    bodyZone.getBoundingClientRect = () =>
      ({ top: 500, bottom: 500, height: 0 }) as DOMRect

    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

    // Nothing here paused it, so nothing here may start it.
    expect(play).not.toHaveBeenCalled()
  })

  it("does not pin an intro that is rendered unpinned", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    // The home shell always pins; the unpinned path is the authored hero block
    // placed mid-page, covered in WatchHomeExperiencePage.test.tsx.
    const carousel = container.querySelector(
      '[data-testid="watch-home-tv-carousel"]',
    ) as HTMLElement
    expect(carousel.dataset.pinned).toBe("true")
    expect(carousel.className).toContain("sticky")
  })

  it("dresses the intro copy in the watch page's own hero overlay", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    const title = container.querySelector(
      '[data-testid="watch-home-tv-active-title"]',
    ) as HTMLElement
    const action = container.querySelector(
      '[data-testid="watch-home-tv-actions"] a',
    ) as HTMLAnchorElement

    // Both surfaces render WatchHeroOverlay, so the title and the primary
    // action carry its classes rather than a home-only copy of them.
    for (const token of WATCH_HERO_TITLE_CLASS.split(" ")) {
      expect(title.className).toContain(token)
    }
    for (const token of WATCH_HERO_PRIMARY_ACTION_CLASS.split(" ")) {
      expect(action.className).toContain(token)
    }
    // The bespoke sizing the home hero used to carry is gone.
    expect(title.className).not.toContain("font-extrabold")
    expect(title.className).not.toContain("text-3xl")
    expect(action.className).not.toContain(
      "shadow-[0_14px_32px_rgba(0,0,0,0.34)]",
    )
  })

  it("gives the hero eyebrow the shared Watch section eyebrow styling", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    const eyebrow = (
      container.querySelector(
        '[data-testid="watch-home-tv-active-title"]',
      ) as HTMLElement
    ).previousElementSibling as HTMLElement

    expect(eyebrow.textContent).toBe("Short Film")
    // The same class every other Watch section eyebrow uses ("BROWSE THE
    // LIBRARY" and friends) rather than a bespoke amber one.
    for (const token of WATCH_SECTION_EYEBROW_CLASS.split(" ")) {
      expect(eyebrow.className).toContain(token)
    }
    expect(eyebrow.className).not.toContain("text-amber-300")
    expect(eyebrow.className).not.toContain("tracking-[0.24em]")
  })

  it("runs the muted video on below the frame, behind the panel covering it", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    const media = container.querySelector(
      '[data-testid="watch-home-tv-media-frame"]',
    ) as HTMLElement

    // Same length a watch page's body rides up over its hero by — there the
    // body carries the negative margin, here the media reaches down instead.
    expect(media.getAttribute("style")).toContain(WATCH_HERO_BODY_OVERLAP_CSS)
    expect(media.className).toContain(
      "bottom-[calc(-1_*_var(--watch-hero-body-overlap))]",
    )
    expect(media.className).toContain("top-0")
    expect(media.className).not.toContain("inset-y-0")

    await act(async () => {
      container
        .querySelector('button[aria-label="Unmute preview"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    // Unmuting pulls it back to the frame, the way revealing a hero's chrome
    // drops its overlap to zero.
    expect(media.className).toContain("bottom-0")
    expect(media.className).not.toContain("var(--watch-hero-body-overlap)")
  })

  it("pins the intro and lets the body zone scroll over it", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    const hero = container.querySelector(
      '[data-testid="watch-home-tv-carousel"]',
    ) as HTMLElement
    const bodyZone = container.querySelector(
      '[data-testid="watch-home-body-zone"]',
    ) as HTMLElement

    expect(hero.className).toContain("sticky")
    expect(hero.className).toContain("top-0")
    // The zone that covers the hero must not contain it, or it would scroll
    // with it and never cover anything.
    expect(bodyZone.contains(hero)).toBe(false)
    expect(hero.nextElementSibling).toBe(bodyZone)
    // Same glass panel the watch page's body zone uses, and full-bleed for the
    // same reason the media is: a 1920px panel leaves the pinned video showing
    // down both sides of a wider screen.
    expect(bodyZone.className).toContain("watch-body-backdrop")
    expect(bodyZone.className).toContain("backdrop-blur-2xl")
    expect(bodyZone.className).toContain("w-screen")
    expect(bodyZone.className).toContain("z-10")
  })

  it("pauses the pinned intro once the body covers it, and resumes on the way back", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    const hero = container.querySelector(
      '[data-testid="watch-home-tv-carousel"]',
    ) as HTMLElement
    const bodyZone = container.querySelector(
      '[data-testid="watch-home-body-zone"]',
    ) as HTMLElement
    const video = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    const media = container.querySelector(
      '[data-testid="watch-home-tv-media-frame"]',
    ) as HTMLElement

    // jsdom has no layout and no media pipeline: every rect is 0 and `paused`
    // is permanently true, so the geometry and the play state are both stood
    // in for here. The real pin/cover/pause sequence was driven in a browser.
    const pause = vi.fn(() => {
      Object.defineProperty(video, "paused", {
        configurable: true,
        value: true,
      })
    })
    const play = vi.fn(() => {
      Object.defineProperty(video, "paused", {
        configurable: true,
        value: false,
      })
      return Promise.resolve()
    })
    video.pause = pause
    video.play = play as unknown as HTMLVideoElement["play"]
    Object.defineProperty(video, "paused", { configurable: true, value: false })

    const setBodyTop = (top: number) => {
      bodyZone.getBoundingClientRect = () =>
        ({ top, bottom: top, height: 0 }) as DOMRect
    }
    // The hero is pinned at the viewport top and 500px tall, so the body has
    // to climb above 200px (60% covered) before the video pauses.
    //
    // Only the sized FRAME carries that rect. The media layer deliberately
    // reaches lower while muted, and measuring it would move the crossover —
    // so it is stubbed taller here on purpose, and every assertion below is
    // against the 500px frame.
    const frame = media.parentElement as HTMLElement
    frame.getBoundingClientRect = () =>
      ({ top: 0, bottom: 500, height: 500 }) as DOMRect
    media.getBoundingClientRect = () =>
      ({ top: 0, bottom: 838, height: 838 }) as DOMRect
    hero.getBoundingClientRect = () =>
      ({ top: 0, bottom: 500, height: 500 }) as DOMRect

    setBodyTop(300)
    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(pause).not.toHaveBeenCalled()

    setBodyTop(150)
    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(pause).toHaveBeenCalledTimes(1)

    setBodyTop(500)
    await act(async () => {
      window.dispatchEvent(new Event("scroll"))
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(play).toHaveBeenCalledTimes(1)
  })

  it("bleeds the intro media past the content rail without clipping ancestors", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeSequencedModel()} />)
    })

    const mediaFrame = container.querySelector(
      '[data-testid="watch-home-tv-media-frame"]',
    ) as HTMLElement
    expect(mediaFrame.className).toContain("w-screen")
    expect(mediaFrame.className).toContain("-translate-x-1/2")
    expect(mediaFrame.className).toContain("max-w-none")

    // The bleed is only visible while every ancestor up to <main> leaves it
    // unclipped; an `overflow-hidden`/`overflow-x-clip` re-added anywhere on
    // this chain silently snaps the hero back to the 1920px rail.
    const clippingAncestors: string[] = []
    for (
      let node = mediaFrame.parentElement;
      node && node !== container;
      node = node.parentElement
    ) {
      if (/overflow-(hidden|x-clip|x-hidden)/.test(node.className)) {
        clippingAncestors.push(node.className)
      }
    }
    expect(clippingAncestors).toEqual([
      // <main> keeps its clip so the 100vw span never adds page scroll.
      // Clip, not hidden: hidden would make <main> a scroll container and
      // break the sticky hero.
      "min-h-screen overflow-x-clip bg-black text-white",
    ])

    // The copy stays on the 1920px rail the rest of the page uses.
    const railFrame = mediaFrame.parentElement as HTMLElement
    expect(railFrame.className).toContain("max-w-[1920px]")
    expect(
      railFrame.querySelector('[data-testid="watch-home-tv-active-title"]'),
    ).not.toBeNull()
  })
})
