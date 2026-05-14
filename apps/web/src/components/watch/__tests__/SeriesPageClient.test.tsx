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

const { shareModalMock, languagePickerModalMock } = vi.hoisted(() => ({
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
  languagePickerModalMock: vi.fn(
    ({
      open,
      variants,
      currentLanguageSlug,
    }: {
      open: boolean
      variants: Array<{ language: { slug: string | null } | null }>
      currentLanguageSlug: string
    }) => (
      <div
        data-testid="language-picker-modal-mock"
        data-open={String(open)}
        data-variant-count={String(variants.length)}
        data-current-slug={currentLanguageSlug}
      />
    ),
  ),
}))

vi.mock("@/components/watch/ShareModal", () => ({
  ShareModal: shareModalMock,
}))

vi.mock("@/components/watch/LanguagePickerModal", () => ({
  LanguagePickerModal: languagePickerModalMock,
}))

import { SeriesPageClient } from "@/components/watch/SeriesPageClient"
import type { ResolvedSeriesBySlug } from "@/lib/content"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  shareModalMock.mockClear()
  languagePickerModalMock.mockClear()
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

// Helper for tests that need playable variants on the children
// (language aggregation, globe button visibility, dedup checks).
type VariantSpec = {
  documentId?: string
  languageSlug: string
  languageName?: string
  bcp47?: string | null
  published?: boolean
  hls?: string | null
}

function makeVariant({
  documentId,
  languageSlug,
  languageName,
  bcp47 = null,
  published = true,
  hls = "https://stream.mux.com/x.m3u8",
}: VariantSpec) {
  return {
    documentId: documentId ?? `var-${languageSlug}`,
    published,
    hls,
    duration: 120,
    language: {
      slug: languageSlug,
      name: languageName ?? languageSlug,
      bcp47,
    },
  }
}

function makeChildrenWithVariants(
  perChildVariants: VariantSpec[][],
): Series["children"] {
  return perChildVariants.map((vs, i) => ({
    documentId: `episode-${i + 1}`,
    slug: `ep-${i + 1}`,
    title: `Episode ${i + 1}`,
    label: "episode" as const,
    images: [],
    variants: vs.map(makeVariant),
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

describe("SeriesPageClient — globe button + language modal", () => {
  it("omits the globe button when fewer than 2 languages are available across children", () => {
    const children = makeChildrenWithVariants([
      [{ languageSlug: "english" }],
      [{ languageSlug: "english" }],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="series-page-language-button"]'),
    ).toBeNull()
  })

  it("renders the globe button when 2+ languages are available", () => {
    const children = makeChildrenWithVariants([
      [{ languageSlug: "english" }, { languageSlug: "spanish" }],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="series-page-language-button"]'),
    ).not.toBeNull()
  })

  it("opens the language modal when the globe button is clicked", () => {
    const children = makeChildrenWithVariants([
      [{ languageSlug: "english" }, { languageSlug: "spanish" }],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    const button = container.querySelector(
      '[data-testid="series-page-language-button"]',
    ) as HTMLButtonElement
    act(() => {
      button.click()
    })
    expect(
      container
        .querySelector('[data-testid="series-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("language")
    const allMockOpens = Array.from(
      container.querySelectorAll('[data-testid="language-picker-modal-mock"]'),
    )
    expect(allMockOpens.at(-1)?.getAttribute("data-open")).toBe("true")
  })

  it("dedupes variants by language slug when projecting to the picker", () => {
    // Two children both carry English + Spanish variants. The picker
    // projection should fold the cross-episode duplicates into one
    // entry per language.
    const children = makeChildrenWithVariants([
      [
        { documentId: "v1a", languageSlug: "english" },
        { documentId: "v1b", languageSlug: "spanish" },
      ],
      [
        { documentId: "v2a", languageSlug: "english" },
        { documentId: "v2b", languageSlug: "spanish" },
      ],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    const modal = container.querySelector(
      '[data-testid="language-picker-modal-mock"]',
    )
    expect(modal?.getAttribute("data-variant-count")).toBe("2")
  })

  it("excludes unpublished and null-hls variants from the picker projection", () => {
    const children = makeChildrenWithVariants([
      [
        { languageSlug: "english" },
        { languageSlug: "spanish", published: false },
        { languageSlug: "french", hls: null },
      ],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    const modal = container.querySelector(
      '[data-testid="language-picker-modal-mock"]',
    )
    // Only english survives the playable-variant filter.
    expect(modal?.getAttribute("data-variant-count")).toBe("1")
  })
})
