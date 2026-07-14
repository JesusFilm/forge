/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

import LanguageVideosPage, {
  generateMetadata,
} from "@/app/[locale]/[htmlLang]/videos/[languageSlug]/page"
import { resolveWatchHome } from "@/lib/watch-home"
import { resolveWatchLanguageInventory } from "@/lib/watch-language-inventory"

vi.mock("@/lib/watch-language-inventory", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/watch-language-inventory")>()
  return {
    ...actual,
    resolveWatchLanguageInventory: vi.fn(),
  }
})

vi.mock("@/lib/watch-home", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/watch-home")>()
  return {
    ...actual,
    resolveWatchHome: vi.fn(),
  }
})

const resolveWatchLanguageInventoryMock = vi.mocked(
  resolveWatchLanguageInventory,
)
const resolveWatchHomeMock = vi.mocked(resolveWatchHome)

describe("/{language}.html/videos route", () => {
  beforeEach(() => {
    resolveWatchLanguageInventoryMock.mockReset()
    resolveWatchHomeMock.mockReset()
    resolveWatchHomeMock.mockResolvedValue({
      data: {
        heroSlides: [],
        carousel: {
          pools: [],
          muxInserts: [],
        },
        sections: [
          {
            id: "home-video-gospels",
            eyebrow: "Video Bible Collection",
            title: "Discover the full story",
            description: "Explore the collection in this language.",
            layout: "rail",
            orientation: "horizontal",
            showSequenceNumbers: false,
            cards: [
              {
                id: "home-card-1",
                sourceId: "1_jf-0-0",
                coreId: "1_jf-0-0",
                title: "JESUS",
                description: "The JESUS film in Spanish.",
                label: "Feature film",
                metaLabel: "2:03",
                href: "/jesus.html/spanish-latin-american.html",
                imageUrl: "https://imagedelivery.net/test/jesus/public",
                blurDataUrl: null,
                dominantColor: null,
                imageAlt: "JESUS still",
                hls: "https://stream.example/jesus.m3u8",
                playbackId: "mux-jesus",
                durationSeconds: 7380,
                childCount: 0,
                parentCoreId: null,
                parentSlug: null,
                missingData: [],
              },
            ],
          },
        ],
        missingData: [],
      },
      error: null,
    })
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
      ],
      counts: {
        total: 2,
        audioCollections: 1,
        audioVideos: 0,
        subtitleOnlyVideos: 0,
      },
      promoted: [],
      audioCollections: [
        {
          id: "collection-1",
          coreId: "core-collection-1",
          slug: "the-story-of-jesus",
          title: "The Story of Jesus",
          description: "A collection for outreach teams.",
          imageUrl: "https://imagedelivery.net/test/collection-story/public",
          imageAlt: "The Story of Jesus",
          label: "series",
          availability: "AUDIO",
          href: "/the-story-of-jesus.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 12,
          publishedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
      audioVideos: [],
      subtitleOnlyVideos: [],
    })
  })

  it("declares language-specific SEO metadata", async () => {
    const pageMetadata = await generateMetadata({
      params: Promise.resolve({
        locale: "es",
        htmlLang: "es-419",
        languageSlug: "spanish-latin-american",
      }),
    })

    expect(pageMetadata.title).toBe(
      "Free Christian Video Library for Spanish-Speaking Audiences | Jesus Film Project",
    )
    expect(pageMetadata.description).toContain(
      "with fully dubbed videos and subtitles in Spanish, Latin American",
    )
    expect(pageMetadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/spanish-latin-american.html/videos",
    )
  })

  it("renders home sections on public language inventory pages", async () => {
    const page = await LanguageVideosPage({
      params: Promise.resolve({
        locale: "es",
        htmlLang: "es-419",
        languageSlug: "spanish-latin-american",
      }),
    })
    const html = renderToString(page)

    expect(html).toContain("Spanish, Latin American")
    expect(html).toContain('data-testid="language-inventory-home-sections"')
    expect(html).toContain('data-testid="watch-home-section"')
    expect(html).toContain("Discover the full story")
    expect(html).toContain("/jesus.html/spanish-latin-american.html")
    expect(resolveWatchLanguageInventoryMock).toHaveBeenCalledWith(
      "es",
      "spanish-latin-american",
    )
    expect(resolveWatchHomeMock).toHaveBeenCalledWith(
      "es",
      "spanish-latin-american",
    )
  })
})
