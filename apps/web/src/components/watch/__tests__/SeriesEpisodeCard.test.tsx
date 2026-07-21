/**
 * @vitest-environment jsdom
 *
 * SeriesEpisodeCard tests.
 *
 * Covers formatRuntime (driven by the precomputed `durationSeconds` the
 * card now reads off each chapter) and resolveThumbnailUrl via the
 * rendered DOM, the "Episode N" eyebrow label, and the href routing.
 * The former client-side primary-dub picking moved server-side to admin's
 * Video.durationSeconds resolver, so the card no longer filters variants.
 * next/image and next/link are mocked to minimal pass-throughs so we can
 * assert on src/href without Next's image optimizer.
 */

import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) =>
    // jsx-only: no real Next image optimization in jsdom
    React.createElement("img", { src, alt }),
}))

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string
    children: React.ReactNode
  } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock("lucide-react", () => ({
  Play: ({ size }: { size?: number }) => (
    <span data-testid="play-icon" data-size={size} />
  ),
}))

import { SeriesEpisodeCard } from "@/components/watch/SeriesEpisodeCard"
import type { ResolvedSeriesBySlug } from "@/lib/content"

type Episodes = NonNullable<ResolvedSeriesBySlug["video"]["children"]>
type Episode = NonNullable<Episodes[number]>

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

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
  const base: Episode = {
    documentId: "episode-1",
    slug: "episode-one",
    title: "Episode One",
    label: "episode",
    images: [
      {
        documentId: "img-1",
        url: "https://cdn.example/url.jpg",
        thumbnail: "https://cdn.example/thumb.jpg",
        mobileCinematicHigh: "https://cdn.example/high.jpg",
        mobileCinematicLow: "https://cdn.example/low.jpg",
      },
    ],
    durationSeconds: 120,
    muxPlaybackId: null,
    muxThumbnailBlurDataUrl: null,
  }
  return { ...base, ...overrides }
}

function renderCard(props: {
  episode: Episode
  index?: number
  languageSlug?: string
  parentSlug?: string
}) {
  act(() => {
    root.render(
      <SeriesEpisodeCard
        episode={props.episode}
        index={props.index ?? 0}
        languageSlug={props.languageSlug ?? "english"}
        parentSlug={props.parentSlug ?? "lumo-the-gospel-of-john"}
      />,
    )
  })
}

function getRuntimeText(): string | null {
  const pill = container.querySelector(".absolute.top-2.right-2")
  if (!pill) return null
  // The pill contains a play-icon span (mocked from lucide-react) and,
  // when a duration is present, a second span carrying the runtime
  // text. Filter out the mocked icon by its data-testid so we only
  // observe the runtime span. Return null when no runtime span is
  // rendered so the "collapses to icon-only" assertion is observable.
  const spans = Array.from(pill.querySelectorAll("span"))
  const runtime = spans.find((s) => !s.hasAttribute("data-testid"))
  return runtime?.textContent ?? null
}

describe("SeriesEpisodeCard interaction frame", () => {
  it("uses the shared white hover and keyboard-focus thumbnail frame", () => {
    renderCard({ episode: makeEpisode({}) })

    const card = container.querySelector<HTMLElement>(
      '[data-testid="series-episode-card"]',
    )
    const frame = container.querySelector<HTMLElement>(
      '[data-testid="series-episode-card-hover-outline"]',
    )
    const frameClasses = frame?.className ?? ""

    expect(card?.className).toContain("focus-visible:outline-none")
    expect(card?.className).not.toContain("focus-visible:ring-amber")
    expect(frameClasses).toContain("rounded-[inherit]")
    expect(frameClasses).toContain("border-4")
    expect(frameClasses).toContain("border-white")
    expect(frameClasses).toContain("group-hover:opacity-100")
    expect(frameClasses).toContain("group-focus-visible:opacity-100")
    expect(frameClasses).not.toMatch(/red|amber|gradient|shadow/)
  })
})

