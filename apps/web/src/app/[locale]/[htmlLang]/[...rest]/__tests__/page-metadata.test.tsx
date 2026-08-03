/**
 * @vitest-environment jsdom
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  resolveWatchRouteBySlugMock,
  resolveSeriesEpisodeBySlugMock,
  resolveWatchPageMock,
} = vi.hoisted(() => ({
  resolveWatchRouteBySlugMock: vi.fn(),
  resolveSeriesEpisodeBySlugMock: vi.fn(),
  resolveWatchPageMock: vi.fn(),
}))

vi.mock("@/lib/admin-client", () => ({
  default: { query: vi.fn() },
}))

vi.mock("@/lib/content", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/content")>("@/lib/content")
  return {
    ...actual,
    resolveWatchRouteBySlug: resolveWatchRouteBySlugMock,
    resolveSeriesEpisodeBySlug: resolveSeriesEpisodeBySlugMock,
    resolveWatchPage: resolveWatchPageMock,
  }
})

vi.mock("@/lib/watch-home", () => ({
  resolveWatchHome: vi.fn(),
}))

vi.mock("@/lib/watch-transcript", () => ({
  getInitialSubtitleTranscript: vi.fn(),
}))

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock("@/components/watch/SeriesPageClient", () => ({
  SeriesPageClient: vi.fn(),
}))

vi.mock("@/components/watch/WatchPageClient", () => ({
  WatchPageClient: vi.fn(),
}))

vi.mock("@/components/home/WatchHomePage", () => ({
  WatchHomePage: vi.fn(),
}))

vi.mock("@/components/watch/WatchQuestionPanel", () => ({
  WatchQuestionPanel: vi.fn(),
}))

vi.mock("@/components/ExperienceEmpty", () => ({
  ExperienceEmpty: vi.fn(),
}))

vi.mock("@/components/ExperienceError", () => ({
  ExperienceError: vi.fn(),
}))

vi.mock("@/components/sections", () => ({
  ExperienceSectionRenderer: vi.fn(),
}))

vi.mock("@/lib/feature-flags", () => ({
  isWatchCtaTextCopyEnabled: vi.fn(),
  isWatchHideBibleQuotesEnabled: vi.fn(),
  isWatchQuestionPanelEnabled: vi.fn(),
}))

import { generateMetadata } from "@/app/[locale]/[htmlLang]/[...rest]/page"

const approvedTitle =
  "Watch JESUS — Full Movie Free Online | Jesus Film Project"
const approvedDescription =
  "Watch the JESUS film free online. Follow his life, teachings, miracles, death, and resurrection through the Gospel of Luke in more than 2,000 languages."

const selectedVariant = {
  documentId: "dub-es",
  slug: null,
  published: true,
  hls: "https://cdn.example/jesus-es.m3u8",
  duration: 7200,
  language: {
    slug: "spanish-castilian",
    bcp47: "es",
    coreId: "21028",
    name: "Spanish, Castilian",
    nativeName: "Español",
  },
  downloads: [],
  muxVideo: { playbackId: "mux-es" },
}

const videoWithOverrides = {
  documentId: "video-jesus",
  slug: "jesus",
  publishedAt: "2026-06-01T12:00:00.000Z",
  localePublishedAt: null,
  title: "JESÚS",
  snippet: "Resumen visible",
  description: "Descripción visible",
  searchTitle: `  ${approvedTitle}  `,
  searchDescription: `  ${approvedDescription}  `,
  socialImage: {
    url: "https://media.example/jesus-social.jpg",
    width: 1200,
    height: 630,
  },
  noIndex: false,
  label: "featureFilm",
  imageAlt: "JESÚS film still",
  images: [],
  primaryLanguage: null,
  parents: [],
  children: [],
  childDubLanguages: [],
  variants: [selectedVariant],
  subtitles: [],
  studyQuestions: [],
  bibleCitations: [],
}

beforeEach(() => {
  resolveWatchRouteBySlugMock.mockReset()
  resolveSeriesEpisodeBySlugMock.mockReset()
  resolveWatchPageMock.mockReset()
  resolveWatchPageMock.mockResolvedValue({
    data: null,
    error: new Error("No experience found"),
  })
})

describe("Watch metadata fallback observability", () => {
  it("logs video metadata resolver fallbacks in the Watch event format", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    resolveWatchRouteBySlugMock.mockRejectedValue(
      new Error("Apollo resolver failed"),
    )

    try {
      const metadata = await generateMetadata({
        params: Promise.resolve({
          locale: "en",
          htmlLang: "en",
          rest: ["storyclubs.html", "english.html"],
        }),
      })

      expect(metadata.alternates?.canonical).toBe(
        "https://www.jesusfilm.org/watch/storyclubs.html",
      )
      expect(warnSpy).toHaveBeenCalledWith(
        "[watch] event=watch_metadata.video.fallback slug=storyclubs rawLocale=english detail=Apollo_resolver_failed",
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("logs episode metadata resolver fallbacks in the Watch event format", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    resolveSeriesEpisodeBySlugMock.mockRejectedValue(
      new Error("episode timeout"),
    )

    try {
      const metadata = await generateMetadata({
        params: Promise.resolve({
          locale: "en",
          htmlLang: "en",
          rest: [
            "lumo-the-gospel-of-john.html",
            "wedding-in-cana",
            "english.html",
          ],
        }),
      })

      expect(metadata.alternates?.canonical).toBe(
        "https://www.jesusfilm.org/watch/wedding-in-cana.html",
      )
      expect(warnSpy).toHaveBeenCalledWith(
        "[watch] event=watch_metadata.episode.fallback seriesSlug=lumo-the-gospel-of-john episodeSlug=wedding-in-cana rawLocale=english detail=episode_timeout",
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe("Watch Search and Social metadata route parity", () => {
  it("emits the exact approved overrides for an explicit playable route", async () => {
    resolveWatchRouteBySlugMock.mockResolvedValue({
      kind: "video",
      video: videoWithOverrides,
      selectedVariant,
    })

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: "es",
        htmlLang: "es",
        rest: ["jesus.html", "spanish-castilian.html"],
      }),
    })

    expect(metadata.title).toBe(approvedTitle)
    expect(metadata.description).toBe(approvedDescription)
    expect(metadata.openGraph).toMatchObject({
      title: approvedTitle,
      description: approvedDescription,
      siteName: "Jesus Film Project",
      locale: "es_ES",
      images: [{ url: "https://media.example/jesus-social.jpg" }],
    })
    expect(metadata.twitter).toMatchObject({
      title: approvedTitle,
      description: approvedDescription,
      images: [{ url: "https://media.example/jesus-social.jpg" }],
    })
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/jesus.html/spanish-castilian.html",
    )
    expect(metadata.robots).toEqual({ index: true, follow: true })
  })

  it("uses the same override semantics for a playable episode route", async () => {
    resolveSeriesEpisodeBySlugMock.mockResolvedValue({
      series: { documentId: "series-1", slug: "jesus-series" },
      video: {
        ...videoWithOverrides,
        documentId: "episode-1",
        slug: "jesus-is-born",
        title: "Jesús nace",
      },
      selectedVariant,
    })

    const metadata = await generateMetadata({
      params: Promise.resolve({
        locale: "es",
        htmlLang: "es",
        rest: ["jesus-series.html", "jesus-is-born", "spanish-castilian.html"],
      }),
    })

    expect(metadata.title).toBe(approvedTitle)
    expect(metadata.description).toBe(approvedDescription)
    expect(metadata.openGraph).toMatchObject({
      title: approvedTitle,
      description: approvedDescription,
      images: [{ url: "https://media.example/jesus-social.jpg" }],
    })
    expect(metadata.twitter).toMatchObject({
      title: approvedTitle,
      description: approvedDescription,
      images: [{ url: "https://media.example/jesus-social.jpg" }],
    })
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/jesus-is-born.html/spanish-castilian.html",
    )
  })
})
