/**
 * @vitest-environment jsdom
 */
import { renderToString } from "react-dom/server"
import { useTranslations } from "next-intl"
import { setRequestLocale } from "next-intl/server"
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

function RussianPluralProbe() {
  const t = useTranslations("LanguageInventory")
  return (
    <>
      <span>{t("itemCount", { count: 5 })}</span>
      <span>{t("heroTitle", { language: "русский" })}</span>
    </>
  )
}

describe("/{language}.html/videos route", () => {
  beforeEach(() => {
    resolveWatchLanguageInventoryMock.mockReset()
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
        total: 5,
        audioCollections: 1,
        audioVideos: 3,
        subtitleOnlyVideos: 0,
      },
      promoted: [
        {
          id: "promoted-1",
          coreId: "core-promoted-1",
          slug: "promoted-video",
          title: "Promoted video",
          description: null,
          imageUrl: "https://imagedelivery.net/test/promoted-hero/public",
          imageAlt: "Promoted video still",
          label: "short film",
          availability: "AUDIO",
          href: "/promoted-video.html/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: null,
          parentTitle: null,
          durationSeconds: 300,
          childCount: 0,
          publishedAt: "2026-06-02T00:00:00.000Z",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-06-02T00:00:00.000Z",
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
      ],
      audioVideos: [
        {
          id: "video-1",
          coreId: "core-video-1",
          slug: "episode-one",
          title: "Episode 1",
          description: "The first episode.",
          imageUrl: "https://imagedelivery.net/test/episode-one/public",
          imageAlt: "Episode one still",
          label: "episode",
          availability: "AUDIO",
          href: "/the-story-of-jesus.html/episode-one/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: "the-story-of-jesus",
          parentTitle: "The Story of Jesus",
          parentOrder: 1,
          durationSeconds: 600,
          childCount: 0,
          publishedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "video-2",
          coreId: "core-video-2",
          slug: "episode-two",
          title: "Episode 2",
          description: "The second episode.",
          imageUrl: "https://imagedelivery.net/test/episode-two/public",
          imageAlt: "Episode two still",
          label: "episode",
          availability: "AUDIO",
          href: "/the-story-of-jesus.html/episode-two/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: "the-story-of-jesus",
          parentTitle: "The Story of Jesus",
          parentOrder: 2,
          durationSeconds: 720,
          childCount: 0,
          publishedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "video-3",
          coreId: "core-video-3",
          slug: "episode-three",
          title: "Episode 3",
          description: "The third episode.",
          imageUrl: "https://imagedelivery.net/test/episode-three/public",
          imageAlt: "Episode three still",
          label: "episode",
          availability: "AUDIO",
          href: "/the-story-of-jesus.html/episode-three/spanish-latin-american.html" as never,
          watchLanguageSlug: "spanish-latin-american",
          parentSlug: "the-story-of-jesus",
          parentTitle: "The Story of Jesus",
          parentOrder: 3,
          durationSeconds: 840,
          childCount: 0,
          publishedAt: "2026-06-01T00:00:00.000Z",
          createdAt: "2026-05-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
        },
      ],
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
      "Free Christian videos in Espanol latinoamericano | Jesus Film Project",
    )
    expect(pageMetadata.description).toContain(
      "with dubbed audio or subtitles in Espanol latinoamericano",
    )
    expect(pageMetadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/spanish-latin-american.html/videos",
    )
  })

  it("declares Russian SEO metadata through the requested catalog", async () => {
    const pageMetadata = await generateMetadata({
      params: Promise.resolve({
        locale: "ru",
        htmlLang: "ru",
        languageSlug: "russian",
      }),
    })

    expect(pageMetadata.title).toBe(
      "Бесплатные христианские видео. Язык: Espanol latinoamericano | Jesus Film Project",
    )
    expect(pageMetadata.description).toContain(
      "Язык озвучки или субтитров: Espanol latinoamericano",
    )
    expect(pageMetadata.alternates?.canonical).toBe(
      "https://www.jesusfilm.org/watch/russian.html/videos",
    )
  })

  it("uses Russian ICU plural categories in route-render tests", () => {
    setRequestLocale("ru")
    const html = renderToString(<RussianPluralProbe />)
    expect(html).toContain("5 материалов")
    expect(html).toContain("Язык: русский")
    expect(html).not.toContain("на языке русский")
  })

  it("starts the content catalog at the fully dubbed grouped inventory", async () => {
    const page = await LanguageVideosPage({
      params: Promise.resolve({
        locale: "es",
        htmlLang: "es-419",
        languageSlug: "spanish-latin-american",
      }),
    })
    const html = renderToString(page)
    document.body.innerHTML = html

    const navigation = document.querySelector(
      '[data-testid="language-inventory-section-carousel"]',
    )
    const dubbedCatalog = document.querySelector(
      '[data-testid="language-inventory-audio-collections"]',
    )
    const subtitleCatalog = document.querySelector(
      '[data-testid="language-inventory-subtitle-only"]',
    )

    expect(html).toContain("Spanish, Latin American")
    expect(html).toContain("promoted-hero")
    expect(html).toContain('data-testid="language-inventory-audio-collections"')
    expect(html).not.toContain('data-testid="language-inventory-home-sections"')
    expect(html).not.toContain('data-testid="language-inventory-promoted"')
    expect(html).not.toContain('data-testid="language-inventory-bible-gospels"')
    expect(html).not.toContain('data-testid="language-inventory-bible-project"')
    expect(html).not.toContain('data-testid="language-inventory-sports"')
    expect(html).not.toContain('href="#new"')
    expect(html).not.toContain('href="#bible-gospels"')
    expect(html).not.toContain('href="#bible-project"')
    expect(html).not.toContain('href="#sports"')
    expect(html).toContain('href="#audio-collections"')
    expect(html).toContain('href="#subtitles-only"')
    expect(navigation?.nextElementSibling).toBe(dubbedCatalog)
    expect(dubbedCatalog?.nextElementSibling).toBe(subtitleCatalog)
    expect(resolveWatchLanguageInventoryMock).toHaveBeenCalledWith(
      "es",
      "spanish-latin-american",
    )
  })

  it("keeps each collection overview sticky within its desktop group", async () => {
    const page = await LanguageVideosPage({
      params: Promise.resolve({
        locale: "es",
        htmlLang: "es-419",
        languageSlug: "spanish-latin-american",
      }),
    })
    document.body.innerHTML = renderToString(page)

    const group = document.querySelector(
      '[data-testid="language-inventory-collection-group"]',
    )
    const sidebar = document.querySelector(
      '[data-testid="language-inventory-collection-sidebar"]',
    )
    const overview = document.querySelector(
      '[data-testid="language-inventory-collection-overview"]',
    )

    expect(group?.classList).toContain("overflow-clip")
    expect(group?.classList).not.toContain("overflow-hidden")
    expect(sidebar?.classList).toContain("bg-white/[0.035]")
    expect(sidebar?.classList).toContain("lg:border-r")
    expect(sidebar?.classList).not.toContain("lg:sticky")
    expect(sidebar?.classList).not.toContain("lg:self-start")
    expect(overview?.classList).toContain("lg:sticky")
    expect(overview?.classList).toContain(
      "lg:top-[calc(env(safe-area-inset-top,0px)+7rem)]",
    )
    expect(overview?.classList).not.toContain("sticky")
    expect(group?.textContent).toContain("A collection for outreach teams.")
    expect(group?.textContent).toContain("Episode 3")
  })

  it("renders contextual Russian UI copy without English inventory chrome", async () => {
    const page = await LanguageVideosPage({
      params: Promise.resolve({
        locale: "ru",
        htmlLang: "ru",
        languageSlug: "russian",
      }),
    })
    const html = renderToString(page)

    expect(html).toContain("Бесплатные христианские видео")
    expect(html).toContain("Доступны субтитры")
    expect(html).not.toContain("Free Christian videos")
    expect(resolveWatchLanguageInventoryMock).toHaveBeenCalledWith(
      "ru",
      "russian",
    )
  })
})
