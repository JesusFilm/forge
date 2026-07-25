/**
 * @vitest-environment jsdom
 */
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { formatDuration } from "@/lib/format-duration"
import type { SearchResult } from "@/lib/search"
import { resolveMuxAnimatedPreviewUrl } from "@/lib/url"
import { buildWatchSearchResultClickRumContext } from "@/lib/watch-search-rum"

import {
  defaultHrefBuilder,
  formatVideoLabel,
  pickCardPill,
  VideoCard,
} from "./VideoCard"

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, number>) => {
    if (key === "episodeCount") {
      const count = values?.count ?? 0
      return `${count} ${count === 1 ? "episode" : "episodes"}`
    }
    if (key === "experience") return "Experience"
    if (key === "thumbnailAlt") return "Video thumbnail"
    return key
  },
}))

vi.mock("next/image", () => ({
  default: ({
    alt,
    blurDataURL,
    className,
    placeholder,
    src,
  }: {
    alt?: string
    blurDataURL?: string
    className?: string
    placeholder?: string
    src: string
  }) =>
    createElement("img", {
      alt,
      className,
      "data-blur-data-url": blurDataURL ?? "",
      "data-placeholder": placeholder ?? "",
      src,
    }),
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    type: "video",
    id: "v_1",
    slug: "x",
    title: "X",
    imageUrl: null,
    imageBlurDataUrl: null,
    muxThumbnailBlurDataUrl: null,
    snippet: "",
    startSeconds: null,
    playbackId: null,
    score: 0,
    label: "EPISODE",
    durationSeconds: 120,
    childCount: 0,
    ...overrides,
  }
}

describe("formatVideoLabel", () => {
  it("formats single-word labels", () => {
    expect(formatVideoLabel("EPISODE")).toBe("Episode")
    expect(formatVideoLabel("SERIES")).toBe("Series")
    expect(formatVideoLabel("SEGMENT")).toBe("Segment")
  })

  it("formats multi-word labels with space separators", () => {
    expect(formatVideoLabel("SHORT_FILM")).toBe("Short Film")
    expect(formatVideoLabel("FEATURE_FILM")).toBe("Feature Film")
  })

  it("lowercases trailing connectives (the / and / of)", () => {
    expect(formatVideoLabel("BEHIND_THE_SCENES")).toBe("Behind the Scenes")
  })

  it("falls back to 'Video' on null", () => {
    expect(formatVideoLabel(null)).toBe("Video")
  })
})

describe("formatDuration", () => {
  it("renders sub-hour durations as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00")
    expect(formatDuration(7)).toBe("0:07")
    expect(formatDuration(70)).toBe("1:10")
    expect(formatDuration(599)).toBe("9:59")
  })

  it("renders hour+ durations as h:mm:ss", () => {
    expect(formatDuration(3600)).toBe("1:00:00")
    expect(formatDuration(3725)).toBe("1:02:05")
  })

  it("returns empty string on invalid input", () => {
    expect(formatDuration(NaN)).toBe("")
    expect(formatDuration(-5)).toBe("")
  })
})

describe("defaultHrefBuilder", () => {
  it("builds the canonical two-segment watch path with the english locale slug", () => {
    expect(defaultHrefBuilder(makeResult({ slug: "jesus" }))).toBe(
      "/jesus.html/english.html",
    )
  })

  it("uses a result language slug when watch search resolves one", () => {
    expect(
      defaultHrefBuilder(
        makeResult({ slug: "jesus", languageSlug: "spanish-castilian" }),
      ),
    ).toBe("/jesus.html/spanish-castilian.html")
  })

  it("keeps Admin content slugs with underscores clickable", () => {
    expect(
      defaultHrefBuilder(
        makeResult({
          slug: "soccer_event_collection",
          languageSlug: "english",
        }),
      ),
    ).toBe("/soccer_event_collection.html/english.html")
  })

  it("falls back to / on a malformed slug rather than a broken deep link", () => {
    expect(defaultHrefBuilder(makeResult({ slug: "Not A Slug!" }))).toBe("/")
  })
})

