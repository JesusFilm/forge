/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import VideosPage, {
  generateMetadata,
} from "@/app/[locale]/[htmlLang]/videos/page"
import { generateMetadata as generateLanguageMetadata } from "@/app/[locale]/[htmlLang]/videos/[languageSlug]/page"
import { resolveWatchLanguageInventory } from "@/lib/watch-language-inventory"

vi.mock("@/lib/watch-language-inventory", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/watch-language-inventory")>()
  return {
    ...actual,
    resolveWatchLanguageInventory: vi.fn(),
  }
})

const resolveWatchLanguageInventoryMock = vi.mocked(
  resolveWatchLanguageInventory,
)

describe("/videos route", () => {
  beforeEach(() => {
    resolveWatchLanguageInventoryMock.mockResolvedValue({
      languageSlug: "spanish-latin-american",
      languageName: "Spanish, Latin American",
      languageNativeName: "Espanol latinoamericano",
      switcherLanguages: [
        {
          slug: "spanish-latin-american",
          languageName: "Spanish, Latin American",
          nativeName: "Espanol latinoamericano",
          bcp47: "es-419",
        },
        {
          slug: "french",
          languageName: "French",
          nativeName: "Francais",
          bcp47: "fr",
        },
      ],
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
    expect(html).toContain("Language collection")
    expect(html).toContain("Free Gospel video library for")
    expect(html).toContain("Spanish-speaking audiences")
    expect(html).toContain("New Gospel videos in")
    expect(html).toContain("Spanish audio Gospel videos")
    expect(html).toContain("Spanish subtitle-only Gospel videos")
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

  it("declares SEO metadata with .html-free /videos canonical shape", async () => {
    const pageMetadata = await generateMetadata({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })

    expect(pageMetadata.title).toBe(
      "Free Gospel Video Library for Spanish-Speaking Audiences | Jesus Film Project",
    )
    expect(pageMetadata.description).toContain(
      "Watch free Gospel videos, Jesus films, Bible stories, and discipleship series for Spanish-speaking audiences",
    )
    expect(pageMetadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/videos",
    )
    expect(pageMetadata.openGraph).toMatchObject({
      title:
        "Free Gospel Video Library for Spanish-Speaking Audiences | Jesus Film Project",
      url: "https://www.jesusfilm.org/watch/videos",
    })
  })

  it("does not include .html suffix in /videos canonical (production contract)", async () => {
    const pageMetadata = await generateMetadata({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const canonical = pageMetadata.alternates?.canonical
    expect(String(canonical)).not.toContain(".html")
  })

  it("uses language-specific SEO metadata for public language inventory pages", async () => {
    const pageMetadata = await generateLanguageMetadata({
      params: Promise.resolve({
        locale: "es",
        htmlLang: "es-419",
        languageSlug: "spanish-latin-american",
      }),
    })

    expect(pageMetadata.title).toBe(
      "Free Gospel Video Library for Spanish-Speaking Audiences | Jesus Film Project",
    )
    expect(pageMetadata.description).toContain(
      "with audio and subtitles in Spanish, Latin American",
    )
    expect(pageMetadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/spanish-latin-american.html/videos",
    )
  })
})
