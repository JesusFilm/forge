import { afterEach, describe, expect, it, vi } from "vitest"

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}))

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react")

  return {
    ...actual,
    cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  }
})

vi.mock("@/lib/admin-client", () => ({
  default: {
    query: queryMock,
  },
}))

type AdminVideoFixture = Parameters<
  typeof import("./watch-home-carousel").normalizeWatchHomeVideoSlide
>[0]

function makeAdminVideo(
  overrides: Partial<AdminVideoFixture> = {},
): AdminVideoFixture {
  return {
    documentId: "video-1",
    coreId: "core-1",
    slug: "medley",
    label: "SHORT_FILM",
    durationSeconds: 120,
    images: [
      {
        documentId: "image-1",
        url: "https://cdn.example/raw.jpg",
        thumbnail: "https://cdn.example/thumb.jpg",
        mobileCinematicHigh: "https://cdn.example/high.jpg",
        mobileCinematicLow: "https://cdn.example/low.jpg",
        videoStill: null,
      },
    ],
    locales: [
      {
        documentId: "locale-1",
        languageSlug: "english",
        title: "Medley",
        snippet: "A short fruit story.",
        imageAlt: "Fruit characters",
      },
    ],
    fallbackLocales: [],
    defaultLocales: [],
    variants: [
      {
        documentId: "dub-1",
        slug: "english",
        published: true,
        hls: "https://stream.example/medley.m3u8",
        duration: 121,
        language: {
          slug: "english",
          bcp47: "en",
          name: "English",
        },
        muxVideo: {
          playbackId: "mux-medley",
        },
      },
    ],
    ...overrides,
  }
}

describe("watch-home-carousel", () => {
  afterEach(() => {
    queryMock.mockReset()
    vi.resetModules()
  })

  it("normalizes an admin video into a routable carousel slide", async () => {
    const { normalizeWatchHomeVideoSlide } =
      await import("./watch-home-carousel")

    const result = normalizeWatchHomeVideoSlide(makeAdminVideo(), "english")

    expect(result.skipped).toBeNull()
    expect(result.slide).toMatchObject({
      kind: "video",
      title: "Medley",
      label: "SHORT FILM",
      href: "/medley.html/english.html",
      src: "https://stream.example/medley.m3u8",
      muxPlaybackId: "mux-medley",
      posterUrl: "https://cdn.example/high.jpg",
      thumbnailUrl: "https://cdn.example/thumb.jpg",
      durationSeconds: 121,
    })
  })

  it("skips admin videos without a playable variant", async () => {
    const { normalizeWatchHomeVideoSlide } =
      await import("./watch-home-carousel")

    const result = normalizeWatchHomeVideoSlide(
      makeAdminVideo({ variants: [] }),
      "english",
    )

    expect(result.slide).toBeNull()
    expect(result.skipped).toEqual({
      id: "video-1",
      slug: "medley",
      reason: "missing_playable_variant",
    })
  })

  it("falls back to the UI locale title when active-language metadata is missing", async () => {
    const { normalizeWatchHomeVideoSlide } =
      await import("./watch-home-carousel")

    const result = normalizeWatchHomeVideoSlide(
      makeAdminVideo({
        locales: [],
        fallbackLocales: [
          {
            documentId: "fallback-locale-1",
            languageSlug: "english",
            title: "Ultimate Coach",
            snippet: "Fallback description",
            imageAlt: "Coach",
          },
        ],
      }),
      "spanish-latin-american",
    )

    expect(result.skipped).toBeNull()
    expect(result.slide).toMatchObject({
      title: "Ultimate Coach",
      description: "Fallback description",
    })
  })

  it("merges the start insert and after-count inserts into the video sequence", async () => {
    const { mergeMuxInsertSlides, normalizeWatchHomeVideoSlide } =
      await import("./watch-home-carousel")
    const first = normalizeWatchHomeVideoSlide(
      makeAdminVideo(),
      "english",
    ).slide
    const second = normalizeWatchHomeVideoSlide(
      makeAdminVideo({
        documentId: "video-2",
        slug: "chosen-witness",
        locales: [
          {
            documentId: "locale-2",
            languageSlug: "english",
            title: "Chosen Witness",
            snippet: null,
            imageAlt: null,
          },
        ],
      }),
      "english",
    ).slide

    const slides = mergeMuxInsertSlides(
      [first!, second!],
      new Date("2026-06-04T12:00:00.000Z"),
    )

    expect(slides.map((slide) => slide.id)).toEqual([
      "mux-welcome-start",
      "video-video-1",
      "mux-join-us",
      "video-video-2",
    ])
    expect(slides[0]).toMatchObject({
      title: "Jun 4: Today's Video Picks",
      muxPlaybackId: "34eG2PxlcRu3L4wU5XlKVna2vN3BAI02Tjrq28dazn3Y",
    })
  })

  it("fetches configured admin pools with language-specific playable dubs", async () => {
    const videos = Array.from({ length: 6 }, (_, index) =>
      makeAdminVideo({
        documentId: `video-${index + 1}`,
        slug: `video-${index + 1}`,
        locales: [
          {
            documentId: `locale-${index + 1}`,
            languageSlug: "english",
            title: `Video ${index + 1}`,
            snippet: null,
            imageAlt: null,
          },
        ],
      }),
    )

    queryMock.mockImplementation(({ variables }) => {
      if (variables.collection === "1_jf-0-0") {
        return Promise.resolve({ data: { videos } })
      }
      return Promise.resolve({ data: { videos: [] } })
    })

    const { resolveWatchHomeCarousel } = await import("./watch-home-carousel")

    const result = await resolveWatchHomeCarousel("en", "english")

    expect(queryMock).toHaveBeenCalled()
    expect(queryMock.mock.calls[0][0].variables).toMatchObject({
      collection: "1_jf-0-0",
      languageSlug: "english",
      limit: 4,
      sort: "RECENT",
    })
    expect(
      queryMock.mock.calls.some(
        ([call]) => call.variables.category === "SHORT_FILMS",
      ),
    ).toBe(true)
    expect(result.slides[0]?.id).toBe("mux-welcome-start")
    expect(result.missingData.fallbackPoolUsed).toBe(false)
  })
})
