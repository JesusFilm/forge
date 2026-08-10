import { afterEach, describe, expect, it, vi } from "vitest"

const { queryMock, unstableCacheCalls } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  unstableCacheCalls: [] as unknown[][],
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(
    fn: T,
    keyParts: unknown[],
  ) => {
    unstableCacheCalls.push(keyParts)
    return fn
  },
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  }
})

vi.mock("@/lib/admin-client", () => ({
  default: { query: queryMock },
}))

afterEach(() => {
  queryMock.mockReset()
  unstableCacheCalls.length = 0
  vi.resetModules()
})

describe("Web video display-title producers", () => {
  it("uses English for a blank history title without replacing requested image alt", async () => {
    queryMock.mockResolvedValue({
      data: {
        watchVideosByIds: [
          {
            documentId: "video-1",
            slug: "miraculous-catch-of-fish",
            label: "SEGMENT",
            durationSeconds: 60,
            images: [],
            locales: [{ title: "   ", imageAlt: "صورة عربية" }],
            englishTitleLocales: [],
            englishLanguageTitleLocales: [
              { title: "Miraculous Catch of Fish" },
            ],
            dubs: [],
            parents: [],
          },
        ],
      },
    })

    const { fetchWatchHistoryVideoDetails } = await import("../watch-history")
    const result = await fetchWatchHistoryVideoDetails([
      { videoId: "video-1", languageSlug: "modern-standard-arabic" },
    ])

    expect(result[0]).toMatchObject({
      title: "Miraculous Catch of Fish",
      imageAlt: "صورة عربية",
    })
  })

  it("batches one history request per language instead of per video", async () => {
    queryMock.mockResolvedValue({
      data: {
        watchVideosByIds: [
          {
            documentId: "video-1",
            slug: "first-video",
            label: "SEGMENT",
            images: [],
            locales: [{ title: "First", imageAlt: null }],
            englishTitleLocales: [],
            englishLanguageTitleLocales: [],
            dubs: [],
            parents: [],
          },
          {
            documentId: "video-2",
            slug: "second-video",
            label: "SEGMENT",
            images: [],
            locales: [{ title: "Second", imageAlt: null }],
            englishTitleLocales: [],
            englishLanguageTitleLocales: [],
            dubs: [],
            parents: [],
          },
        ],
      },
    })

    const { fetchWatchHistoryVideoDetails } = await import("../watch-history")
    const result = await fetchWatchHistoryVideoDetails([
      { videoId: "video-1", languageSlug: "french" },
      { videoId: "video-2", languageSlug: "french" },
    ])

    expect(result.map((item) => item.title)).toEqual(["First", "Second"])
    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0]?.[0]?.variables).toEqual({
      ids: ["video-1", "video-2"],
      languageSlug: "french",
    })
  })

  it("uses the legacy history query only when Admin lacks the batch field", async () => {
    queryMock
      .mockRejectedValueOnce(
        new Error('Cannot query field "watchVideosByIds" on type "Query".'),
      )
      .mockResolvedValueOnce({
        data: {
          video: {
            documentId: "video-1",
            slug: "first-video",
            label: "SEGMENT",
            images: [],
            locales: [{ title: "First", imageAlt: null }],
            englishTitleLocales: [],
            englishLanguageTitleLocales: [],
            dubs: [],
            parents: [],
          },
        },
      })

    const { fetchWatchHistoryVideoDetails } = await import("../watch-history")
    const result = await fetchWatchHistoryVideoDetails([
      { videoId: "video-1", languageSlug: "english" },
    ])

    expect(result[0]?.title).toBe("First")
    expect(queryMock).toHaveBeenCalledTimes(2)
  })

  it("uses English in demo search while preserving requested description", async () => {
    queryMock.mockResolvedValue({
      data: {
        videoBySlug: {
          documentId: "video-1",
          slug: "miraculous-catch-of-fish",
          images: [],
          primaryLanguage: null,
          locales: [{ title: " ", description: "وصف عربي" }],
          englishTitleLocales: [],
          englishLanguageTitleLocales: [{ title: "Miraculous Catch of Fish" }],
          variants: [],
        },
      },
    })

    const { getDemoPlayableVideo } = await import("../demo-search")
    const result = await getDemoPlayableVideo("miraculous-catch-of-fish", "ar")

    expect(result).toMatchObject({
      title: "Miraculous Catch of Fish",
      description: "وصف عربي",
    })
    expect(unstableCacheCalls).toContainEqual(["demo-search-video-v2"])
  })

  it("uses English in recommendations while preserving requested description", async () => {
    queryMock.mockResolvedValue({
      data: {
        videoBySlug: {
          documentId: "video-1",
          slug: "miraculous-catch-of-fish",
          images: [],
          primaryLanguage: null,
          locales: [{ title: "\t", description: "وصف عربي" }],
          englishTitleLocales: [],
          englishLanguageTitleLocales: [{ title: "Miraculous Catch of Fish" }],
        },
      },
    })

    const { getVideoBySlug } = await import("../recommendations")
    const result = await getVideoBySlug("miraculous-catch-of-fish", "ar")

    expect(result).toMatchObject({
      title: "Miraculous Catch of Fish",
      description: "وصف عربي",
    })
    expect(unstableCacheCalls).toContainEqual(["video-by-slug-v2"])
  })
})
