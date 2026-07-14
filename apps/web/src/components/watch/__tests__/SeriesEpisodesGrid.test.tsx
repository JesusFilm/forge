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
  // Spread overrides last so per-test field overrides win. Build a
  // structurally-complete Episode literal — no `as Episode` cast — so
  // a future drift in the WatchVideo fragment's children projection
  // surfaces as a typecheck failure here instead of being silenced.
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

describe("SeriesEpisodesGrid — happy path", () => {
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
    const anchors = container.querySelectorAll("a")
    expect(anchors.length).toBe(3)
  })

  it("routes each episode click through the contextual collection path", () => {
    const episodes: Episodes = [
      makeEpisode({
        documentId: "e1",
        slug: "storyclubs-birth-of-jesus",
        title: "The Birth of Jesus",
      }),
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
    const anchor = container.querySelector("a")
    expect(anchor?.getAttribute("href")).toBe(
      "/storyclubs.html/storyclubs-birth-of-jesus/english.html",
    )
  })

  it("uses the current audio language slug in every episode href", () => {
    const episodes: Episodes = [
      makeEpisode({ documentId: "e1", slug: "ep-1" }),
      makeEpisode({ documentId: "e2", slug: "ep-2" }),
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
    const anchors = container.querySelectorAll("a")
    expect(anchors[0]?.getAttribute("href")).toBe(
      "/storyclubs.html/ep-1/spanish-castilian.html",
    )
    expect(anchors[1]?.getAttribute("href")).toBe(
      "/storyclubs.html/ep-2/spanish-castilian.html",
    )
  })
})

describe("SeriesEpisodesGrid — grid template", () => {
  it("uses a 5-column responsive grid at xl, ladder down to 1-col on mobile", () => {
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
    // Mobile → tablet → laptop → desktop ladder. The xl:grid-cols-5 is
    // the load-bearing class — matches the production design's
    // five-across episode rail.
    expect(grid?.className).toContain("grid-cols-1")
    expect(grid?.className).toContain("sm:grid-cols-2")
    expect(grid?.className).toContain("md:grid-cols-3")
    expect(grid?.className).toContain("lg:grid-cols-4")
    expect(grid?.className).toContain("xl:grid-cols-5")
  })
})

