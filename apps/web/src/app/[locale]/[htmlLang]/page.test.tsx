import { describe, expect, it, vi, beforeEach } from "vitest"

const {
  resolveWatchHomeMock,
  resolveWatchPageMock,
  watchHomeExperiencePageMock,
  experienceEmptyMock,
  experienceErrorMock,
} = vi.hoisted(() => ({
  resolveWatchHomeMock: vi.fn(),
  resolveWatchPageMock: vi.fn(),
  watchHomeExperiencePageMock: vi.fn(() => null),
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

import HomePage from "@/app/[locale]/[htmlLang]/page"
import { WATCH_HOME_CLIENT_MESSAGE_NAMESPACES } from "@/i18n/client-messages"

const heroModel = {
  heroSlides: [{ id: "hero-1", imageUrl: "https://example.com/hero.jpg" }],
  sections: [],
  carousel: { pools: [], muxInserts: [] },
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
    expect(Object.keys(element.props.messages)).toEqual([
      ...WATCH_HOME_CLIENT_MESSAGE_NAMESPACES,
    ])
    expect(element.props.children.type).toBe(watchHomeExperiencePageMock)
    expect(element.props.children.props).toEqual({
      heroModel,
      blocks,
      languageSlug: "english",
    })
  })

  it("keeps the static hero shell when the builder homepage is missing", async () => {
    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    expect(element.props.children.type).toBe(watchHomeExperiencePageMock)
    expect(element.props.children.props).toEqual({
      heroModel,
      blocks: [],
      languageSlug: "english",
    })
  })

  it("renders empty state when neither hero data nor builder blocks exist", async () => {
    resolveWatchHomeMock.mockResolvedValue({
      data: {
        heroSlides: [],
        sections: [],
        carousel: { pools: [], muxInserts: [] },
        missingData: [],
      },
      error: null,
    })

    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    expect(element.props.children.type).toBe(experienceEmptyMock)
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
      carousel: { pools: [], muxInserts: [] },
      missingData: [],
    }
    resolveWatchHomeMock.mockResolvedValue({
      data: heroModelWithStaticSections,
      error: null,
    })

    const element = await HomePage({
      params: Promise.resolve({ locale: "en", htmlLang: "english.html" }),
    })

    expect(element.props.children.type).toBe(experienceEmptyMock)
  })
})
