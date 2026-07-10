/**
 * @vitest-environment jsdom
 *
 * U2 — SeriesHero tests.
 *
 * The component branches between trailer-mode (delegates to HeroPlayer) and
 * static-mode (renders a sticky <Image> + scrim + overlay anchor + title
 * overlay). HeroPlayer + next/image are mocked at the module boundary so
 * the test isolates SeriesHero's branch logic and overlay structure
 * without re-exercising HeroPlayer's chrome reveal or Mux Player setup
 * (those have their own test suites).
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/watch/HeroPlayer", () => ({
  HeroPlayer: vi.fn(() => (
    <div data-testid="hero-player-mock" data-block-type="HeroPlayer" />
  )),
}))

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    fill: _fill,
    sizes: _sizes,
    priority: _priority,
    className,
  }: {
    src: string
    alt: string
    fill?: boolean
    sizes?: string
    priority?: boolean
    className?: string
  }) => (
    <div
      data-testid="next-image-mock"
      data-src={src}
      data-alt={alt}
      className={className}
    />
  ),
}))

import { SeriesHero } from "@/components/watch/SeriesHero"
import type { ResolvedSeriesBySlug } from "@/lib/content"

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

type Series = ResolvedSeriesBySlug["video"]
type SelectedVariant = ResolvedSeriesBySlug["selectedVariant"]

function makeSeries(overrides: Partial<Series> = {}): Series {
  return {
    documentId: "series-1",
    slug: "storyclubs",
    title: "StoryClubs",
    snippet: null,
    description: null,
    noIndex: false,
    label: "collection",
    imageAlt: null,
    images: [
      {
        url: "https://cdn.example/storyclubs.jpg",
        thumbnail: null,
        mobileCinematicHigh: "https://cdn.example/storyclubs.high.jpg",
        mobileCinematicLow: null,
      },
    ],
    primaryLanguage: { coreId: "529", bcp47: "en" },
    parents: [],
    children: [],
    variants: [],
    studyQuestions: [],
    bibleCitations: [],
    ...overrides,
  } as Series
}

function makeVariant(
  overrides: Partial<NonNullable<SelectedVariant>> = {},
): SelectedVariant {
  return {
    documentId: "variant-1",
    slug: "en",
    published: true,
    hls: "https://cdn.example/storyclubs.m3u8",
    duration: 30,
    language: { coreId: "529", bcp47: "en", slug: "english", name: "English" },
    downloads: [],
    muxVideo: { playbackId: "playback-id-storyclubs" },
    ...overrides,
  } as SelectedVariant
}

describe("SeriesHero — trailer mode (AE1)", () => {
  it("mounts HeroPlayer when selectedVariant has hls", () => {
    act(() => {
      root.render(
        <SeriesHero series={makeSeries()} selectedVariant={makeVariant()} />,
      )
    })
    expect(
      container.querySelector('[data-testid="hero-player-mock"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-testid="series-hero-static"]'),
    ).toBeNull()
  })
})

describe("SeriesHero — static mode (AE2, AE3 partial)", () => {
  it("renders the static image + scrim + overlay anchor when no playable variant", () => {
    act(() => {
      root.render(<SeriesHero series={makeSeries()} selectedVariant={null} />)
    })
    // No HeroPlayer mounted in static mode.
    expect(
      container.querySelector('[data-testid="hero-player-mock"]'),
    ).toBeNull()

    // Static-hero wrapper with sticky aspect-video.
    const wrapper = container.querySelector(
      '[data-testid="series-hero-static"]',
    )
    expect(wrapper).not.toBeNull()
    expect(wrapper?.className).toContain("sticky")
    expect(wrapper?.className).toContain("aspect-video")

    // Image rendered from series.images[0].mobileCinematicHigh (per
    // resolvePosterUrl's resolution chain).
    const image = container.querySelector('[data-testid="next-image-mock"]')
    expect(image).not.toBeNull()
    expect(image?.getAttribute("data-src")).toBe(
      "https://cdn.example/storyclubs.high.jpg",
    )
    // alt="" intentional — see SeriesHero.tsx comment.
    expect(image?.getAttribute("data-alt")).toBe("")

    // Overlay anchor rides the body section's scroll, same testid as
    // HeroPlayer's anchor for visual parity.
    expect(
      container.querySelector('[data-testid="hero-player-overlay-anchor"]'),
    ).not.toBeNull()

    // Title and label overlay rendered (no Watch now button — there's
    // nothing to play in static mode).
    expect(
      container.querySelector('[data-testid="series-hero-overlay-title"]')
        ?.textContent,
    ).toBe("StoryClubs")
    const title = container.querySelector(
      '[data-testid="series-hero-overlay-title"]',
    )
    expect(title?.getAttribute("class")).toContain("text-balance")
    expect(title?.getAttribute("class")).toContain("break-words")
    expect(title?.getAttribute("class")).toContain("max-w-[calc(100vw-5rem)]")
    expect(title?.getAttribute("class")).not.toContain("whitespace-nowrap")
    expect(
      container.querySelector('[data-testid="series-hero-overlay-label"]')
        ?.textContent,
    ).toBe("collection")
  })

  it("falls through to static mode when variant has muxVideo.playbackId but no hls", () => {
    // hls is the canonical playability discriminator (see Key Technical
    // Decisions). A variant with playbackId alone is treated as
    // unplayable — series page renders the static thumbnail.
    const variantWithoutHls = makeVariant({ hls: null })
    act(() => {
      root.render(
        <SeriesHero
          series={makeSeries()}
          selectedVariant={variantWithoutHls}
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="hero-player-mock"]'),
    ).toBeNull()
    expect(
      container.querySelector('[data-testid="series-hero-static"]'),
    ).not.toBeNull()
  })

  it("renders the wrapper without an <img> when series has no images", () => {
    act(() => {
      root.render(
        <SeriesHero
          series={makeSeries({ images: [] })}
          selectedVariant={null}
        />,
      )
    })
    // bg-black wrapper is still present (no broken layout).
    const wrapper = container.querySelector(
      '[data-testid="series-hero-static"]',
    )
    expect(wrapper).not.toBeNull()
    expect(wrapper?.className).toContain("bg-black")
    // No image attempted.
    expect(
      container.querySelector('[data-testid="next-image-mock"]'),
    ).toBeNull()
    // Title + label overlay still rendered (independent of the image).
    expect(
      container.querySelector('[data-testid="series-hero-overlay-title"]'),
    ).not.toBeNull()
  })
})