describe("resolveMuxAnimatedPreviewUrl", () => {
  it("builds the bounded Mux animated GIF preview URL", () => {
    expect(resolveMuxAnimatedPreviewUrl("mux playback 1")).toBe(
      "https://image.mux.com/mux%20playback%201/animated.webp?start=2&end=6&width=448&fps=8",
    )
  })

  it("returns null when the playback id is absent", () => {
    expect(resolveMuxAnimatedPreviewUrl(null)).toBeNull()
    expect(resolveMuxAnimatedPreviewUrl("   ")).toBeNull()
  })
})

describe("pickCardPill", () => {
  it("picks episode count for SERIES with childCount > 0 (singular vs plural)", () => {
    expect(
      pickCardPill(
        makeResult({ label: "SERIES", childCount: 13, durationSeconds: 70 }),
      ),
    ).toEqual({ kind: "count", text: "13 episodes" })
    expect(
      pickCardPill(
        makeResult({ label: "SERIES", childCount: 1, durationSeconds: 70 }),
      ),
    ).toEqual({ kind: "count", text: "1 episode" })
  })

  it("picks episode count for COLLECTION with childCount > 0", () => {
    expect(
      pickCardPill(makeResult({ label: "COLLECTION", childCount: 5 })),
    ).toEqual({ kind: "count", text: "5 episodes" })
  })

  it("ignores childCount on singular labels — admin's relation-inversion safety net", () => {
    // When admin's Video.parents/children labels are inverted, EPISODE
    // rows can come back with childCount > 0 (it's actually their parent
    // count). The pill must fall through to duration / null for non
    // series-shaped labels regardless of what childCount carries.
    expect(
      pickCardPill(
        makeResult({ label: "EPISODE", childCount: 4, durationSeconds: 70 }),
      ),
    ).toEqual({ kind: "duration", text: "1:10" })
    expect(
      pickCardPill(
        makeResult({
          label: "FEATURE_FILM",
          childCount: 7,
          durationSeconds: 3600,
        }),
      ),
    ).toEqual({ kind: "duration", text: "1:00:00" })
  })

  it("falls through to duration for SERIES with childCount == 0", () => {
    expect(
      pickCardPill(
        makeResult({ label: "SERIES", childCount: 0, durationSeconds: 70 }),
      ),
    ).toEqual({ kind: "duration", text: "1:10" })
  })

  it("returns null when childCount is null AND durationSeconds is null (experiences)", () => {
    expect(
      pickCardPill(
        makeResult({
          type: "experience",
          label: null,
          childCount: null,
          durationSeconds: null,
        }),
      ),
    ).toBeNull()
  })

  it("returns null when durationSeconds is 0 — empty pill is worse than no pill", () => {
    expect(
      pickCardPill(makeResult({ childCount: 0, durationSeconds: 0 })),
    ).toBeNull()
  })

  it("returns null for singular labels with childCount > 0 and no duration", () => {
    // EPISODE with inverted childCount but no real duration — render
    // nothing rather than the misleading "N episodes" pill.
    expect(
      pickCardPill(
        makeResult({
          label: "EPISODE",
          childCount: 4,
          durationSeconds: null,
        }),
      ),
    ).toBeNull()
  })
})