describe("SeriesEpisodeCard — formatRuntime via runtime pill", () => {
  it("collapses to icon-only for null duration", () => {
    renderCard({
      episode: makeEpisode({ durationSeconds: null }),
    })
    expect(getRuntimeText()).toBeNull()
    expect(container.querySelector('[data-testid="play-icon"]')).not.toBeNull()
  })

  it("collapses to icon-only for duration 0", () => {
    renderCard({
      episode: makeEpisode({ durationSeconds: 0 }),
    })
    expect(getRuntimeText()).toBeNull()
  })

  it("collapses to icon-only for negative duration", () => {
    renderCard({
      episode: makeEpisode({ durationSeconds: -10 }),
    })
    expect(getRuntimeText()).toBeNull()
  })

  it("collapses to icon-only for NaN duration", () => {
    renderCard({
      episode: makeEpisode({ durationSeconds: Number.NaN }),
    })
    expect(getRuntimeText()).toBeNull()
  })

  it("renders '0:59' for 59 seconds", () => {
    renderCard({ episode: makeEpisode({ durationSeconds: 59 }) })
    expect(getRuntimeText()).toBe("0:59")
  })

  it("renders '1:00' for 60 seconds", () => {
    renderCard({ episode: makeEpisode({ durationSeconds: 60 }) })
    expect(getRuntimeText()).toBe("1:00")
  })

  it("renders '9:59' for 599 seconds", () => {
    renderCard({ episode: makeEpisode({ durationSeconds: 599 }) })
    expect(getRuntimeText()).toBe("9:59")
  })

  it("renders '1:00:00' for 3600 seconds", () => {
    renderCard({ episode: makeEpisode({ durationSeconds: 3600 }) })
    expect(getRuntimeText()).toBe("1:00:00")
  })

  it("renders '2:03:04' for 7384 seconds", () => {
    renderCard({ episode: makeEpisode({ durationSeconds: 7384 }) })
    expect(getRuntimeText()).toBe("2:03:04")
  })
})

describe("SeriesEpisodeCard — resolveThumbnailUrl image priority", () => {
  it("prefers mobileCinematicHigh", () => {
    renderCard({
      episode: makeEpisode({
        images: [
          {
            documentId: "img-a",
            mobileCinematicHigh: "https://cdn.example/high.jpg",
            thumbnail: "https://cdn.example/thumb.jpg",
            mobileCinematicLow: "https://cdn.example/low.jpg",
            url: "https://cdn.example/url.jpg",
          },
        ],
      }),
    })
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toContain("high.jpg")
  })

  it("falls back to thumbnail when high is null", () => {
    renderCard({
      episode: makeEpisode({
        images: [
          {
            documentId: "img-b",
            mobileCinematicHigh: null,
            thumbnail: "https://cdn.example/thumb.jpg",
            mobileCinematicLow: "https://cdn.example/low.jpg",
            url: "https://cdn.example/url.jpg",
          },
        ],
      }),
    })
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toContain("thumb.jpg")
  })

  it("falls back to mobileCinematicLow when high+thumbnail null", () => {
    renderCard({
      episode: makeEpisode({
        images: [
          {
            documentId: "img-c",
            mobileCinematicHigh: null,
            thumbnail: null,
            mobileCinematicLow: "https://cdn.example/low.jpg",
            url: "https://cdn.example/url.jpg",
          },
        ],
      }),
    })
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toContain("low.jpg")
  })

  it("falls back to url last", () => {
    renderCard({
      episode: makeEpisode({
        images: [
          {
            documentId: "img-d",
            mobileCinematicHigh: null,
            thumbnail: null,
            mobileCinematicLow: null,
            url: "https://cdn.example/url.jpg",
          },
        ],
      }),
    })
    const img = container.querySelector("img")
    expect(img?.getAttribute("src")).toContain("url.jpg")
  })

  it("renders the stone-800 fallback div when no images are provided", () => {
    renderCard({ episode: makeEpisode({ images: [] }) })
    expect(container.querySelector("img")).toBeNull()
    const fallback = container.querySelector(".bg-stone-800")
    expect(fallback).not.toBeNull()
  })
})

describe("SeriesEpisodeCard — Episode N label", () => {
  it("renders 'Episode 1' for index 0", () => {
    renderCard({ episode: makeEpisode(), index: 0 })
    const label = container.querySelector("span.uppercase")
    expect(label?.textContent).toBe("Episode 1")
  })

  it("renders 'Episode 3' for index 2", () => {
    renderCard({ episode: makeEpisode(), index: 2 })
    const label = container.querySelector("span.uppercase")
    expect(label?.textContent).toBe("Episode 3")
  })
})

