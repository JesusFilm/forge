/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

import VideosPage, {
  generateMetadata,
} from "@/app/[locale]/[htmlLang]/videos/page"
import LanguageVideosPage, {
  generateMetadata as generateLanguageMetadata,
} from "@/app/[locale]/[htmlLang]/videos/[languageSlug]/page"
import { resolveWatchLanguageInventory } from "@/lib/watch-language-inventory"
import { resolveWatchHome } from "@/lib/watch-home"

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

describe("/videos route", () => {
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
        {
          slug: "french",
          languageName: "French",
          nativeName: "Francais",
          bcp47: "fr",
        },
      ],
      counts: {
        total: 13,
        audioCollections: 8,
        audioVideos: 4,
        subtitleOnlyVideos: 1,
      },
      promoted: [
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
        {
          id: "collection-2",
          coreId: "core-collection-2",
          slug: "lumo-the-gospel-of-luke",
          title: "LUMO - The Gospel of Luke",
          description: "The Gospel of Luke in Spanish.",
          imageUrl: "https://imagedelivery.net/test/collection-lumo/public",
          imageAlt: "LUMO - The Gospel of Luke",
          label: "series",
          availability: "AUDIO",
          href: "/lumo-the-gospel-of-luke.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 24,
          publishedAt: "2026-05-25T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-25T00:00:00.000Z",
        },
        {
          id: "collection-3",
          coreId: "core-collection-3",
          slug: "jesus",
          title: "JESUS",
          description: "The JESUS film in Spanish.",
          imageUrl: null,
          imageAlt: "JESUS",
          label: "featureFilm",
          availability: "AUDIO",
          href: "/jesus.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 1,
          publishedAt: "2026-05-20T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
        },
        {
          id: "collection-4",
          coreId: "core-collection-4",
          slug: "magdalena",
          title: "Magdalena",
          description: "Magdalena in Spanish.",
          imageUrl: null,
          imageAlt: "Magdalena",
          label: "featureFilm",
          availability: "AUDIO",
          href: "/magdalena.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 1,
          publishedAt: "2026-05-18T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
        {
          id: "collection-5",
          coreId: "core-collection-5",
          slug: "book-of-acts-bible-study",
          title: "Book of Acts Bible Study",
          description: "Acts study videos in Spanish.",
          imageUrl: null,
          imageAlt: "Book of Acts Bible Study",
          label: "series",
          availability: "AUDIO",
          href: "/book-of-acts-bible-study.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 12,
          publishedAt: "2026-05-15T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-15T00:00:00.000Z",
        },
        {
          id: "collection-6",
          coreId: "core-collection-6",
          slug: "english-bible-course",
          title: "English Bible Course",
          description: "Bible teaching with English dubbing.",
          imageUrl: null,
          imageAlt: "English Bible Course",
          label: "series",
          availability: "AUDIO",
          href: "/english-bible-course.html/english.html" as never,
          watchLanguageSlug: "english",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 8,
          publishedAt: "2026-05-10T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-10T00:00:00.000Z",
        },
        {
          id: "collection-7",
          coreId: "core-collection-7",
          slug: "how-to-read-bible",
          title: "How to Read the Bible",
          description: "BibleProject collection in Spanish dubbing.",
          imageUrl: null,
          imageAlt: "How to Read the Bible",
          label: "series",
          availability: "AUDIO",
          href: "/how-to-read-bible.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 19,
          publishedAt: "2026-05-05T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-05T00:00:00.000Z",
        },
        {
          id: "collection-8",
          coreId: "core-collection-8",
          slug: "sports",
          title: "Deportes",
          description:
            "Sports stories that help Spanish-speaking audiences explore spiritual themes.",
          imageUrl: null,
          imageAlt: "Deportes",
          label: "collection",
          availability: "AUDIO",
          href: "/sports.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: null,
          childCount: 11,
          publishedAt: "2026-05-03T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-03T00:00:00.000Z",
        },
      ],
      audioVideos: [
        {
          id: "video-3",
          coreId: "core-video-3",
          slug: "walking-on-water",
          title: "2. Walking on Water",
          description: "An episode from the same parent collection.",
          imageUrl: "https://imagedelivery.net/test/walking/public",
          imageAlt: "Walking on Water",
          label: "episode",
          availability: "AUDIO",
          href: "/the-story-of-jesus.html/walking-on-water.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: "the-story-of-jesus",
          parentTitle: "The Story of Jesus",
          parentOrder: 0,
          durationSeconds: 360,
          childCount: 0,
          publishedAt: "2026-05-19T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-19T00:00:00.000Z",
        },
        {
          id: "video-1",
          coreId: "core-video-1",
          slug: "jesus-calms-the-storm",
          title: "1. Jesus Calms the Storm",
          description: "A short film.",
          imageUrl: "https://imagedelivery.net/test/storm/public",
          imageAlt: "Jesus Calms the Storm",
          label: "shortFilm",
          availability: "AUDIO",
          href: "/jesus-calms-the-storm.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: "the-story-of-jesus",
          parentTitle: "The Story of Jesus",
          parentOrder: 1,
          durationSeconds: 420,
          childCount: 0,
          publishedAt: "2026-05-20T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-20T00:00:00.000Z",
        },
        {
          id: "video-4",
          coreId: "core-video-4",
          slug: "birth-of-jesus",
          title: "Birth of Jesus",
          description: "A LUMO episode.",
          imageUrl: "https://imagedelivery.net/test/birth/public",
          imageAlt: "Birth of Jesus",
          label: "episode",
          availability: "AUDIO",
          href: "/lumo-the-gospel-of-luke.html/birth-of-jesus.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: "lumo-the-gospel-of-luke",
          parentTitle: "LUMO - The Gospel of Luke",
          durationSeconds: 510,
          childCount: 0,
          publishedAt: "2026-05-18T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-18T00:00:00.000Z",
        },
        {
          id: "video-5",
          coreId: "core-video-5",
          slug: "hope-film",
          title: "Hope Film",
          description: "A standalone dubbed film.",
          imageUrl: "https://imagedelivery.net/test/hope/public",
          imageAlt: "Hope Film",
          label: "shortFilm",
          availability: "AUDIO",
          href: "/hope-film.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: 240,
          childCount: 0,
          publishedAt: "2026-05-17T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-05-17T00:00:00.000Z",
        },
      ],
      subtitleOnlyVideos: [
        {
          id: "video-2",
          coreId: "core-video-2",
          slug: "following-jesus",
          title: "Following Jesus",
          description: "Available with translated subtitles.",
          imageUrl: null,
          imageAlt: "Following Jesus",
          label: "featureFilm",
          availability: "SUBTITLE_ONLY",
          href: "/following-jesus.html/english.html" as never,
          watchLanguageSlug: "english",
          parentSlug: null,
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
    expect(html).toContain("Free Christian videos for")
    expect(html).toContain("Spanish-speaking audiences")
    expect(html).toContain('data-testid="language-inventory-home-sections"')
    expect(html).toContain('data-testid="watch-home-section"')
    expect(html).toContain("Discover the full story")
    expect(html).toContain("/jesus.html/spanish-latin-american.html")
    expect(html).toContain("New Christian videos in")
    expect(html).toContain("Spanish Video Bible collections")
    expect(html).toContain("Spanish BibleProject collections")
    expect(html).toContain("Spanish sports and athlete stories")
    expect(html).toContain("Spanish videos by collection")
    expect(html).toContain("Spanish videos with subtitles")
    expect(html).not.toContain("Spanish dubbed Gospel videos")
    expect(html).not.toContain('data-testid="language-inventory-audio-videos"')
    expect(html).toContain("The Story of Jesus")
    expect(html).toContain("LUMO - The Gospel of Luke")
    expect(html).toContain("JESUS")
    expect(html).toContain("Magdalena")
    expect(html).toContain("Book of Acts Bible Study")
    expect(html).toContain("How to Read the Bible")
    expect(html).toContain("Deportes")
    expect(html).toContain("Jesus Calms the Storm")
    expect(html).toContain("Walking on Water")
    expect(html).toContain("Birth of Jesus")
    expect(html).toContain("Hope Film")
    expect(html).toContain("Following Jesus")
    expect(resolveWatchLanguageInventoryMock).toHaveBeenCalledWith(
      "es",
      "spanish-latin-american",
    )
    expect(resolveWatchHomeMock).toHaveBeenCalledWith(
      "es",
      "spanish-latin-american",
    )
  })

  it("falls back to home sections while rewriting links to the inventory language", async () => {
    resolveWatchHomeMock
      .mockResolvedValueOnce({
        data: {
          heroSlides: [],
          carousel: {
            pools: [],
            muxInserts: [],
          },
          sections: [],
          missingData: [],
        },
        error: null,
      })
      .mockResolvedValueOnce({
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
              description: "Explore the collection.",
              layout: "rail",
              orientation: "horizontal",
              showSequenceNumbers: false,
              cards: [
                {
                  id: "home-card-1",
                  sourceId: "1_jf-0-0",
                  coreId: "1_jf-0-0",
                  title: "JESUS",
                  description: "The JESUS film.",
                  label: "Feature film",
                  metaLabel: "2:03",
                  href: "/jesus.html/spanish-castilian.html",
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

    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)

    expect(resolveWatchHomeMock).toHaveBeenNthCalledWith(
      1,
      "es",
      "spanish-latin-american",
    )
    expect(resolveWatchHomeMock).toHaveBeenNthCalledWith(2, "es")
    expect(html).toContain('data-testid="language-inventory-home-sections"')
    expect(html).toContain("/jesus.html/spanish-latin-american.html")
    expect(html).not.toContain("/jesus.html/spanish-castilian.html")
  })

  it("orders dubbed sections before subtitles-only content", async () => {
    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)

    expect(
      html.indexOf('data-testid="language-inventory-bible-gospels"'),
    ).toBeLessThan(
      html.indexOf('data-testid="language-inventory-bible-project"'),
    )
    expect(
      html.indexOf('data-testid="language-inventory-bible-project"'),
    ).toBeLessThan(html.indexOf('data-testid="language-inventory-sports"'))
    expect(
      html.indexOf('data-testid="language-inventory-sports"'),
    ).toBeLessThan(
      html.indexOf('data-testid="language-inventory-audio-collections"'),
    )
    expect(
      html.indexOf('data-testid="language-inventory-audio-collections"'),
    ).toBeLessThan(
      html.indexOf('data-testid="language-inventory-subtitle-only"'),
    )
  })

  it("renders the section metrics as an in-flow carousel of cards", async () => {
    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)
    const navStart = html.indexOf('aria-label="Language inventory sections"')
    const navHtml = html.slice(navStart, html.indexOf("</nav>", navStart))

    expect(navStart).toBeGreaterThanOrEqual(0)
    expect(navHtml).not.toContain("sticky")
    expect(navHtml).not.toContain("top-24")
    expect(navHtml).not.toContain("lg:top-28")
    expect(navHtml).not.toContain("z-30")
    expect(navHtml).toContain('data-slot="carousel"')
    expect(navHtml).toContain('data-slot="carousel-content"')
    expect(navHtml).toContain('data-slot="carousel-item"')
    expect(navHtml).toContain("aspect-[3/4]")
    expect(navHtml).toContain("w-[9.5rem]")
    expect(navHtml).toContain("h-7")
    expect(navHtml).toContain("font-medium")
    expect(navHtml).toContain("sm:text-[50px]")
    expect(navHtml).not.toContain("font-black")
    expect(navHtml).not.toContain("sm:text-5xl")
    expect(navHtml).not.toContain("bg-white/[0.12]")
    expect(navHtml).not.toContain("ring-white/15")
  })

  it("renders Video Bible collections as a curated current-language subset", async () => {
    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)
    const sectionStart = html.indexOf(
      'data-testid="language-inventory-bible-gospels"',
    )
    const nextSectionStart = html.indexOf(
      'data-testid="language-inventory-bible-project"',
    )
    const sectionHtml = html.slice(sectionStart, nextSectionStart)

    expect(sectionHtml).toContain("LUMO - The Gospel of Luke")
    expect(sectionHtml).toContain("JESUS")
    expect(sectionHtml).toContain("Magdalena")
    expect(sectionHtml).toContain("Book of Acts Bible Study")
    expect(sectionHtml).not.toContain("How to Read the Bible")
    expect(sectionHtml).not.toContain("The Story of Jesus")
    expect(sectionHtml).not.toContain("English Bible Course")
    expect(sectionHtml).toContain("4 items")
  })

  it("renders BibleProject collections as a current-language subset", async () => {
    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)
    const sectionStart = html.indexOf(
      'data-testid="language-inventory-bible-project"',
    )
    const nextSectionStart = html.indexOf(
      'data-testid="language-inventory-sports"',
    )
    const sectionHtml = html.slice(sectionStart, nextSectionStart)

    expect(sectionHtml).toContain("How to Read the Bible")
    expect(sectionHtml).not.toContain("LUMO - The Gospel of Luke")
    expect(sectionHtml).not.toContain("English Bible Course")
    expect(sectionHtml).toContain("1 item")
  })

  it("renders sports collections as a current-language subset", async () => {
    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)
    const sectionStart = html.indexOf('data-testid="language-inventory-sports"')
    const nextSectionStart = html.indexOf(
      'data-testid="language-inventory-audio-collections"',
    )
    const sectionHtml = html.slice(sectionStart, nextSectionStart)

    expect(sectionHtml).toContain("Deportes")
    expect(sectionHtml).not.toContain("How to Read the Bible")
    expect(sectionHtml).not.toContain("LUMO - The Gospel of Luke")
    expect(sectionHtml).not.toContain("English Bible Course")
    expect(sectionHtml).toContain("1 item")
  })

  it("renders dubbed videos as a compact list grouped by parent", async () => {
    const page = await VideosPage({
      params: Promise.resolve({
        locale: "spanish-latin-american",
        htmlLang: "es-419",
      }),
    })
    const html = renderToString(page)
    const sectionStart = html.indexOf(
      'data-testid="language-inventory-audio-collections"',
    )
    const nextSectionStart = html.indexOf(
      'data-testid="language-inventory-subtitle-only"',
    )
    const sectionHtml = html.slice(sectionStart, nextSectionStart)

    expect(sectionHtml).toContain("Spanish videos by collection")
    expect(sectionHtml).toContain("4 videos")
    expect(sectionHtml).toContain("3 groups")
    expect(sectionHtml).toContain("The Story of Jesus")
    expect(sectionHtml).toContain("2 videos")
    expect(sectionHtml).toContain("collection-story")
    expect(sectionHtml).toContain("Open collection")
    expect(sectionHtml).toContain("min-h-20")
    expect(sectionHtml).toContain("py-4")
    expect(sectionHtml).not.toContain("py-2.5")
    expect(sectionHtml).toContain(
      "/the-story-of-jesus.html/spanish-latin-american.html",
    )
    expect(sectionHtml).toContain("Jesus Calms the Storm")
    expect(sectionHtml).toContain("storm")
    expect(sectionHtml).toContain("Walking on Water")
    expect(sectionHtml.indexOf("Jesus Calms the Storm")).toBeLessThan(
      sectionHtml.indexOf("Walking on Water"),
    )
    expect(sectionHtml).toContain("LUMO - The Gospel of Luke")
    expect(sectionHtml).toContain("Birth of Jesus")
    expect(sectionHtml).toContain("Standalone videos")
    expect(sectionHtml).toContain("Hope Film")
    expect(sectionHtml).not.toContain(">Dubbed</span>")
    expect(sectionHtml).not.toContain("29 videos")
  })

  it("uses a playable route for subtitle-only cards", async () => {
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
      "Free Christian Video Library for Spanish-Speaking Audiences | Jesus Film Project",
    )
    expect(pageMetadata.description).toContain(
      "Watch free Christian videos, Jesus films, Bible stories, and discipleship series for Spanish-speaking audiences",
    )
    expect(pageMetadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/videos",
    )
    expect(pageMetadata.openGraph).toMatchObject({
      title:
        "Free Christian Video Library for Spanish-Speaking Audiences | Jesus Film Project",
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
