import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

const {
  resolveWatchHomeMock,
  resolveWatchPageMock,
  watchHomeExperiencePageMock,
  watchChromeShellMock,
  experienceEmptyMock,
  experienceErrorMock,
} = vi.hoisted(() => ({
  resolveWatchHomeMock: vi.fn(),
  resolveWatchPageMock: vi.fn(),
  watchHomeExperiencePageMock: vi.fn(() => null),
  watchChromeShellMock: vi.fn(({ children }) => children),
  experienceEmptyMock: vi.fn(() => null),
  experienceErrorMock: vi.fn(() => null),
}))

vi.mock("next-intl/server", () => ({
  setRequestLocale: vi.fn(),
}))

vi.mock("@/lib/watch-home", () => ({
  resolveWatchHome: resolveWatchHomeMock,
}))

vi.mock("@/lib/content", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/content")>("@/lib/content")
  return {
    ...actual,
    resolveWatchPage: resolveWatchPageMock,
  }
})

vi.mock("@/components/home/WatchHomeExperiencePage", () => ({
  WatchHomeExperiencePage: watchHomeExperiencePageMock,
}))

vi.mock("@/components/ExperienceEmpty", () => ({
  ExperienceEmpty: experienceEmptyMock,
}))

vi.mock("@/components/ExperienceError", () => ({
  ExperienceError: experienceErrorMock,
}))

vi.mock("@/components/WatchChromeShell", () => ({
  WatchChromeShell: watchChromeShellMock,
}))

import HomePage, { generateMetadata } from "@/app/[locale]/[htmlLang]/page"
import { WATCH_HOME_CLIENT_MESSAGE_NAMESPACES } from "@/i18n/client-messages"

const heroModel = {
  heroSlides: [{ id: "hero-1", imageUrl: "https://example.com/hero.jpg" }],
  sections: [],
  carousel: { pools: [] },
  missingData: [],
}

beforeEach(() => {
  resolveWatchHomeMock.mockReset()
  resolveWatchPageMock.mockReset()
  watchHomeExperiencePageMock.mockClear()
  experienceEmptyMock.mockClear()
  experienceErrorMock.mockClear()

  resolveWatchHomeMock.mockResolvedValue({ data: heroModel, error: null })
  resolveWatchPageMock.mockResolvedValue({
    data: null,
    error: new Error("No experience found"),
  })
})

describe("Watch root homepage", () => {
  it("uses the fixed seeker-focused page and social metadata", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    expect(metadata.title).toBe(
      "Watch Free Jesus Movies & Bible Videos | Jesus Film Project",
    )
    expect(metadata.description).toBe(
      "Watch free movies about Jesus, Gospel films, Bible videos, and Christian series. Explore faith, prayer, hope, and the story of Jesus in your language.",
    )
    expect(metadata.openGraph).toMatchObject({
      title: "Watch Free Films About Jesus | Jesus Film Project",
      description:
        "Explore free films, series, and Bible videos that bring the life of Jesus to every screen and many languages.",
    })
    expect(metadata.twitter).toMatchObject({
      title: "Watch Free Films About Jesus | Jesus Film Project",
      description:
        "Explore free films, series, and Bible videos that bring the life of Jesus to every screen and many languages.",
    })
  })

  it("renders builder-authored homepage blocks under the static hero model", async () => {
    const blocks = [
      { __typename: "WatchHomeHeroBlock", t: "watchHomeHero" },
      { __typename: "MediaCollectionBlock", t: "mediaCollection" },
    ]
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: { blocks },
      },
      error: null,
    })

    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    expect(resolveWatchHomeMock).toHaveBeenCalledWith("en")
    expect(resolveWatchPageMock).toHaveBeenCalledWith("en")
    expect(element.type).toBe(watchChromeShellMock)
    expect(element.props.initialRouteSurface).toBe("language-home")
    expect(Object.keys(element.props.children.props.messages)).toEqual([
      ...WATCH_HOME_CLIENT_MESSAGE_NAMESPACES,
    ])
    const home = element.props.children.props.children.props.children[1]
    expect(home.type).toBe(watchHomeExperiencePageMock)
    expect(home.props).toEqual({
      heroModel,
      blocks,
      locale: "en",
      languageSlug: "english",
      legacyCategoryRailCompatibility: false,
    })
  })

  it("keeps the static hero shell when the builder homepage is missing", async () => {
    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    const home = element.props.children.props.children.props.children[1]
    expect(home.type).toBe(watchHomeExperiencePageMock)
    expect(home.props).toEqual({
      heroModel,
      blocks: [],
      locale: "en",
      languageSlug: "english",
      legacyCategoryRailCompatibility: false,
    })
  })

  it("threads the old-schema category rail compatibility flag", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: { blocks: [] },
        watchHomeCategoryRailCompatibility: "legacy-schema",
      },
      error: null,
    })

    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })
    const home = element.props.children.props.children.props.children[1]

    expect(home.props.legacyCategoryRailCompatibility).toBe(true)
  })

  it("emits a canonical CollectionPage from the server-visible hero", async () => {
    resolveWatchHomeMock.mockResolvedValue({
      data: {
        heroSlides: [
          {
            id: "hero",
            coreId: "hero",
            title: "JESUS",
            href: "/watch/jesus.html/english.html",
          },
        ],
        sections: [],
        carousel: {
          pools: [
            {
              id: "featured",
              collectionIds: [],
              videos: [
                {
                  kind: "video",
                  id: "jesus",
                  title: "JESUS",
                  label: "Feature film",
                  href: "/watch/jesus.html/english.html",
                  posterUrl: null,
                  thumbnailUrl: null,
                  imageAlt: "",
                  src: "https://stream.mux.com/jesus.m3u8",
                  playbackId: "jesus",
                  durationSeconds: 120,
                },
              ],
            },
          ],
        },
        missingData: [],
      },
      error: null,
    })

    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })
    const html = renderToStaticMarkup(element)
    const script = html.match(
      /<script type="application\/ld\+json">([^<]+)<\/script>/,
    )
    const payload = JSON.parse(script?.[1] ?? "{}")

    expect(script).not.toBeNull()
    expect(payload).toMatchObject({
      "@type": "CollectionPage",
      url: "https://www.jesusfilm.org/watch",
      inLanguage: "en",
      mainEntity: {
        "@type": "ItemList",
        itemListElement: [
          {
            position: 1,
            name: "JESUS",
            url: "https://www.jesusfilm.org/watch/jesus.html",
          },
        ],
      },
    })
  })

  it("renders empty state when neither hero data nor builder blocks exist", async () => {
    resolveWatchHomeMock.mockResolvedValue({
      data: {
        heroSlides: [],
        sections: [],
        carousel: { pools: [] },
        missingData: [],
      },
      error: null,
    })

    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    expect(element.props.children.props.children.type).toBe(experienceEmptyMock)
  })

  it("ignores legacy static sections when deciding whether the builder homepage is empty", async () => {
    const heroModelWithStaticSections = {
      heroSlides: [],
      sections: [
        {
          id: "legacy-section",
          title: "Legacy Section",
          eyebrow: "Watch",
          videos: [],
        },
      ],
      carousel: { pools: [] },
      missingData: [],
    }
    resolveWatchHomeMock.mockResolvedValue({
      data: heroModelWithStaticSections,
      error: null,
    })

    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    expect(element.props.children.props.children.type).toBe(experienceEmptyMock)
  })
})
