/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { SeriesEpisodesGrid } from "@/components/watch/SeriesEpisodesGrid"
import { SERIES_CONTENT_GLASS_CLASS_NAME } from "@/components/watch/series-page-styles"
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
  const base: Episode = {
    documentId: "episode-1",
    slug: "episode-one",
    title: "Episode One",
    label: "episode",
    images: [
      {
        documentId: "img-1",
        url: "https://cdn.example/episode-one.jpg",
        thumbnail: "https://cdn.example/episode-one.thumb.jpg",
        mobileCinematicHigh: "https://cdn.example/episode-one.high.jpg",
        mobileCinematicLow: null,
      },
    ],
    durationSeconds: null,
    muxPlaybackId: null,
    muxThumbnailBlurDataUrl: null,
  }
  return { ...base, ...overrides }
}

describe("SeriesEpisodesGrid", () => {
  it("renders one card anchor per episode", () => {
    const episodes: Episodes = [
      makeEpisode({ documentId: "e1", slug: "ep-1", title: "Ep 1" }),
      makeEpisode({ documentId: "e2", slug: "ep-2", title: "Ep 2" }),
      makeEpisode({ documentId: "e3", slug: "ep-3", title: "Ep 3" }),
    ]

    act(() => {
      root.render(
        <SeriesEpisodesGrid
          episodes={episodes}
          languageSlug="english"
          parentSlug="storyclubs"
        />,
      )
    })

    expect(container.querySelectorAll("a")).toHaveLength(3)
  })

  it("routes episodes through the collection path in the selected language", () => {
    const episodes: Episodes = [
      makeEpisode({
        documentId: "e1",
        slug: "storyclubs-birth-of-jesus",
      }),
    ]

    act(() => {
      root.render(
        <SeriesEpisodesGrid
          episodes={episodes}
          languageSlug="spanish-castilian"
          parentSlug="storyclubs"
        />,
      )
    })

    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/storyclubs.html/storyclubs-birth-of-jesus/spanish-castilian.html",
    )
  })

  it("keeps the responsive one-to-five-column grid", () => {
    act(() => {
      root.render(
        <SeriesEpisodesGrid
          episodes={[]}
          languageSlug="english"
          parentSlug="storyclubs"
        />,
      )
    })

    const grid = container.querySelector('[data-testid="series-episodes-grid"]')
    expect(grid?.className).toContain("grid-cols-1")
    expect(grid?.className).toContain("sm:grid-cols-2")
    expect(grid?.className).toContain("md:grid-cols-3")
    expect(grid?.className).toContain("lg:grid-cols-4")
    expect(grid?.className).toContain("xl:grid-cols-5")
  })

  it("matches the metadata section's translucent stone treatment", () => {
    act(() => {
      root.render(
        <SeriesEpisodesGrid
          episodes={[makeEpisode()]}
          languageSlug="english"
          parentSlug="storyclubs"
        />,
      )
    })

    const wrapper = container.querySelector(
      '[data-testid="series-episodes-grid-wrapper"]',
    )
    for (const className of SERIES_CONTENT_GLASS_CLASS_NAME.split(" ")) {
      expect(wrapper?.className).toContain(className)
    }
    expect(
      wrapper?.querySelector('[data-testid*="series-episodes-grid-backdrop"]'),
    ).toBeNull()
  })

  it("renders an empty grid for a series with no children", () => {
    act(() => {
      root.render(
        <SeriesEpisodesGrid
          episodes={[]}
          languageSlug="english"
          parentSlug="storyclubs"
        />,
      )
    })

    const grid = container.querySelector('[data-testid="series-episodes-grid"]')
    expect(grid).not.toBeNull()
    expect(grid?.querySelectorAll("a")).toHaveLength(0)
  })

  it("keeps the episode thumbnail fallback chain", () => {
    const episode = makeEpisode({
      images: [
        {
          documentId: "img-4",
          url: null,
          thumbnail: "https://cdn.example/thumb-only.jpg",
          mobileCinematicHigh: null,
          mobileCinematicLow: null,
        },
      ],
    })

    act(() => {
      root.render(
        <SeriesEpisodesGrid
          episodes={[episode]}
          languageSlug="english"
          parentSlug="storyclubs"
        />,
      )
    })

    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "thumb-only.jpg",
    )
  })
})
