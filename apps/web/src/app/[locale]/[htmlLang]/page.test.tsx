import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { isWatchAudienceEnabled } from "@/lib/feature-flags"

vi.mock("@/lib/feature-flags", () => ({
  isWatchAudienceEnabled: vi.fn(async () => false),
}))

const resolveWatchAudienceMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/watch-audience-content", async () => ({
  ...(await vi.importActual<typeof import("@/lib/watch-audience-content")>(
    "@/lib/watch-audience-content",
  )),
  resolveWatchAudience: resolveWatchAudienceMock,
}))

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
  vi.mocked(isWatchAudienceEnabled).mockResolvedValue(false)
  resolveWatchAudienceMock.mockReset()
  resolveWatchAudienceMock.mockResolvedValue({ kind: "absent" })
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
  it("passes the explicit audience rollout to the common homepage frame", async () => {
    vi.mocked(isWatchAudienceEnabled).mockResolvedValue(true)
    renderToStaticMarkup(
      await HomePage({
        params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
      }),
    )
    expect(watchHomeExperiencePageMock).toHaveBeenCalledWith(
      expect.objectContaining({ audienceEnabled: true }),
      undefined,
    )
  })

  it("hands the published audience configuration for the locale to the home frame", async () => {
    vi.mocked(isWatchAudienceEnabled).mockResolvedValue(true)
    const authored = {
      kind: "authored",
      sourceLocale: "en",
      config: { roles: [] },
      identity: "en:watch-audience:abc",
    }
    resolveWatchAudienceMock.mockResolvedValue(authored)
    renderToStaticMarkup(
      await HomePage({
        params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
      }),
    )
    expect(resolveWatchAudienceMock).toHaveBeenCalledWith("en")
    expect(watchHomeExperiencePageMock).toHaveBeenCalledWith(
      expect.objectContaining({ audienceEnabled: true, audience: authored }),
      undefined,
    )
  })

  it("does not load the configuration while the rollout is off", async () => {
    renderToStaticMarkup(
      await HomePage({
        params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
      }),
    )
    expect(resolveWatchAudienceMock).not.toHaveBeenCalled()
    expect(
      (watchHomeExperiencePageMock.mock.calls as unknown[][])[0]?.[0],
    ).toEqual(
      expect.objectContaining({ audienceEnabled: false, audience: undefined }),
    )
  })

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
      {
        __typename: "MediaCollectionBlock",
        t: "mediaCollection",
        items: [
          {
            videoId: "fixture-video",
            resolvedTitle: "Fixture film",
            videoSlug: "fixture-film",
          },
        ],
      },
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
      audienceEnabled: false,
      heroUnavailable: false,
      heroModel,
      blocks,
      locale: "en",
      languageSlug: "english",
      legacyCategoryRailCompatibility: false,
      publicDocumentPathname: "/watch",
    })
  })

  it("keeps builder-authored homepage blocks when the hero query fails", async () => {
    const blocks = [
      {
        __typename: "MediaCollectionBlock",
        t: "mediaCollection",
        items: [
          {
            videoId: "fixture-video",
            resolvedTitle: "Fixture film",
            videoSlug: "fixture-film",
          },
        ],
      },
    ]
    resolveWatchHomeMock.mockResolvedValue({
      data: null,
      error: new Error("Admin unavailable"),
    })
    resolveWatchPageMock.mockResolvedValue({
      data: { kind: "experience", experience: { blocks } },
      error: null,
    })

    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    expect(experienceErrorMock).not.toHaveBeenCalled()
    const home = element.props.children.props.children.props.children[1]
    expect(home.type).toBe(watchHomeExperiencePageMock)
    expect(home.props).toEqual(
      expect.objectContaining({
        heroUnavailable: true,
        heroModel: {
          heroSlides: [],
          sections: [],
          carousel: { pools: [] },
          missingData: [],
        },
        blocks,
      }),
    )
  })

  it("preserves audience and legacy props while the hero is unavailable", async () => {
    vi.mocked(isWatchAudienceEnabled).mockResolvedValue(true)
    const audience = {
      kind: "authored",
      sourceLocale: "en",
      config: { roles: [] },
      identity: "fixture",
    }
    resolveWatchAudienceMock.mockResolvedValue(audience)
    resolveWatchHomeMock.mockResolvedValue({
      data: null,
      error: new Error("Hero failed"),
    })
    resolveWatchPageMock.mockResolvedValue({
      data: {
        kind: "experience",
        experience: {
          blocks: [{ __typename: "TextBlock", heading: "Authored body" }],
        },
        watchHomeCategoryRailCompatibility: "legacy-schema",
      },
      error: null,
    })
    renderToStaticMarkup(
      await HomePage({
        params: Promise.resolve({ locale: "en", htmlLang: "en" }),
      }),
    )
    expect(watchHomeExperiencePageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audienceEnabled: true,
        audience,
        legacyCategoryRailCompatibility: true,
        publicDocumentPathname: "/watch",
      }),
      undefined,
    )
  })

  it("starts the hero and body together and waits for both resolved results", async () => {
    let finishHero!: (value: unknown) => void
    let finishBody!: (value: unknown) => void
    resolveWatchHomeMock.mockReturnValue(
      new Promise((resolve) => {
        finishHero = resolve
      }),
    )
    resolveWatchPageMock.mockReturnValue(
      new Promise((resolve) => {
        finishBody = resolve
      }),
    )
    const pending = HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "en" }),
    })
    await vi.waitFor(() => expect(resolveWatchPageMock).toHaveBeenCalled())
    expect(resolveWatchHomeMock).toHaveBeenCalled()
    finishBody({
      data: {
        kind: "experience",
        experience: {
          blocks: [{ __typename: "TextBlock", heading: "Body ready" }],
        },
      },
      error: null,
    })
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    finishHero({ data: null, error: new Error("Resolved hero error") })
    const element = await pending
    expect(element.props.children.props.children.props.children[1].type).toBe(
      watchHomeExperiencePageMock,
    )
  })

  it("shows the hero error when both the hero and builder body are unavailable", async () => {
    resolveWatchHomeMock.mockResolvedValue({
      data: null,
      error: new Error("Admin unavailable"),
    })

    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    expect(element.props.children.props.children.type).toBe(experienceErrorMock)
    expect(watchHomeExperiencePageMock).not.toHaveBeenCalled()
  })

  it("keeps the static hero shell when the builder homepage is missing", async () => {
    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    const home = element.props.children.props.children.props.children[1]
    expect(home.type).toBe(watchHomeExperiencePageMock)
    expect(home.props).toEqual({
      audienceEnabled: false,
      heroUnavailable: false,
      heroModel,
      blocks: [],
      locale: "en",
      languageSlug: "english",
      legacyCategoryRailCompatibility: false,
      publicDocumentPathname: "/watch",
    })
  })

  it("keeps the healthy hero when the body query fails operationally", async () => {
    resolveWatchPageMock.mockResolvedValue({
      data: null,
      error: new Error("Body unavailable"),
    })
    renderToStaticMarkup(
      await HomePage({
        params: Promise.resolve({ locale: "en", htmlLang: "en" }),
      }),
    )
    expect(watchHomeExperiencePageMock).toHaveBeenCalledWith(
      expect.objectContaining({ heroModel, blocks: [] }),
      undefined,
    )
    expect(experienceErrorMock).not.toHaveBeenCalled()
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
