/**
 * @vitest-environment jsdom
 */

import { act, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WatchHomeModel } from "@/lib/watch-home"
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

let container: HTMLDivElement
let root: Root

beforeEach(() => {
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
})
