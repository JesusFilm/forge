/**
 * @vitest-environment jsdom
 *
 * U4 — SeriesPageClient tests.
 *
 * Heavy children (SeriesHero, SeriesEpisodesGrid, ShareModal) are mocked at
 * the module boundary so the test isolates the orchestrator's modal state
 * machine, label pluralization, and prop passthrough — not the children's
 * own behavior, which has its own coverage.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/watch/SeriesHero", () => ({
  SeriesHero: vi.fn(({ overlay }: { overlay?: React.ReactNode }) => (
    <div data-testid="series-hero-mock">{overlay}</div>
  )),
}))

vi.mock("@/components/watch/SeriesEpisodesGrid", () => ({
  SeriesEpisodesGrid: vi.fn(({ episodes, locale }) => (
    <div
      data-testid="series-episodes-grid-mock"
      data-episode-count={episodes.length}
      data-locale={locale}
    />
  )),
}))

// Mock LanguageCombobox to a thin shell so SeriesPageClient tests don't
// need to drive the full combobox interaction (its own test suite owns
// behavior coverage). The mock just exposes the option count so passthrough
// can be asserted.
vi.mock("@/components/watch/LanguageCombobox", () => ({
  LanguageCombobox: vi.fn(
    ({
      options,
      value,
    }: {
      options: { slug: string; name: string }[]
      value: string
    }) => (
      <div
        data-testid="language-combobox-mock"
        data-option-count={options.length}
        data-value={value}
      />
    ),
  ),
}))

// next/navigation's useRouter requires app-router context that
// createRoot tests don't provide. Stub it to a no-op router so the
// click → router.push path is observable without app-router setup.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
}))

// language-preference-client writes a document.cookie value. Stub it so
// tests don't depend on jsdom's cookie store behavior.
vi.mock("@/lib/language-preference-client", () => ({
  writePreferredLanguageSlug: vi.fn(),
}))

const { shareModalMock } = vi.hoisted(() => ({
  shareModalMock: vi.fn(
    ({
      open,
      videoSlug,
      videoTitle,
    }: {
      open: boolean
      videoSlug: string
      videoTitle?: string | null
    }) => (
      <div
        data-testid="share-modal-mock"
        data-open={String(open)}
        data-slug={videoSlug}
        data-title={videoTitle ?? ""}
      />
    ),
  ),
}))

vi.mock("@/components/watch/ShareModal", () => ({
  ShareModal: shareModalMock,
}))

import { SeriesPageClient } from "@/components/watch/SeriesPageClient"
import type { ResolvedSeriesBySlug } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  shareModalMock.mockClear()
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

function makeSeries(overrides: Partial<Series> = {}): Series {
  return {
    documentId: "series-1",
    slug: "storyclubs",
    title: "StoryClubs",
    snippet: null,
    description: "A series description.",
    noIndex: false,
    label: "collection",
    imageAlt: null,
    images: [],
    primaryLanguage: { coreId: "529", bcp47: "en" },
    parents: [],
    children: [],
    variants: [],
    studyQuestions: [],
    bibleCitations: [],
    ...overrides,
  } as Series
}

function makeChildren(count: number): Series["children"] {
  return Array.from({ length: count }, (_, i) => ({
    documentId: `episode-${i + 1}`,
    slug: `ep-${i + 1}`,
    title: `Episode ${i + 1}`,
    label: "episode" as const,
    images: [],
    variants: [],
  })) as Series["children"]
}

describe("SeriesPageClient — pluralized label (R8, AE4)", () => {
  it("renders 'SERIES · 13 EPISODES' for 13 children (AE4)", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: makeChildren(13) }) as Series}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="series-page-label"]')?.textContent,
    ).toBe("SERIES · 13 EPISODES")
  })

  it("renders 'SERIES · 1 EPISODE' (singular) for exactly 1 child", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: makeChildren(1) }) as Series}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="series-page-label"]')?.textContent,
    ).toBe("SERIES · 1 EPISODE")
  })

  it("renders 'SERIES · 0 EPISODES' for an empty children array", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: [] }) as Series}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="series-page-label"]')?.textContent,
    ).toBe("SERIES · 0 EPISODES")
  })
})

describe("SeriesPageClient — share modal state machine", () => {
  it("starts with the share modal closed", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries()}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container
        .querySelector('[data-testid="series-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("none")
    expect(
      container
        .querySelector('[data-testid="share-modal-mock"]')
        ?.getAttribute("data-open"),
    ).toBe("false")
  })

  it("opens the share modal when the share pill is clicked", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries()}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    const shareButton = container.querySelector(
      '[data-testid="series-page-share-button"]',
    ) as HTMLButtonElement
    expect(shareButton).not.toBeNull()
    act(() => {
      shareButton.click()
    })
    expect(
      container
        .querySelector('[data-testid="series-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("share")
    // ShareModal is re-rendered with open=true on the next render — the mock
    // captures the latest props as the new attribute.
    const allMockOpens = Array.from(
      container.querySelectorAll('[data-testid="share-modal-mock"]'),
    )
    expect(allMockOpens.at(-1)?.getAttribute("data-open")).toBe("true")
  })
})

describe("SeriesPageClient — passthrough to children", () => {
  it("passes the series locale into the episodes grid", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: makeChildren(2) }) as Series}
          selectedVariant={null}
          locale="es"
        />,
      )
    })
    const grid = container.querySelector(
      '[data-testid="series-episodes-grid-mock"]',
    )
    expect(grid?.getAttribute("data-locale")).toBe("es")
    expect(grid?.getAttribute("data-episode-count")).toBe("2")
  })

  it("passes series.slug + title to the ShareModal", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ slug: "storyclubs", title: "StoryClubs" })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    const modal = container.querySelector('[data-testid="share-modal-mock"]')
    expect(modal?.getAttribute("data-slug")).toBe("storyclubs")
    expect(modal?.getAttribute("data-title")).toBe("StoryClubs")
  })
})

describe("SeriesPageClient — edge cases", () => {
  it("renders an empty H1 when series.title is null", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ title: null })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="series-page-title"]')?.textContent,
    ).toBe("")
  })

  it("omits the description paragraph when description and snippet are both null", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ description: null, snippet: null })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="series-page-description"]'),
    ).toBeNull()
  })
})
