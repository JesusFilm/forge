/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WatchHomeMuxInsertConfig } from "@/lib/watch-home-config"
import type { WatchHomeModel } from "@/lib/watch-home"
import type { WatchHomeTvCarouselVideoSlide } from "@/lib/watch-home-carousel-sequence"
import { WatchHomePage } from "@/components/home/WatchHomePage"

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span role="img" aria-label={alt} data-src={src} />
  ),
}))

vi.mock("@forge/video-player/mux-video", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  return {
    default: React.forwardRef<HTMLVideoElement, { src?: string }>(
      function MockMuxVideo({ src }, ref) {
        return <video ref={ref} data-testid="watch-home-tv-video" src={src} />
      },
    ),
  }
})

vi.mock("@/components/ui/carousel", () => ({
  Carousel: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  CarouselContent: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
  CarouselItem: ({
    children,
    className,
  }: {
    children: ReactNode
    className?: string
  }) => <div className={className}>{children}</div>,
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
    imageAlt: "Jesus still",
    hls: "https://stream.example/jesus.m3u8",
    playbackId: "mux-1",
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
    durationSeconds: 10,
    ...overrides,
  }
}

const muxInsert = {
  id: "welcome-start",
  enabled: true,
  playbackIds: ["mux-welcome"],
  durationSeconds: 9,
  label: "Faith & Scripture",
  title: "Daily Start",
  collectionTitle: null,
  description: "A Mux intro",
  action: null,
  logo: true,
  posterOverride: null,
  trigger: { type: "sequence-start" },
} satisfies WatchHomeMuxInsertConfig

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
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
  it("renders the hero, configured sections, promo content, and card links", async () => {
    await act(async () => {
      root.render(<WatchHomePage model={makeModel()} />)
    })

    expect(
      container.querySelector('[data-testid="watch-home-tv-carousel"]'),
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
    expect(container.textContent).toContain("Sign Up For Our Newsletter")
    expect(
      container.querySelector('[data-testid="watch-home-tv-video"]'),
    ).not.toBeNull()
    expect(
      container.querySelectorAll('button[aria-label="Next video"]'),
    ).toHaveLength(2)
    expect(
      container.querySelectorAll('button[aria-label="Unmute preview"]'),
    ).toHaveLength(2)
    expect(
      container.querySelectorAll("a[href='/jesus.html/english.html']"),
    ).toHaveLength(4)
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
    expect(
      JSON.parse(window.localStorage.getItem("carousel-played-ids") ?? "{}")
        .ids,
    ).toEqual(["1_jf-0-0"])
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
  })

  it("renders the sequenced Mux and playlist slides in the rail", async () => {
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
              muxInserts: [muxInsert],
            },
          })}
        />,
      )
    })

    expect(container.textContent).toContain("Daily Start")
    expect(container.textContent).toContain("Queued One")
    expect(
      container.querySelectorAll('[data-testid="watch-home-tv-carousel-card"]'),
    ).toHaveLength(3)
  })
})