describe("SeriesEpisodesGrid — hover backdrop", () => {
  it("marks the wrapper inactive and renders empty backdrop stacks when no poster is provided", () => {
    // When no series poster fallback is provided, the wrapper exposes
    // data-active="false" and the two stacks' image layers have no
    // background-image set. This covers the empty-series
    // editor-in-progress state.
    const episodes: Episodes = [
      makeEpisode({ documentId: "e1", slug: "ep-1", title: "Ep 1" }),
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
    const wrapper = container.querySelector(
      '[data-testid="series-episodes-grid-wrapper"]',
    )
    expect(wrapper).not.toBeNull()
    expect(wrapper?.getAttribute("data-active")).toBe("false")
    // Both stacks should render their layer-1 element even when empty
    // (so the DOM stays stable across hover transitions), but with no
    // background-image set.
    const stackALayer = container.querySelector(
      '[data-testid="series-episodes-grid-backdrop-A-layer-1"]',
    ) as HTMLElement | null
    const stackBLayer = container.querySelector(
      '[data-testid="series-episodes-grid-backdrop-B-layer-1"]',
    ) as HTMLElement | null
    expect(stackALayer).not.toBeNull()
    expect(stackBLayer).not.toBeNull()
    expect(stackALayer?.style.backgroundImage ?? "").toBe("")
    expect(stackBLayer?.style.backgroundImage ?? "").toBe("")
  })

  it("loads the series poster into both stacks on first render", () => {
    // The reducer-driven backdrop seeds BOTH slots with the supplied
    // series poster on init. Only stack A is rendered visible
    // (activeStack === "A" at target opacity); stack B holds the same
    // URL at opacity 0 so a hover-out can't strand the inactive slot
    // with a stale URL that would flash on the next swap.
    const episodes: Episodes = [
      makeEpisode({ documentId: "e1", slug: "ep-1", title: "Ep 1" }),
    ]
    act(() => {
      root.render(
        <SeriesEpisodesGrid
          episodes={episodes}
          languageSlug="english"
          parentSlug="storyclubs"
          seriesPosterUrl="https://cdn.example/series.jpg"
        />,
      )
    })
    const wrapper = container.querySelector(
      '[data-testid="series-episodes-grid-wrapper"]',
    )
    expect(wrapper?.getAttribute("data-active")).toBe("true")
    const stackALayer = container.querySelector(
      '[data-testid="series-episodes-grid-backdrop-A-layer-1"]',
    ) as HTMLElement | null
    const stackBLayer = container.querySelector(
      '[data-testid="series-episodes-grid-backdrop-B-layer-1"]',
    ) as HTMLElement | null
    expect(stackALayer?.style.backgroundImage).toContain(
      "https://cdn.example/series.jpg",
    )
    // Stack B is at opacity 0 (hidden), but its background-image is
    // pre-loaded with the poster so a hover-out reset can't strand a
    // stale URL on it.
    expect(stackBLayer?.style.backgroundImage).toContain(
      "https://cdn.example/series.jpg",
    )
  })
})

describe("SeriesEpisodesGrid — crossfade reducer state machine", () => {
  // Drive hover swaps via real pointerover dispatch — React delegates
  // onPointerEnter via pointerover at the root for React 18+. The
  // direct pointerenter event doesn't bubble and React's synthetic
  // dispatch wouldn't fire. Dispatching pointerover on the anchor
  // bubbles to the root where React's listener converts it to the
  // onPointerEnter callback.
  function dispatchPointerEnter(target: Element) {
    const evt = new Event("pointerover", { bubbles: true })
    target.dispatchEvent(evt)
  }

  function getBgUrl(testId: string): string {
    const layer = container.querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement | null
    return layer?.style.backgroundImage ?? ""
  }

  it("after hover with a new URL, the inactive stack carries the new URL and the active stack's URL is unchanged", () => {
    const episodes: Episodes = [
      makeEpisode({
        documentId: "e1",
        slug: "ep-1",
        images: [
          {
            documentId: "img-2",
            url: null,
            thumbnail: "https://cdn.example/ep1-thumb.jpg",
            mobileCinematicHigh: "https://cdn.example/ep1-high.jpg",
            mobileCinematicLow: null,
          },
        ],
      }),
    ]
    act(() => {
      root.render(
        <SeriesEpisodesGrid
          episodes={episodes}
          languageSlug="english"
          parentSlug="storyclubs"
          seriesPosterUrl="https://cdn.example/series.jpg"
        />,
      )
    })

    const stackABefore = getBgUrl("series-episodes-grid-backdrop-A-layer-0")
    expect(stackABefore).toContain("series.jpg")

    const anchor = container.querySelector("a") as HTMLAnchorElement
    act(() => {
      dispatchPointerEnter(anchor)
    })

    // Stack B (now active) holds the hovered URL.
    expect(getBgUrl("series-episodes-grid-backdrop-B-layer-0")).toContain(
      "ep1-high.jpg",
    )
    // Stack A's URL is unchanged.
    expect(getBgUrl("series-episodes-grid-backdrop-A-layer-0")).toBe(
      stackABefore,
    )
  })

  it("dispatching SWAP_TO with the same URL twice does not toggle the active flag", () => {
    const episodes: Episodes = [
      makeEpisode({
        documentId: "e1",
        slug: "ep-1",
        images: [
          {
            documentId: "img-3",
            url: null,
            thumbnail: null,
            mobileCinematicHigh: "https://cdn.example/same.jpg",
            mobileCinematicLow: null,
          },
        ],
      }),
    ]
    act(() => {
      root.render(
        <SeriesEpisodesGrid
          episodes={episodes}
          languageSlug="english"
          parentSlug="storyclubs"
          seriesPosterUrl="https://cdn.example/series.jpg"
        />,
      )
    })

    const anchor = container.querySelector("a") as HTMLAnchorElement
    // First hover swaps to stack B with same.jpg.
    act(() => {
      dispatchPointerEnter(anchor)
    })
    const stackBAfterFirst = getBgUrl("series-episodes-grid-backdrop-B-layer-0")
    const stackAAfterFirst = getBgUrl("series-episodes-grid-backdrop-A-layer-0")

    // Second hover with the same URL — should no-op (reducer returns
    // state unchanged when target URL matches the visible stack's URL).
    act(() => {
      dispatchPointerEnter(anchor)
    })
    expect(getBgUrl("series-episodes-grid-backdrop-A-layer-0")).toBe(
      stackAAfterFirst,
    )
    expect(getBgUrl("series-episodes-grid-backdrop-B-layer-0")).toBe(
      stackBAfterFirst,
    )
  })
})

describe("SeriesEpisodesGrid — edge cases", () => {
  it("renders an empty grid wrapper for zero children (no error, no layout shift)", () => {
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
    expect(grid?.querySelectorAll("a").length).toBe(0)
  })

  it("falls back through the image resolution chain (thumbnail when mobileCinematicHigh missing)", () => {
    const episodeMissingHigh = makeEpisode({
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
          episodes={[episodeMissingHigh]}
          languageSlug="english"
          parentSlug="storyclubs"
        />,
      )
    })
    const img = container.querySelector("img")
    // The card renders an <img> with the thumbnail fallback.
    expect(img?.getAttribute("src")).toContain("thumb-only.jpg")
  })
})
