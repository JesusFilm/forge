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

const { collectionDownloadModalMock, resolveDownloadSessionAccessMock } =
  vi.hoisted(() => ({
    collectionDownloadModalMock: vi.fn(() => null),
    resolveDownloadSessionAccessMock: vi.fn(),
  }))

vi.mock("next/dynamic", () => ({
  default: () => collectionDownloadModalMock,
}))

vi.mock("@/components/watch/download-session-access", () => ({
  resolveDownloadSessionAccess: resolveDownloadSessionAccessMock,
}))

vi.mock("@/components/watch/SeriesHero", () => ({
  SeriesHero: vi.fn(({ overlay }: { overlay?: React.ReactNode }) => (
    <div data-testid="series-hero-mock">{overlay}</div>
  )),
}))

vi.mock("@/components/watch/SeriesEpisodesGrid", () => ({
  SeriesEpisodesGrid: vi.fn(({ episodes, languageSlug }) => (
    <div
      data-testid="series-episodes-grid-mock"
      data-episode-count={episodes.length}
      data-language-slug={languageSlug}
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
      onChange,
    }: {
      options: { slug: string; name: string }[]
      value: string
      onChange: (slug: string) => void
    }) => (
      <button
        type="button"
        data-testid="language-combobox-mock"
        data-option-count={options.length}
        data-value={value}
        // Surface onChange so handleLanguageChange can be driven from a
        // test without standing up the real combobox interaction.
        onClick={() => onChange(options.find((o) => o.slug !== value)!.slug)}
      />
    ),
  ),
}))

// next/navigation's useRouter requires app-router context that
// createRoot tests don't provide. Stub it to a no-op router so the
// click → router.push path is observable without app-router setup.
// The push spy is hoisted so handleLanguageChange navigation can be
// asserted against the .html-shaped path the @/lib/routes builder emits.
const { pushMock, writePreferredLanguageSlugMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  writePreferredLanguageSlugMock: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
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
  writePreferredLanguageSlug: writePreferredLanguageSlugMock,
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
  pushMock.mockClear()
  writePreferredLanguageSlugMock.mockClear()
  collectionDownloadModalMock.mockClear()
  resolveDownloadSessionAccessMock.mockReset()
  resolveDownloadSessionAccessMock.mockResolvedValue({
    ok: true,
    accountGateEnabled: false,
  })
  window.history.replaceState({}, "", "/")
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
    childDubLanguages: [],
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
    durationSeconds: null,
    muxPlaybackId: null,
    muxThumbnailBlurDataUrl: null,
  })) as Series["children"]
}

// Helper for tests that exercise the language picker (aggregation, globe
// button visibility, dedup checks). The cross-episode dub-language union is
// aggregated + deduped server-side onto `series.childDubLanguages`, which
// carries only display fields {slug, name, bcp47} — every entry is already
// guaranteed playable, so there are no published/hls fields to model.
type LanguageSpec = {
  languageSlug: string
  languageName?: string
  bcp47?: string | null
}

function makeLanguage({
  languageSlug,
  languageName,
  bcp47 = null,
}: LanguageSpec) {
  return {
    slug: languageSlug,
    name: languageName ?? languageSlug,
    bcp47,
  }
}

// Flattens the per-episode language specs into the single
// `childDubLanguages` list admin emits. Duplicates across the nested arrays
// are preserved so the client-side belt-and-braces slug dedup is still
// exercised by the dedup test.
function makeChildDubLanguages(
  perChildLanguages: LanguageSpec[][],
): Series["childDubLanguages"] {
  return perChildLanguages
    .flat()
    .map(makeLanguage) as Series["childDubLanguages"]
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

describe("SeriesPageClient — collection downloads", () => {
  it("renders the control only when the collection has episodes", () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: makeChildren(2) })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="series-page-download-button"]'),
    ).not.toBeNull()

    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: [] })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container.querySelector('[data-testid="series-page-download-button"]'),
    ).toBeNull()
  })

  it("opens the anonymous lazy modal when the account gate is disabled", async () => {
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: makeChildren(2) })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })

    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="series-page-download-button"]',
        ) as HTMLButtonElement
      ).click()
    })

    expect(resolveDownloadSessionAccessMock).toHaveBeenCalledTimes(1)
    expect(
      container
        .querySelector('[data-testid="series-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("download")
    expect(collectionDownloadModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        collectionSlug: "storyclubs",
        episodes: [
          expect.objectContaining({ documentId: "episode-1" }),
          expect.objectContaining({ documentId: "episode-2" }),
        ],
        accountGateEnabled: false,
        authRequiredLoginUrl: null,
      }),
      undefined,
    )
  })

  it("passes an enabled account gate to the authenticated modal", async () => {
    resolveDownloadSessionAccessMock.mockResolvedValueOnce({
      ok: true,
      accountGateEnabled: true,
    })
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: makeChildren(1) })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="series-page-download-button"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(collectionDownloadModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accountGateEnabled: true,
        authRequiredLoginUrl: null,
      }),
      undefined,
    )
  })

  it("passes the sign-in URL to the collection modal", async () => {
    resolveDownloadSessionAccessMock.mockResolvedValueOnce({
      ok: false,
      accountGateEnabled: true,
      reason: "auth-required",
      loginUrl: "/login",
    })
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: makeChildren(1) })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    await act(async () => {
      ;(
        container.querySelector(
          '[data-testid="series-page-download-button"]',
        ) as HTMLButtonElement
      ).click()
    })
    expect(collectionDownloadModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accountGateEnabled: true,
        authRequiredLoginUrl: "/login",
      }),
      undefined,
    )
  })

  it("does not replace a newer share modal when session checking finishes", async () => {
    let resolveSession:
      | ((value: { ok: true; accountGateEnabled: false }) => void)
      | undefined
    resolveDownloadSessionAccessMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve
      }),
    )
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: makeChildren(1) })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })

    act(() => {
      ;(
        container.querySelector(
          '[data-testid="series-page-download-button"]',
        ) as HTMLButtonElement
      ).click()
    })
    act(() => {
      ;(
        container.querySelector(
          '[data-testid="series-page-share-button"]',
        ) as HTMLButtonElement
      ).click()
    })
    await act(async () => {
      resolveSession?.({ ok: true, accountGateEnabled: false })
      await Promise.resolve()
    })

    expect(
      container
        .querySelector('[data-testid="series-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("share")
  })

  it("reopens the collection flow after returning from sign-in", async () => {
    resolveDownloadSessionAccessMock.mockResolvedValueOnce({
      ok: true,
      accountGateEnabled: true,
    })
    window.history.replaceState({}, "", "/storyclubs.html/en.html?download=1")
    await act(async () => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ children: makeChildren(1) })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    expect(
      container
        .querySelector('[data-testid="series-page-client"]')
        ?.getAttribute("data-modal-state"),
    ).toBe("download")
    expect(resolveDownloadSessionAccessMock).toHaveBeenCalledTimes(1)
    expect(collectionDownloadModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountGateEnabled: true }),
      undefined,
    )
    expect(window.location.search).toBe("")
  })
})

