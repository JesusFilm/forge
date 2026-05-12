/**
 * @vitest-environment jsdom
 *
 * U3 — SeriesEpisodesGrid tests.
 *
 * Covers the grid wrapper structure, the inline child→SearchResult
 * adapter, and the per-card hrefBuilder that routes episode clicks to
 * the standard video page. VideoCard uses next/image and next/link;
 * both are mocked so we can assert on rendered href and data-src
 * attributes without spinning up Next's image optimizer.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { SeriesEpisodesGrid } from "@/components/watch/SeriesEpisodesGrid"
import type { ResolvedSeriesBySlug } from "@/lib/content"

type Series = ResolvedSeriesBySlug["video"]
type Episodes = NonNullable<Series["children"]>
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
  return {
    documentId: "episode-1",
    slug: "episode-one",
    title: "Episode One",
    label: "episode",
    images: [
      {
        url: "https://cdn.example/episode-one.jpg",
        thumbnail: "https://cdn.example/episode-one.thumb.jpg",
        mobileCinematicHigh: "https://cdn.example/episode-one.high.jpg",
        mobileCinematicLow: null,
      },
    ],
    ...overrides,
  } as Episode
}

describe("SeriesEpisodesGrid — happy path", () => {
  it("renders one VideoCard anchor per episode", () => {
    const episodes: Episodes = [
      makeEpisode({ documentId: "e1", slug: "ep-1", title: "Ep 1" }),
      makeEpisode({ documentId: "e2", slug: "ep-2", title: "Ep 2" }),
      makeEpisode({ documentId: "e3", slug: "ep-3", title: "Ep 3" }),
    ]
    act(() => {
      root.render(<SeriesEpisodesGrid episodes={episodes} locale="en" />)
    })
    const anchors = container.querySelectorAll("a")
    expect(anchors.length).toBe(3)
  })

  it("routes each episode click to /{episode-slug}/{locale} (AE5)", () => {
    const episodes: Episodes = [
      makeEpisode({
        documentId: "e1",
        slug: "storyclubs-birth-of-jesus",
        title: "The Birth of Jesus",
      }),
    ]
    act(() => {
      root.render(<SeriesEpisodesGrid episodes={episodes} locale="en" />)
    })
    const anchor = container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe("/storyclubs-birth-of-jesus/en")
  })

  it("preserves the locale from the series URL in every episode href", () => {
    const episodes: Episodes = [
      makeEpisode({ documentId: "e1", slug: "ep-1" }),
      makeEpisode({ documentId: "e2", slug: "ep-2" }),
    ]
    act(() => {
      root.render(<SeriesEpisodesGrid episodes={episodes} locale="es" />)
    })
    const anchors = container.querySelectorAll("a")
    expect(anchors[0]?.getAttribute("href")).toBe("/ep-1/es")
    expect(anchors[1]?.getAttribute("href")).toBe("/ep-2/es")
  })
})

describe("SeriesEpisodesGrid — grid template", () => {
  it("uses the verbatim search-overlay grid className (R13)", () => {
    act(() => {
      root.render(<SeriesEpisodesGrid episodes={[]} locale="en" />)
    })
    const grid = container.querySelector('[data-testid="series-episodes-grid"]')
    expect(grid?.className).toBe(
      "grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
    )
  })
})

describe("SeriesEpisodesGrid — edge cases", () => {
  it("renders an empty grid wrapper for zero children (no error, no layout shift)", () => {
    act(() => {
      root.render(<SeriesEpisodesGrid episodes={[]} locale="en" />)
    })
    const grid = container.querySelector('[data-testid="series-episodes-grid"]')
    expect(grid).not.toBeNull()
    expect(grid?.querySelectorAll("a").length).toBe(0)
  })

  it("falls back through the image resolution chain (thumbnail when mobileCinematicHigh missing)", () => {
    const episodeMissingHigh = makeEpisode({
      images: [
        {
          url: null,
          thumbnail: "https://cdn.example/thumb-only.jpg",
          mobileCinematicHigh: null,
          mobileCinematicLow: null,
        },
      ],
    })
    act(() => {
      root.render(
        <SeriesEpisodesGrid episodes={[episodeMissingHigh]} locale="en" />,
      )
    })
    const img = container.querySelector("img")
    // The card renders an <img> with the thumbnail fallback.
    expect(img?.getAttribute("src")).toContain("thumb-only.jpg")
  })
})