describe("SeriesEpisodeCard — href", () => {
  it("routes to the contextual /{series}.html/{episode}/{locale}.html shape", () => {
    renderCard({
      episode: makeEpisode({ slug: "wedding-in-cana" }),
      languageSlug: "english",
      parentSlug: "lumo-the-gospel-of-john",
    })
    const anchor = container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe(
      "/lumo-the-gospel-of-john.html/wedding-in-cana/english.html",
    )
  })

  it("preserves a non-English audio language slug", () => {
    renderCard({
      episode: makeEpisode({ slug: "the-birth-of-jesus" }),
      languageSlug: "spanish-castilian",
    })
    const anchor = container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe(
      "/lumo-the-gospel-of-john.html/the-birth-of-jesus/spanish-castilian.html",
    )
  })

  it("routes a nested collection to its standalone language page", () => {
    renderCard({
      episode: makeEpisode({
        slug: "lumo-the-gospel-of-matthew",
        label: "COLLECTION",
      }),
      languageSlug: "russian",
      parentSlug: "lumo",
    })
    const anchor = container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe(
      "/lumo-the-gospel-of-matthew.html/russian.html",
    )
  })

  it("routes a nested series without requiring a valid parent slug", () => {
    renderCard({
      episode: makeEpisode({ slug: "nested-series", label: "SERIES" }),
      languageSlug: "english",
      parentSlug: "Bad Parent!",
    })
    const anchor = container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe(
      "/nested-series.html/english.html",
    )
  })

  it("keeps unlabeled children on the contextual route", () => {
    renderCard({
      episode: makeEpisode({ slug: "unlabeled-child", label: null }),
      languageSlug: "english",
      parentSlug: "lumo",
    })
    const anchor = container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe(
      "/lumo.html/unlabeled-child/english.html",
    )
  })

  it("renders a plain div (no <a>) when the parent slug is malformed", () => {
    renderCard({
      episode: makeEpisode({ slug: "wedding-in-cana" }),
      languageSlug: "english",
      parentSlug: "Bad Parent!",
    })
    expect(container.querySelector("a")).toBeNull()
    const card = container.querySelector('[data-testid="series-episode-card"]')
    expect(card?.tagName).toBe("DIV")
    expect(card?.className).not.toContain("group")
    expect(card?.className).not.toContain("focus-visible:outline-none")
    expect(
      card?.querySelector('[data-testid="series-episode-card-hover-outline"]'),
    ).toBeNull()
    expect(card?.querySelector("svg")).toBeNull()
  })

  it("renders a plain div (no <a>) when the slug is malformed", () => {
    renderCard({
      episode: makeEpisode({ slug: "Bad Slug!" }),
      languageSlug: "english",
    })
    expect(container.querySelector("a")).toBeNull()
    const card = container.querySelector('[data-testid="series-episode-card"]')
    expect(card).not.toBeNull()
    expect(card?.tagName).toBe("DIV")
    expect(card?.hasAttribute("href")).toBe(false)
  })

  it("renders a plain div (no <a>) when the audio language slug is malformed", () => {
    renderCard({
      episode: makeEpisode({ slug: "wedding-in-cana" }),
      languageSlug: "Bad Locale!",
    })
    expect(container.querySelector("a")).toBeNull()
    const card = container.querySelector('[data-testid="series-episode-card"]')
    expect(card?.tagName).toBe("DIV")
  })
})

describe("SeriesEpisodeCard — alt text fallback", () => {
  it("uses the title when present", () => {
    renderCard({
      episode: makeEpisode({ title: "The Birth of Jesus" }),
    })
    const img = container.querySelector("img")
    expect(img?.getAttribute("alt")).toBe("The Birth of Jesus")
  })

  it("falls back to 'Episode N thumbnail' when title is null", () => {
    renderCard({
      episode: makeEpisode({ title: null }),
      index: 4,
    })
    const img = container.querySelector("img")
    expect(img?.getAttribute("alt")).toBe("Episode 5 thumbnail")
  })
})
