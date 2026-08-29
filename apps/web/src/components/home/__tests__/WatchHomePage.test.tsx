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
  buildWatchHomeVideoQueue,
  readWatchHomeTvPlayedIds,
  readWatchHomeVerticalVideoIds,
  type WatchHomeTvCarouselVideoSlide,
} from "@/lib/watch-home-carousel-sequence"
import {
  WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
  type WatchPlayerChromeVisibilityDetail,
} from "@/lib/watch-player-chrome-events"
import { WatchHomePage } from "@/components/home/WatchHomePage"

vi.mock("next/image", () => ({
  default: ({
    alt,
    className,
    src,
  }: {
    alt: string
    className?: string
    src: string
  }) => (
    <span role="img" aria-label={alt} className={className} data-src={src} />
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
    // The overlay copy block is exactly the eyebrow and the title. This is the
    // structural guard for the removed secondary paragraph: re-adding any copy
    // element beside them fails here.
    const copyBlock = activeTitle?.parentElement
    expect(
      Array.from(copyBlock?.children ?? []).map((el) => el.tagName),
    ).toEqual(["P", "P"])
    expect(copyBlock?.textContent).toBe("FeaturedJesus")
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
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"] > div')
        ?.getAttribute("class"),
    ).toContain("h-[66svh]")
    expect(
      container
        .querySelector('[data-testid="watch-home-tv-carousel"] > div')
        ?.getAttribute("class"),
    ).toContain("md:h-[min(100svh,56.25vw)]")
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
      container.querySelectorAll('button[aria-label="Next video"]'),
    ).toHaveLength(2)
    expect(
      container.querySelectorAll('[data-testid="watch-home-next-progress"]'),
    ).toHaveLength(2)
    expect(
      container.querySelectorAll('button[aria-label="Unmute preview"]'),
    ).toHaveLength(2)
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
    for (const fallback of container.querySelectorAll('[aria-label="Jesus"]')) {
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
                      src: "https://stream.example/queued-two.m3u8",
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

    await act(async () => {
      container
        .querySelector('button[aria-label="Next video"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

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
    expect(
      container.querySelector('button[aria-label="Next video"]'),
    ).not.toBeNull()

    // R2: with the secondary paragraph gone, the copy stagger runs
    // eyebrow -> title -> action with no dead beat where the paragraph used to
    // animate. Both the incoming and the outgoing overlay are checked, because
    // the enter and exit delay tables are indexed separately.
    // These two classes are applied only to the staggered overlay items, so
    // querying the carousel pins both the delays and the item count without
    // depending on how deeply the overlay nests them.
    const delaysFor = (className: string) =>
      Array.from(carousel?.querySelectorAll(`.${className}`) ?? []).map((el) =>
        (el as HTMLElement).style.getPropertyValue("--watch-home-copy-delay"),
      )
    // Entering runs offset by 430ms while the outgoing copy clears: 430+0/70/140.
    expect(delaysFor("watch-home-copy-enter")).toEqual([
      "430ms",
      "500ms",
      "570ms",
    ])
    expect(delaysFor("watch-home-copy-exit")).toEqual(["0ms", "35ms", "70ms"])

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
        .querySelector('button[aria-label="Next video"]')
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
})