describe("SeriesPageClient — passthrough to children", () => {
  it("passes the resolved audio language slug into the episodes grid", () => {
    const childDubLanguages = makeChildDubLanguages([
      [{ languageSlug: "english", bcp47: "en" }],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={
            makeSeries({
              children: makeChildren(2),
              childDubLanguages,
            }) as Series
          }
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    const grid = container.querySelector(
      '[data-testid="series-episodes-grid-mock"]',
    )
    expect(grid?.getAttribute("data-language-slug")).toBe("english")
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
    const childDubLanguages = makeChildDubLanguages([
      [{ languageSlug: "english" }],
      [{ languageSlug: "english" }],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ childDubLanguages })}
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
    const childDubLanguages = makeChildDubLanguages([
      [
        { languageSlug: "english", bcp47: "en" },
        { languageSlug: "spanish", bcp47: "es" },
      ],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ childDubLanguages })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    const languageButton = container.querySelector(
      '[data-testid="series-page-language-button"]',
    )
    expect(languageButton).not.toBeNull()
    expect(
      languageButton?.querySelector('[data-testid="series-page-language-code"]')
        ?.textContent,
    ).toBe("EN")
  })

  it("opens the language modal when the globe button is clicked", () => {
    const childDubLanguages = makeChildDubLanguages([
      [{ languageSlug: "english" }, { languageSlug: "spanish" }],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ childDubLanguages })}
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

  it("dedupes languages by slug when projecting to the picker", () => {
    // Two children both carry English + Spanish dubs. The picker projection
    // should fold the cross-episode duplicates into one entry per language.
    const childDubLanguages = makeChildDubLanguages([
      [{ languageSlug: "english" }, { languageSlug: "spanish" }],
      [{ languageSlug: "english" }, { languageSlug: "spanish" }],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ childDubLanguages })}
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

  it("surfaces every server-provided language (playability filtering is server-side)", () => {
    // childDubLanguages is already filtered to playable dubs by admin, so the
    // client trusts it verbatim — no client-side published/hls re-filter.
    const childDubLanguages = makeChildDubLanguages([
      [
        { languageSlug: "english" },
        { languageSlug: "spanish" },
        { languageSlug: "french" },
      ],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({ childDubLanguages })}
          selectedVariant={null}
          locale="en"
        />,
      )
    })
    const modal = container.querySelector(
      '[data-testid="language-picker-modal-mock"]',
    )
    expect(modal?.getAttribute("data-variant-count")).toBe("3")
  })
})

describe("SeriesPageClient — handleLanguageChange navigation (Phase 4)", () => {
  it("pushes the .html-shaped two-segment watch path built by @/lib/routes", () => {
    const childDubLanguages = makeChildDubLanguages([
      [{ languageSlug: "english" }, { languageSlug: "spanish-castilian" }],
    ])
    act(() => {
      root.render(
        <SeriesPageClient
          series={makeSeries({
            slug: "lumo-the-gospel-of-john",
            childDubLanguages,
          })}
          selectedVariant={null}
          locale="english"
        />,
      )
    })
    const combobox = container.querySelector(
      '[data-testid="language-combobox-mock"]',
    ) as HTMLButtonElement
    // Current value is "english"; the mock onChange picks the first
    // differing slug → "spanish-castilian".
    act(() => {
      combobox.click()
    })
    expect(pushMock).toHaveBeenCalledTimes(1)
    expect(pushMock).toHaveBeenCalledWith(
      "/lumo-the-gospel-of-john.html/spanish-castilian.html",
    )
    expect(writePreferredLanguageSlugMock).toHaveBeenCalledWith(
      "spanish-castilian",
    )
  })
})
