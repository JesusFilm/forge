/**
 * @vitest-environment jsdom
 */

import { act, useEffect, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { setRequestLocale } from "next-intl/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WatchHomeMuxInsertConfig } from "@/lib/watch-home-config"
import { WATCH_HOME_MUX_INSERTS } from "@/lib/watch-home-config"
import type { WatchHomeModel } from "@/lib/watch-home"
import type { WatchHomeTvCarouselVideoSlide } from "@/lib/watch-home-carousel-sequence"
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
    description: "The story of Jesus",
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
      muxInserts: [],
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
    description: "Queued from the playlist pool",
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

const muxInsert = {
  id: "welcome-start",
  copyId: "welcomeStart",
  enabled: true,
  playbackIds: ["mux-welcome"],
  durationSeconds: 9,
  action: null,
  logo: true,
  posterOverride: null,
  trigger: { type: "sequence-start" },
} satisfies WatchHomeMuxInsertConfig

const ctaMuxInsert = {
  ...muxInsert,
  id: "join-us",
  copyId: "joinUs",
  playbackIds: ["mux-join"],
  action: {
    copyId: "joinUs",
    url: "https://example.com/join",
    icon: "join",
  },
} satisfies WatchHomeMuxInsertConfig

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

  it("localizes a configured Mux insert and its actions in Russian", async () => {
    setRequestLocale("ru")
    const joinUsInsert = WATCH_HOME_MUX_INSERTS.find(
      (insert) => insert.id === "join-us",
    )
    if (!joinUsInsert) throw new Error("Expected the Join Us Mux insert")

    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            carousel: {
              pools: [
                {
                  id: "pool-a",
                  collectionIds: ["pool-a"],
                  videos: [makeCarouselSlide()],
                },
              ],
              muxInserts: [joinUsInsert],
            },
          })}
        />,
      )
    })

    const muxCard = Array.from(
      container.querySelectorAll('[data-testid="watch-home-tv-carousel-card"]'),
    ).find((card) => card.textContent?.includes("Миллиарды людей ищут ответы"))
    expect(muxCard?.textContent).toContain("Присоединяйтесь к нам")

    await act(async () => {
      muxCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).toContain(
      "Жатва уже созрела. Присоединяйтесь к нам, чтобы с помощью цифровых медиа делиться Евангелием со всем миром.",
    )
    expect(
      container.querySelector('a[href="https://your.nextstep.is/joinus"]')
        ?.textContent,
    ).toContain("Присоединиться")
    expect(container.textContent).toContain("Смотреть короткометражный фильм")
    expect(container.textContent).not.toContain("Billions are searching")
    expect(container.textContent).not.toContain("Watch Short Film")
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
    const slideTitle = Array.from(carousel?.querySelectorAll("h2") ?? []).find(
      (heading) => heading.textContent === "Jesus",
    )
    expect(slideTitle?.tagName).toBe("H2")
    expect(slideTitle?.textContent).toBe("Jesus")
    expect(carousel?.querySelectorAll("h1")).toHaveLength(1)
    expect(carousel?.querySelector("h1")?.textContent).toBe(
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
        .querySelector('[data-testid="watch-home-tv-rail"]')
        ?.getAttribute("class"),
    ).not.toContain("h-[var")
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
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="watch-home-tv-media-frame"]'),
    ).not.toBeNull()
    expect(container.textContent).toContain("Jesus")
    expect(container.textContent).toContain("The story of Jesus")
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

  it("renders the sequenced Mux and playlist slides in the rail and scrolls the active card into the lead position", async () => {
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
                    }),
                  ],
                },
              ],
              muxInserts: [ctaMuxInsert],
            },
          })}
        />,
      )
    })

    expect(container.textContent).toContain("Join Us")
    expect(container.textContent).toContain("Queued One")
    expect(
      container.querySelectorAll('[data-testid="watch-home-tv-carousel-card"]'),
    ).toHaveLength(3)
    expect(
      container.querySelector('[data-testid="watch-home-tv-carousel-card"]')
        ?.textContent,
    ).toContain("Join Us")
    const heroRailCards = Array.from(
      container.querySelectorAll('[data-testid="watch-home-tv-carousel-card"]'),
    )
    const queuedTwoIndex = heroRailCards.findIndex((element) =>
      element.textContent?.includes("Queued Two"),
    )
    const queuedTwoCard = heroRailCards[queuedTwoIndex]
    expect(queuedTwoCard).not.toBeUndefined()
    const primaryCta = container.querySelector(
      'a[href="https://example.com/join"]',
    )
    expect(primaryCta?.textContent).toContain("Join Us")
    expect(
      container.querySelector('[data-testid="watch-home-share-button"]'),
    ).toBeNull()
    const shortFilmButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Watch Short Film"))
    expect(shortFilmButton).not.toBeUndefined()
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined)
    const heroVideo = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    expect(heroVideo.hasAttribute("controls")).toBe(false)
    expect(
      document.body.querySelector('[data-testid="hero-player-custom-chrome"]'),
    ).toBeNull()
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
      shortFilmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(playSpy).toHaveBeenCalled()
    expect(heroVideo.hasAttribute("controls")).toBe(false)
    expect(heroVideo.className).toContain("watch-home-player-enter")
    expect(
      document.body.querySelector('[data-testid="hero-player-custom-chrome"]'),
    ).toBeNull()
    expect(container.textContent).toContain("Watch Short Film")

    await act(async () => {
      heroVideo.dispatchEvent(new Event("ended", { bubbles: true }))
    })

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 380))
    })

    expect(
      document.body.querySelector('[data-testid="hero-player-custom-chrome"]'),
    ).not.toBeNull()
    expect(
      document.body.querySelector('[data-testid="hero-chrome-timeline"]'),
    ).not.toBeNull()
    expect(
      container.querySelectorAll('[data-testid="watch-home-tv-visual-layer"]'),
    ).toHaveLength(0)
    expect(chromeVisibilityEvents).toContainEqual({
      visible: true,
      opacity: 1,
    })
    expect(heroVideo.muted).toBe(false)
    expect(heroVideo.getAttribute("src")).toBe(
      "https://stream.mux.com/mux-join.m3u8",
    )

    expect(container.textContent).not.toContain("Watch Short Film")
    expect(
      container.querySelector('button[aria-label="Next video"]'),
    ).toBeNull()
    expect(
      container.querySelector('button[aria-label="Back to carousel"]'),
    ).toBeNull()
    window.removeEventListener(
      WATCH_PLAYER_CHROME_VISIBILITY_EVENT,
      handleChromeVisibility,
    )

    const railCards = Array.from(
      container.querySelectorAll('[data-testid="watch-home-tv-carousel-card"]'),
    )
    const queuedOneCard = railCards.find((element) =>
      element.textContent?.includes("Queued One"),
    )
    expect(queuedOneCard).not.toBeUndefined()
    const queuedOneIndex = queuedOneCard ? railCards.indexOf(queuedOneCard) : -1

    await act(async () => {
      queuedOneCard?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(carouselApi.scrollTo).toHaveBeenCalledWith(queuedOneIndex)
    expect(
      document.body.querySelector('[data-testid="hero-player-custom-chrome"]'),
    ).toBeNull()
    expect(
      container.querySelectorAll('[data-testid="watch-home-tv-visual-layer"]')
        .length,
    ).toBeGreaterThan(0)
    const updatedHeroVideo = container.querySelector(
      '[data-testid="watch-home-tv-video"]',
    ) as HTMLVideoElement
    expect(updatedHeroVideo.getAttribute("src")).toBe(
      "https://stream.example/queued-one.m3u8",
    )
    expect(
      container.querySelector('button[aria-label="Next video"]'),
    ).not.toBeNull()

    const updatedQueuedTwoCard = Array.from(
      container.querySelectorAll('[data-testid="watch-home-tv-carousel-card"]'),
    ).find((element) => element.textContent?.includes("Queued Two"))
    expect(updatedQueuedTwoCard).not.toBeUndefined()

    await act(async () => {
      updatedQueuedTwoCard?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      )
    })

    expect(carouselApi.scrollTo).toHaveBeenCalledWith(queuedTwoIndex)
    expect(
      Array.from(
        container.querySelectorAll('[data-slot="carousel-item"]'),
      ).some(
        (element) =>
          (element.getAttribute("class") ?? "").includes("md:basis-1/3") &&
          (element.getAttribute("class") ?? "").includes("lg:basis-1/4"),
      ),
    ).toBe(true)
    const heroRailCard = container.querySelector(
      '[data-testid="watch-home-tv-carousel-card"]',
    )
    expect(heroRailCard?.getAttribute("class")).toContain("md:w-full")
    expect(heroRailCard?.getAttribute("class")).not.toContain("hover:scale")
    expect(heroRailCard?.getAttribute("class")).toContain(
      "focus-visible:outline-none",
    )
    expect(heroRailCard?.getAttribute("class")).toContain(
      "focus-visible:opacity-95",
    )
    expect(
      heroRailCard?.querySelector('[data-testid="watch-home-tv-card-bevel"]'),
    ).not.toBeNull()
    expect(
      heroRailCard?.querySelector(
        '[data-testid="watch-home-tv-card-hover-outline"]',
      ),
    ).not.toBeNull()
    const heroRailHoverOutline = heroRailCard?.querySelector(
      '[data-testid="watch-home-tv-card-hover-outline"]',
    )
    expect(heroRailHoverOutline?.getAttribute("class")).toContain("inset-0")
    expect(heroRailHoverOutline?.getAttribute("class")).toContain("z-[80]")
    expect(heroRailHoverOutline?.getAttribute("class")).toContain(
      "rounded-[inherit]",
    )
    expect(heroRailHoverOutline?.getAttribute("class")).toContain("border-4")
    expect(heroRailHoverOutline?.getAttribute("class")).toContain(
      "border-white",
    )
    expect(heroRailHoverOutline?.getAttribute("class")).not.toContain(
      "watch-home-gradient-outline",
    )
    expect(heroRailHoverOutline?.getAttribute("class")).not.toContain(
      "shadow-[0_-4px_22px_rgba(239,68,68,0.26)]",
    )
    expect(heroRailHoverOutline?.querySelector("svg")).toBeNull()
    expect(
      heroRailCard?.querySelectorAll(
        '[data-testid="watch-home-tv-card-hover-outline"] span',
      ),
    ).toHaveLength(0)
    const activeHeroRailCard = container.querySelector(
      '[data-testid="watch-home-tv-carousel-card"][aria-pressed="true"]',
    )
    const activeHeroRailInteractionFrame = activeHeroRailCard?.querySelector(
      '[data-testid="watch-home-tv-card-hover-outline"]',
    )
    expect(activeHeroRailInteractionFrame?.getAttribute("class")).toContain(
      "opacity-0",
    )
    expect(activeHeroRailInteractionFrame?.getAttribute("class")).not.toContain(
      "group-hover:opacity-100",
    )
    expect(activeHeroRailInteractionFrame?.getAttribute("class")).not.toContain(
      "group-focus-visible:opacity-100",
    )
    expect(
      activeHeroRailCard
        ?.querySelector('[data-testid="watch-home-tv-card-active-outline"]')
        ?.getAttribute("class"),
    ).toContain("opacity-100")
    expect(
      heroRailCard?.querySelector('[role="img"]')?.getAttribute("class"),
    ).toContain("group-hover:scale-105")
    const standardCard = container
      .querySelector('[data-testid="watch-home-card-bevel"]')
      ?.closest("a")
    expect(standardCard?.getAttribute("class")).not.toContain("hover:scale")
    expect(
      standardCard?.querySelector('[data-testid="watch-home-card-bevel"]'),
    ).not.toBeNull()
    expect(
      standardCard?.querySelector(
        '[data-testid="watch-home-card-hover-outline"]',
      ),
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
    expect(
      container.querySelector('[data-slot="carousel"]')?.getAttribute("class"),
    ).toContain("-mx-5")
    expect(
      container
        .querySelector('[data-slot="carousel"]')
        ?.getAttribute("data-loop"),
    ).toBe("true")
    expect(
      container
        .querySelector('[data-slot="carousel-content"]')
        ?.getAttribute("class"),
    ).toContain("overflow-x-visible md:overflow-x-clip")
    expect(
      container.querySelector('button[aria-label="Previous video preview"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('button[aria-label="Next video preview"]'),
    ).not.toBeNull()
    expect(
      container
        .querySelector('button[aria-label="Previous video preview"]')
        ?.getAttribute("class"),
    ).not.toContain("left-6")
    expect(
      container
        .querySelector('button[aria-label="Previous video preview"]')
        ?.getAttribute("class"),
    ).not.toContain("h-12")
    expect(
      container
        .querySelector('button[aria-label="Previous video preview"]')
        ?.getAttribute("class"),
    ).toContain("text-stone-900")
    expect(
      container
        .querySelector('button[aria-label="Next video preview"]')
        ?.getAttribute("class"),
    ).not.toContain("right-6")
    expect(
      container
        .querySelector('button[aria-label="Next video preview"]')
        ?.getAttribute("class"),
    ).not.toContain("h-12")
    expect(
      container
        .querySelector('button[aria-label="Next video preview"]')
        ?.getAttribute("class"),
    ).toContain("text-stone-900")
  })

  it("keeps configured Mux inserts when the video queue is empty", async () => {
    await act(async () => {
      root.render(
        <WatchHomePage
          model={makeModel({
            carousel: {
              pools: [],
              muxInserts: [muxInsert],
            },
          })}
        />,
      )
    })

    expect(container.textContent).toContain("Today's Video Picks")
    expect(container.textContent).not.toContain("Watch Short Film")
    expect(
      container.querySelectorAll('[data-testid="watch-home-tv-carousel-card"]'),
    ).toHaveLength(1)
  })
})
