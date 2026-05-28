/**
 * @vitest-environment jsdom
 *
 * SeriesEpisodeCard tests.
 *
 * Covers the pure-function-equivalents (formatRuntime, pickRuntimeSeconds,
 * resolveThumbnailUrl) via the rendered DOM, the "Episode N" eyebrow
 * label, and the href routing. next/image and next/link are mocked to
 * minimal pass-throughs so we can assert on src/href without
 * Next's image optimizer.
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
type Variant = NonNullable<NonNullable<Episode["variants"]>[number]>

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

function makeVariant(overrides: Partial<Variant> = {}): Variant {
  const base: Variant = {
    documentId: "v1",
    published: true,
    hls: "https://stream.mux.com/x.m3u8",
    duration: 120,
    language: { slug: "english", name: "English", bcp47: "en" },
  }
  return { ...base, ...overrides }
}

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
    variants: [makeVariant()],
  }
  return { ...base, ...overrides }
}

function renderCard(props: {
  episode: Episode
  index?: number
  locale?: string
}) {
  act(() => {
    root.render(
      <SeriesEpisodeCard
        episode={props.episode}
        index={props.index ?? 0}
        locale={props.locale ?? "en"}
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

describe("SeriesEpisodeCard — formatRuntime via runtime pill", () => {
  it("collapses to icon-only for null duration", () => {
    renderCard({
      episode: makeEpisode({
        variants: [makeVariant({ duration: null as unknown as number })],
      }),
    })
    expect(getRuntimeText()).toBeNull()
    expect(container.querySelector('[data-testid="play-icon"]')).not.toBeNull()
  })

  it("collapses to icon-only for undefined duration", () => {
    renderCard({
      episode: makeEpisode({
        variants: [makeVariant({ duration: undefined as unknown as number })],
      }),
    })
    expect(getRuntimeText()).toBeNull()
  })

  it("collapses to icon-only for duration 0", () => {
    renderCard({
      episode: makeEpisode({
        variants: [makeVariant({ duration: 0 })],
      }),
    })
    expect(getRuntimeText()).toBeNull()
  })

  it("collapses to icon-only for negative duration", () => {
    renderCard({
      episode: makeEpisode({
        variants: [makeVariant({ duration: -10 })],
      }),
    })
    expect(getRuntimeText()).toBeNull()
  })

  it("collapses to icon-only for NaN duration", () => {
    renderCard({
      episode: makeEpisode({
        variants: [makeVariant({ duration: Number.NaN })],
      }),
    })
    expect(getRuntimeText()).toBeNull()
  })

  it("renders '0:59' for 59 seconds", () => {
    renderCard({
      episode: makeEpisode({ variants: [makeVariant({ duration: 59 })] }),
    })
    expect(getRuntimeText()).toBe("0:59")
  })

  it("renders '1:00' for 60 seconds", () => {
    renderCard({
      episode: makeEpisode({ variants: [makeVariant({ duration: 60 })] }),
    })
    expect(getRuntimeText()).toBe("1:00")
  })

  it("renders '9:59' for 599 seconds", () => {
    renderCard({
      episode: makeEpisode({ variants: [makeVariant({ duration: 599 })] }),
    })
    expect(getRuntimeText()).toBe("9:59")
  })

  it("renders '1:00:00' for 3600 seconds", () => {
    renderCard({
      episode: makeEpisode({ variants: [makeVariant({ duration: 3600 })] }),
    })
    expect(getRuntimeText()).toBe("1:00:00")
  })

  it("renders '2:03:04' for 7384 seconds", () => {
    renderCard({
      episode: makeEpisode({ variants: [makeVariant({ duration: 7384 })] }),
    })
    expect(getRuntimeText()).toBe("2:03:04")
  })
})

describe("SeriesEpisodeCard — pickRuntimeSeconds variant filter", () => {
  it("ignores unpublished variants", () => {
    renderCard({
      episode: makeEpisode({
        variants: [makeVariant({ published: false, duration: 600 })],
      }),
    })
    expect(getRuntimeText()).toBeNull()
  })

  it("ignores variants with null hls", () => {
    renderCard({
      episode: makeEpisode({
        variants: [makeVariant({ hls: null, duration: 600 })],
      }),
    })
    expect(getRuntimeText()).toBeNull()
  })

  it("ignores variants where duration === 0 and falls through to next", () => {
    renderCard({
      episode: makeEpisode({
        variants: [
          makeVariant({ documentId: "v1", duration: 0 }),
          makeVariant({ documentId: "v2", duration: 240 }),
        ],
      }),
    })
    expect(getRuntimeText()).toBe("4:00")
  })

  it("returns the first qualifying variant's duration", () => {
    renderCard({
      episode: makeEpisode({
        variants: [
          makeVariant({ documentId: "v1", duration: 120 }),
          makeVariant({ documentId: "v2", duration: 240 }),
        ],
      }),
    })
    expect(getRuntimeText()).toBe("2:00")
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
  it("routes to the canonical /{slug}.html/{locale}.html shape", () => {
    renderCard({
      episode: makeEpisode({ slug: "wedding-in-cana" }),
      locale: "english",
    })
    const anchor = container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe(
      "/wedding-in-cana.html/english.html",
    )
  })

  it("preserves a non-english locale", () => {
    renderCard({
      episode: makeEpisode({ slug: "the-birth-of-jesus" }),
      locale: "spanish-castilian",
    })
    const anchor = container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe(
      "/the-birth-of-jesus.html/spanish-castilian.html",
    )
  })

  it("renders a plain div (no <a>) when the slug is malformed", () => {
    renderCard({
      episode: makeEpisode({ slug: "Bad Slug!" }),
      locale: "english",
    })
    expect(container.querySelector("a")).toBeNull()
    const card = container.querySelector('[data-testid="series-episode-card"]')
    expect(card).not.toBeNull()
    expect(card?.tagName).toBe("DIV")
    expect(card?.hasAttribute("href")).toBe(false)
  })

  it("renders a plain div (no <a>) when the locale is malformed", () => {
    renderCard({
      episode: makeEpisode({ slug: "wedding-in-cana" }),
      locale: "Bad Locale!",
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
