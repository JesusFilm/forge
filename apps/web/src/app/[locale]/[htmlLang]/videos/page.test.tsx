/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import VideosPage, { metadata } from "@/app/[locale]/[htmlLang]/videos/page"
import { resolveWatchLanguageInventory } from "@/lib/watch-language-inventory"

vi.mock("@/lib/watch-language-inventory", () => ({
  resolveWatchLanguageInventory: vi.fn(),
}))

const resolveWatchLanguageInventoryMock = vi.mocked(
  resolveWatchLanguageInventory,
)

describe("/videos route", () => {
  beforeEach(() => {
    resolveWatchLanguageInventoryMock.mockResolvedValue({
      languageSlug: "spanish-latin-american",
      languageName: "Spanish, Latin American",
      counts: {
        total: 3,
        audioCollections: 1,
        audioVideos: 1,
        subtitleOnlyVideos: 1,
      },
      promoted: [
        {
          id: "collection-1",
          coreId: "core-collection-1",
          title: "The Story of Jesus",
          description: "A collection for outreach teams.",
          imageUrl: null,
          imageAlt: "The Story of Jesus",
          label: "series",
          availability: "AUDIO",
          href: "/the-story-of-jesus.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentTitle: null,
          durationSeconds: null,
          childCount: 12,
          publishedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      audioCollections: [
        {
          id: "collection-1",
          coreId: "core-collection-1",
          title: "The Story of Jesus",
          description: "A collection for outreach teams.",
          imageUrl: null,
          imageAlt: "The Story of Jesus",
          label: "series",
          availability: "AUDIO",
          href: "/the-story-of-jesus.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentTitle: null,
          durationSeconds: null,
          childCount: 12,
          publishedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      audioVideos: [
        {
          id: "video-1",
          coreId: "core-video-1",
          title: "Jesus Calms the Storm",
          description: "A short film.",
          imageUrl: null,
          imageAlt: "Jesus Calms the Storm",
          label: "shortFilm",
          availability: "AUDIO",
          href: "/jesus-calms-the-storm.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentTitle: null,
          durationSeconds: 420,
          childCount: 0,
          publishedAt: "2026-05-20T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
        },
      ],
      subtitleOnlyVideos: [
        {
          id: "video-2",
          coreId: "core-video-2",
          title: "Following Jesus",
          description: "Available with translated subtitles.",
          imageUrl: null,
          imageAlt: "Following Jesus",
          label: "featureFilm",
          availability: "SUBTITLE_ONLY",
          href: "/following-jesus.html/english.html" as never,
          watchLanguageSlug: "english",
          parentTitle: null,
          durationSeconds: 3600,
          childCount: 0,
          publishedAt: "2026-05-15T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-15T00:00:00.000Z",
        },
      ],
    })
  })

  it("renders the language inventory page", async () => {
    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)
    expect(html).toContain("Spanish, Latin American")
    expect(html).toContain("content inventory")
    expect(html).toContain("The Story of Jesus")
    expect(html).toContain("Jesus Calms the Storm")
    expect(html).toContain("Following Jesus")
    expect(resolveWatchLanguageInventoryMock).toHaveBeenCalledWith(
      "es",
      "spanish-latin-american",
    )
  })

  it("orders audio sections before subtitles-only content", async () => {
    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)

    expect(
      html.indexOf('data-testid="language-inventory-audio-collections"'),
    ).toBeLessThan(
      html.indexOf('data-testid="language-inventory-audio-videos"'),
    )
    expect(
      html.indexOf('data-testid="language-inventory-audio-videos"'),
    ).toBeLessThan(
      html.indexOf('data-testid="language-inventory-subtitle-only"'),
    )
  })

  it("uses a playable audio route for subtitle-only cards", async () => {
    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)

    expect(html).toContain("/following-jesus.html/english.html")
    expect(html).toContain("Subtitles")
  })

  it("declares canonical URL with .html-free /videos shape", () => {
    expect(metadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/videos",
    )
  })

  it("does not include .html suffix in canonical (production contract)", () => {
    const canonical = metadata.alternates?.canonical
    expect(String(canonical)).not.toContain(".html")
  })
})