describe("VideoCard", () => {
  it("does not render a generic Video badge when the search result has no catalog label", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <VideoCard
          result={makeResult({
            label: null,
            durationSeconds: null,
          })}
        />,
      )
    })

    expect(
      container?.querySelector('[data-testid="search-card-type-badge"]'),
    ).toBeNull()
  })

  it("renders the concrete catalog label when one is available", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <VideoCard
          result={makeResult({
            label: "COLLECTION",
            childCount: 5,
            durationSeconds: null,
          })}
        />,
      )
    })

    expect(
      container?.querySelector('[data-testid="search-card-type-badge"]')
        ?.textContent,
    ).toBe("collection")
  })

  it("does not render watchability as a visible badge on search cards", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <VideoCard
          result={makeResult({
            availabilityKind: "target_audio",
            availabilityLanguageEnglishName: "Russian",
          })}
        />,
      )
    })

    expect(
      container?.querySelector(
        '[data-testid="search-card-availability-badge"]',
      ),
    ).toBeNull()
  })

  it("keeps the result card stable while zooming the media layer on hover", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <VideoCard
          result={makeResult({
            imageUrl: "https://example.com/thumb.jpg",
            slug: "jesus",
            title: "Jesus",
          })}
        />,
      )
    })

    const card = container.querySelector("a")
    const thumbnail = container.querySelector("img")
    const hoverOutline = container.querySelector(
      '[data-testid="search-card-hover-outline"]',
    )

    expect(card?.className).not.toContain("hover:scale")
    expect(card?.className).toContain("focus-visible:outline-none")
    expect(card?.className).not.toContain("focus-visible:outline-2")
    expect(thumbnail?.className).toContain("search-card-hover-zoom")
    expect(hoverOutline?.className).toContain("rounded-[inherit]")
    expect(hoverOutline?.className).toContain("border-4")
    expect(hoverOutline?.className).toContain("border-white")
    expect(hoverOutline?.className).toContain("group-hover:opacity-100")
    expect(hoverOutline?.className).toContain("group-focus-visible:opacity-100")
    expect(hoverOutline?.className).not.toMatch(/red|amber|gradient|shadow/)
  })

  it("passes Admin image blur data URLs through to Next Image", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <VideoCard
          result={makeResult({
            imageUrl: "https://example.com/thumb.jpg",
            imageBlurDataUrl: "data:image/svg+xml;base64,ADMIN==",
            muxThumbnailBlurDataUrl: "data:image/jpeg;base64,MUX==",
            slug: "jesus",
            title: "Jesus",
          })}
        />,
      )
    })

    const thumbnail = container.querySelector("img")
    const thumbnailFrame = thumbnail?.parentElement

    expect(thumbnail?.getAttribute("data-placeholder")).toBe("blur")
    expect(thumbnail?.getAttribute("data-blur-data-url")).toBe(
      "data:image/svg+xml;base64,ADMIN==",
    )
    expect(thumbnailFrame?.style.backgroundImage).toContain(
      "data:image/svg+xml;base64,ADMIN==",
    )
  })

  it("passes mux thumbnail blur data URLs through to Next Image for mux fallbacks", () => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <VideoCard
          result={makeResult({
            imageUrl: null,
            muxThumbnailBlurDataUrl: "data:image/jpeg;base64,AQIDBA==",
            playbackId: "playback-id",
            slug: "jesus",
            title: "Jesus",
          })}
        />,
      )
    })

    const thumbnail = container.querySelector("img")
    const thumbnailFrame = thumbnail?.parentElement

    expect(thumbnail?.getAttribute("data-placeholder")).toBe("blur")
    expect(thumbnail?.getAttribute("data-blur-data-url")).toBe(
      "data:image/jpeg;base64,AQIDBA==",
    )
    expect(thumbnailFrame?.style.backgroundImage).toContain(
      "data:image/jpeg;base64,AQIDBA==",
    )
  })
})

describe("buildWatchSearchResultClickRumContext", () => {
  it("builds bounded click context without copying query text", () => {
    const context = buildWatchSearchResultClickRumContext(
      makeResult({
        id: "video_1",
        slug: "jesus",
        title: "JESUS",
      }),
      {
        position: 3,
        resultSource: "watch-search",
        routeLanguageSlug: "english",
        searchLanguageEnglishName: "Spanish, Castilian",
        searchLanguageSlug: "spanish-castilian",
        searchRequestId: "search_12345678",
      },
    )

    expect(context).toMatchObject({
      "watch_search.result_id": "video_1",
      "watch_search.result_position": 3,
      "watch_search.result_slug": "jesus",
      "watch_search.result_source": "watch-search",
      "watch_search.result_title": "JESUS",
      "watch_search.route_language_slug": "english",
      "watch_search.search_language_english_name": "Spanish, Castilian",
      "watch_search.search_language_slug": "spanish-castilian",
      "watch_search.search_request_id": "search_12345678",
    })
    expect(context).not.toHaveProperty("watch_search.query")
  })
})
