/**
 * @vitest-environment jsdom
 *
 * Phase 2e — /{series}.html/{episode}/{lang}.html three-segment route.
 *
 * Mirrors the two-segment route test harness: mock resolvers and leaf
 * components, render the returned JSX through createRoot.
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  resolveSeriesEpisodeBySlugMock,
  notFoundMock,
  redirectMock,
  watchPageClientMock,
  experienceEmptyMock,
} = vi.hoisted(() => ({
  resolveSeriesEpisodeBySlugMock: vi.fn(),
  notFoundMock: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  redirectMock: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`)
  }),
  watchPageClientMock: vi.fn((_props: unknown) => null),
  experienceEmptyMock: vi.fn(() => null),
}))

vi.mock("@/lib/admin-client", () => ({
  default: { query: vi.fn() },
}))

vi.mock("@/lib/content", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/content")>("@/lib/content")
  return {
    ...actual,
    resolveSeriesEpisodeBySlug: resolveSeriesEpisodeBySlugMock,
  }
})

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}))

vi.mock("@/components/watch/WatchPageClient", () => ({
  WatchPageClient: watchPageClientMock,
}))

vi.mock("@/components/ExperienceEmpty", () => ({
  ExperienceEmpty: experienceEmptyMock,
}))

import SeriesEpisodePage from "@/app/[slug]/[episode]/[locale]/page"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  resolveSeriesEpisodeBySlugMock.mockReset()
  notFoundMock.mockClear()
  redirectMock.mockClear()
  watchPageClientMock.mockClear()
  experienceEmptyMock.mockClear()
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

function makeEpisodeResult(
  variantLang: { slug: string; bcp47: string; name: string } = {
    slug: "english",
    bcp47: "en",
    name: "English",
  },
) {
  return {
    video: {
      documentId: "ep-1",
      slug: "wedding-in-cana",
      title: "Wedding in Cana",
      label: "episode",
      images: [],
      children: [],
      variants: [],
      parents: [
        {
          documentId: "series-1",
          slug: "lumo-the-gospel-of-john",
          title: "Lumo Gospel of John",
          label: "series",
          images: [],
          children: [],
        },
      ],
    },
    canonicalParent: {
      documentId: "series-1",
      slug: "lumo-the-gospel-of-john",
      title: "Lumo Gospel of John",
      label: "series",
      images: [],
      children: [],
    },
    series: {
      documentId: "series-1",
      slug: "lumo-the-gospel-of-john",
      title: "Lumo Gospel of John",
      label: "series",
      images: [],
      children: [],
    },
    selectedVariant: {
      documentId: "var-1",
      hls: "https://cdn.example/ep.m3u8",
      muxVideo: { playbackId: "pb-1" },
      language: variantLang,
      published: true,
      duration: 30,
      downloads: [],
    },
  }
}

async function renderPage(slug: string, episode: string, locale: string) {
  // notFound() and redirect() throw — propagate uncaught so tests can assert.
  const element = await SeriesEpisodePage({
    params: Promise.resolve({ slug, episode, locale }),
  })
  act(() => {
    root.render(element)
  })
}

describe("SeriesEpisodePage routing", () => {
  it("renders WatchPageClient when episode + series resolve", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await renderPage("lumo-the-gospel-of-john", "wedding-in-cana", "english")
    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
    expect(resolveSeriesEpisodeBySlugMock).toHaveBeenCalledWith(
      "lumo-the-gospel-of-john",
      "wedding-in-cana",
      "english",
    )
  })

  it("strips .html from segments 0 and 2 (canonical 3-seg shape)", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await renderPage(
      "lumo-the-gospel-of-john.html",
      "wedding-in-cana",
      "english.html",
    )
    expect(resolveSeriesEpisodeBySlugMock).toHaveBeenCalledWith(
      "lumo-the-gospel-of-john",
      "wedding-in-cana",
      "english",
    )
  })

  it("defensively strips .html from episode segment if present (proxy contract guard)", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    // Malformed shape that arrives despite the proxy's Rule 4.5 — be robust.
    await renderPage("lumo.html", "wedding-in-cana.html", "english.html")
    expect(resolveSeriesEpisodeBySlugMock).toHaveBeenCalledWith(
      "lumo",
      "wedding-in-cana",
      "english",
    )
  })

  it("calls notFound() when resolver returns null", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(null)
    await expect(
      renderPage("lumo", "missing-episode", "english"),
    ).rejects.toThrow("NEXT_NOT_FOUND")
    expect(notFoundMock).toHaveBeenCalledTimes(1)
    expect(watchPageClientMock).not.toHaveBeenCalled()
  })

  it("redirects to canonical .html shape when URL locale doesn't match selected variant", async () => {
    // Resolver fell back to English even though URL requested German.
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await expect(
      renderPage("lumo-the-gospel-of-john", "wedding-in-cana", "german"),
    ).rejects.toThrow(
      /NEXT_REDIRECT:\/lumo-the-gospel-of-john\.html\/wedding-in-cana\/english\.html\?_lr=1/,
    )
  })

  it("does NOT redirect when URL locale matches the selected variant", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(makeEpisodeResult())
    await renderPage("lumo-the-gospel-of-john", "wedding-in-cana", "english")
    expect(redirectMock).not.toHaveBeenCalled()
    expect(watchPageClientMock).toHaveBeenCalledTimes(1)
  })

  it("forwards rawLocale (slug-form) into WatchPageClient", async () => {
    const result = makeEpisodeResult({
      slug: "spanish-castilian",
      bcp47: "es",
      name: "Spanish, Castilian",
    })
    resolveSeriesEpisodeBySlugMock.mockResolvedValue(result)
    await renderPage(
      "lumo-the-gospel-of-john",
      "wedding-in-cana",
      "spanish-castilian",
    )
    const props = watchPageClientMock.mock.calls[0]?.[0] as {
      languageSlug?: string
    }
    expect(props?.languageSlug).toBe("spanish-castilian")
  })
})
