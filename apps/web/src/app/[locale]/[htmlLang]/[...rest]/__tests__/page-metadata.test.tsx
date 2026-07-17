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
        "https://www.jesusfilm.org/watch/storyclubs.html/english.html",
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
        "https://www.jesusfilm.org/watch/wedding-in-cana.html/english.html",
      )
      expect(warnSpy).toHaveBeenCalledWith(
        "[watch] event=watch_metadata.episode.fallback seriesSlug=lumo-the-gospel-of-john episodeSlug=wedding-in-cana rawLocale=english detail=episode_timeout",
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})
