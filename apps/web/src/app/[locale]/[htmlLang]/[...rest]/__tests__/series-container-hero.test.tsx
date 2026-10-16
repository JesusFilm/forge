/**
 * @vitest-environment jsdom
 *
 * End-to-end seam for the series-container hero: the REAL `@/lib/content`
 * resolver chain driving the REAL catch-all page, with only the admin client
 * faked. The sibling resolver suite proves a container RESOLVES a descendant
 * dub; this one proves that dub survives the page's `seriesLanguage` gate and
 * reaches `SeriesPageClient` — which is what decides whether a viewer sees a
 * player or a static poster.
 *
 * Without it, "Mandarin resolves" is proved and "Mandarin plays" is not:
 * page.tsx re-checks `selectedVariant.language.slug === seriesLanguage.slug`
 * and drops the variant on a mismatch, and `SeriesHero` renders its static
 * branch whenever `Boolean(variant.hls)` is false.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  queryMock,
  notFoundMock,
  redirectMock,
  seriesPageClientMock,
  getWatchRouteManifestMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  redirectMock: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  seriesPageClientMock: vi.fn(
    (_props: {
      series: unknown
      selectedVariant: {
        hls?: string | null
        language?: { slug?: string | null }
      } | null
      locale: string
    }) => <div data-testid="series-page-client-mock" />,
  ),
  getWatchRouteManifestMock: vi.fn(async () => null),
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  }
})

vi.mock("@/lib/admin-client", () => ({ default: { query: queryMock } }))

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}))

vi.mock("@/components/watch/SeriesPageClient", () => ({
  SeriesPageClient: seriesPageClientMock,
}))

vi.mock("@/components/watch/WatchPageClient", () => ({
  WatchPageClient: vi.fn(() => <div data-testid="watch-page-client-mock" />),
}))

vi.mock("@/components/home/WatchHomeExperiencePage", () => ({
  WatchHomeExperiencePage: vi.fn(() => null),
}))

vi.mock("@/components/watch/WatchQuestionPanel", () => ({
  WatchQuestionPanel: vi.fn(() => null),
}))

vi.mock("@/components/WatchRouteSurfaceRegistration", () => ({
  WatchRouteSurfaceRegistration: vi.fn(() => null),
}))

vi.mock("@/components/ExperienceEmpty", () => ({
  ExperienceEmpty: vi.fn(() => null),
}))

vi.mock("@/components/ExperienceError", () => ({
  ExperienceError: vi.fn(() => null),
}))

vi.mock("@/components/sections", () => ({
  ExperienceSectionRenderer: vi.fn(() => null),
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchCtaTextCopyEnabled: vi.fn(async () => false),
  isWatchHideBibleQuotesEnabled: vi.fn(async () => false),
  isWatchQuestionPanelEnabled: vi.fn(async () => false),
}))

vi.mock("@/lib/watch-transcript", () => ({
  getInitialSubtitleTranscript: vi.fn(),
}))

vi.mock("@/lib/watch-route-manifest", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/watch-route-manifest")
  >("@/lib/watch-route-manifest")
  return { ...actual, getWatchRouteManifest: getWatchRouteManifestMock }
})

import SlugRestPage from "@/app/[locale]/[htmlLang]/[...rest]/page"
import {
  buildAdminQueryImplementation,
  TWO_EPISODES,
  type EpisodePlan,
} from "@/lib/__tests__/fixtures/rivka-series-container"
import { resolveWatchLocaleIdentity } from "@/lib/locale"

let container: HTMLDivElement
let root: Root

function mockAdmin(plan: EpisodePlan) {
  queryMock.mockReset()
  queryMock.mockImplementation(buildAdminQueryImplementation(plan))
}

async function renderSeries(slug: string, rawLocale: string) {
  const identity = resolveWatchLocaleIdentity(rawLocale)
  const element = await SlugRestPage({
    params: Promise.resolve({ ...identity, rest: [slug, rawLocale] }),
  })
  act(() => {
    root.render(element)
  })
}

function heroProps() {
  const call = seriesPageClientMock.mock.calls.at(-1)
  return call?.[0]
}

beforeEach(() => {
  notFoundMock.mockClear()
  redirectMock.mockClear()
  seriesPageClientMock.mockClear()
  getWatchRouteManifestMock.mockClear()
  mockAdmin(TWO_EPISODES)
  container = document.createElement("div")
  document.body.appendChild(container)
  act(() => {
    root = createRoot(container)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe("series container hero — real resolver through the real page", () => {
  it("hands the Mandarin page a playable Mandarin episode dub", async () => {
    await renderSeries("rivka", "mandarin-china")

    expect(notFoundMock).not.toHaveBeenCalled()
    expect(seriesPageClientMock).toHaveBeenCalledTimes(1)
    expect(heroProps()?.locale).toBe("mandarin-china")
    // Non-null `hls` is exactly SeriesHero's trailer-mode gate.
    expect(heroProps()?.selectedVariant?.hls).toBe(
      "https://stream.example/rivka-1/mandarin-china.m3u8",
    )
    expect(heroProps()?.selectedVariant?.language?.slug).toBe("mandarin-china")
  })

  it("hands the English page a playable English episode dub", async () => {
    await renderSeries("rivka", "english")

    expect(notFoundMock).not.toHaveBeenCalled()
    expect(heroProps()?.selectedVariant?.hls).toBe(
      "https://stream.example/rivka-1/english.m3u8",
    )
  })

  it("never renders a hero in the wrong language", async () => {
    // Episodes are English-only, so Mandarin is not in `childDubLanguages`
    // and the page's `seriesLanguage` gate 404s before any hero is built.
    // The important half is the negative: no English stream is ever handed to
    // a Mandarin URL.
    mockAdmin({ "rivka-1": ["english"], "rivka-2": ["english"] })

    await expect(renderSeries("rivka", "mandarin-china")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    )
    expect(seriesPageClientMock).not.toHaveBeenCalled()
  })
})
