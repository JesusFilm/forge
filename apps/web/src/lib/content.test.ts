import { afterEach, describe, expect, it, vi } from "vitest"

const { queryMock, unstableCacheCalls } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  unstableCacheCalls: [] as {
    keyParts: unknown[]
    options: { revalidate?: unknown; tags?: unknown }
  }[],
}))

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(
    fn: T,
    keyParts: unknown[],
    options?: { revalidate?: unknown; tags?: unknown },
  ) => {
    unstableCacheCalls.push({ keyParts, options: options ?? {} })
    return fn
  },
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

// Builders for admin-shape `Video` projections — the resolver normalises
// these into the flat `WatchVideoRecord` shape before consumers see them,
// so the mocks recreate admin's `videoBySlug` projection (locales[],
// dubs, parents/children with relation joins) verbatim.
function makeAdminVideo(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    documentId: "video-1",
    slug: "jesus",
    noIndex: false,
    label: null,
    images: [{ documentId: "img-1", url: "https://cdn.example/jesus.jpg" }],
    primaryLanguage: { coreId: "529", bcp47: "en" },
    locales: [
      {
        documentId: "loc-1",
        publishedAt: null,
        title: "Jesus",
        description: "A full description",
        snippet: "The story of Jesus",
        imageAlt: "Jesus still",
      },
    ],
    parents: [],
    children: [],
    variants: [
      {
        documentId: "variant-1",
        slug: "english",
        hls: "https://cdn.example/jesus.m3u8",
        published: true,
        duration: 7674,
        language: {
          coreId: "529",
          bcp47: "en",
          slug: "english",
          name: "English",
        },
        downloads: [],
        muxVideo: { playbackId: "pb-1" },
      },
    ],
    studyQuestions: [],
    bibleCitations: [],
    ...overrides,
  }
}

function makeAdminDub(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const video = makeAdminVideo()
  const variant = (video.variants as Record<string, unknown>[])[0]!
  return {
    ...variant,
    downloads: [],
    muxVideo: { playbackId: "pb-1" },
    videoEdition: { subtitles: [] },
    ...overrides,
  }
}

function makeRussianVariant(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    documentId: "variant-ru",
    slug: "russian",
    hls: "https://cdn.example/jesus-ru.m3u8",
    published: true,
    duration: 7674,
    language: {
      coreId: "3934",
      bcp47: "ru",
      slug: "russian",
      name: "Russian",
    },
    ...overrides,
  }
}

function makeRussianDub(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return makeAdminDub({
    ...makeRussianVariant(),
    downloads: [],
    muxVideo: { playbackId: "pb-ru" },
    videoEdition: { subtitles: [] },
    ...overrides,
  })
}

describe("resolveWatchPage", () => {
  afterEach(() => {
    queryMock.mockReset()
    unstableCacheCalls.length = 0
    vi.resetModules()
  })

  it("declares tags on every watch resolver cache", async () => {
    await import("./content")

    expect(unstableCacheCalls).toEqual(
      expect.arrayContaining([
        {
          keyParts: ["watch-page", "v4-serializable-errors"],
          options: {
            revalidate: 60,
            tags: [
              "watch:home",
              "watch:settings",
              "watch:experience",
              "watch:video",
            ],
          },
        },
        {
          keyParts: ["watch-experience-page"],
          options: { revalidate: 60, tags: ["watch:experience"] },
        },
        {
          keyParts: ["watch-video"],
          options: { revalidate: 60, tags: ["watch:video"] },
        },
        {
          keyParts: ["video-child-dub-languages"],
          options: {
            revalidate: 3600,
            tags: ["watch:child-dub-languages"],
          },
        },
        {
          keyParts: ["watch-video-route-snapshot"],
          options: { revalidate: 60, tags: ["watch:video"] },
        },
        {
          keyParts: ["watch-route-by-slug"],
          options: {
            revalidate: 60,
            tags: ["watch:series", "watch:video"],
          },
        },
      ]),
    )
  })

  it("returns the homepage Experience from watchSetting", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        watchSetting: {
          documentId: "watch-settings-1",
          homepageExperience: {
            __typename: "ExperienceLocale",
            id: "exp-home-1",
            slug: "home",
            title: "Home",
          },
          defaultTemplateExperience: null,
        },
      },
    })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: {
        slug: "home",
      },
    })
  })

  it("returns a missing-experience error when watchSetting has no homepageExperience", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        watchSetting: {
          documentId: "watch-settings-1",
          homepageExperience: null,
          defaultTemplateExperience: null,
        },
      },
    })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("No experience found")
    expect(JSON.parse(JSON.stringify(result))).toEqual({
      data: null,
      error: {
        name: "Error",
        message: "No experience found",
      },
    })
  })

  it("falls back to an explicit experience when no route video exists", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: {
              __typename: "ExperienceLocale",
              id: "exp-template-1",
              slug: "single-video",
              title: "Single Video Template",
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: null,
        },
      })
      .mockResolvedValueOnce({
        data: {
          experienceBySlug: {
            __typename: "ExperienceLocale",
            id: "exp-1",
            slug: "christmas",
            title: "Christmas",
          },
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "christmas")

    expect(queryMock).toHaveBeenCalledTimes(3)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: {
        slug: "christmas",
      },
    })
  })

  it("uses the default template for video slugs before same-slug experience lookup", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: {
              __typename: "ExperienceLocale",
              id: "exp-template-1",
              slug: "single-video",
              title: "Single Video Template",
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            locales: [],
            exactLocales: [
              {
                documentId: "loc-1",
                publishedAt: "2026-06-02T12:00:00.000Z",
                title: "Jesus",
                description: "A full description",
                snippet: "The story of Jesus",
                imageAlt: "Jesus still",
              },
            ],
            children: [
              {
                child: {
                  documentId: "child-1",
                  slug: "the-beginning",
                  label: "SEGMENT",
                  muxPlaybackId: "mux-child-1",
                  images: [
                    {
                      documentId: "img-c",
                      url: "https://cdn.example/child.jpg",
                    },
                  ],
                  dubs: [],
                  exactLocales: [
                    { documentId: "cl-1", title: "The Beginning" },
                  ],
                },
              },
              {
                // Self-child filter: skip the entry pointing back at the
                // current video.
                child: {
                  documentId: "video-1",
                  slug: "jesus",
                  label: null,
                  images: [],
                  exactLocales: [{ documentId: "cl-2", title: "Jesus" }],
                },
              },
            ],
          }),
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "video-template",
      template: { slug: "single-video" },
      routeVideo: {
        slug: "jesus",
        title: "Jesus",
        streamingUrl: "https://cdn.example/jesus.m3u8",
        relatedItems: [
          {
            title: "The Beginning",
            label: "SEGMENT",
            videoSlug: "the-beginning",
            muxPlaybackId: "mux-child-1",
          },
        ],
      },
    })
  })

  it("returns null/error when the video lookup succeeds but watchSetting has no defaultTemplateExperience", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: null,
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo(),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo(),
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("No experience found")
  })

  it("returns null/error when the video exists but has no playable variant", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: {
              __typename: "ExperienceLocale",
              id: "exp-template-1",
              slug: "single-video",
              title: "Single Video Template",
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          // Empty variants — selectPlayableVariant returns null, so
          // normalizeRouteVideo returns null and the route bails.
          videoBySlug: makeAdminVideo({ variants: [] }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo(),
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("No experience found")
  })

  it("treats the template Experience's slug as the video-template route (skips Experience lookup)", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: {
              __typename: "ExperienceLocale",
              id: "exp-template-1",
              slug: "single-video",
              title: "Single Video Template",
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({ slug: "single-video" }),
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "single-video")

    // Only watchSetting + video — no Experience lookup, because the slug
    // matches the template's slug.
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "video-template",
      template: { slug: "single-video" },
      routeVideo: { slug: "single-video" },
    })
  })
})

// Locale-text fallback (content.ts:1059-1074). When admin's
// `videoBySlug(...)` returns a record with `locales: []` for a non-`en`
// request — common when the URL uses a language slug ("afrikaans") or
// when no VideoLocale row exists in the requested language — the
// resolver re-fetches with `locale: "en"` and merges the English title
// onto the original record. Without this fallback, watch pages on
// non-en locales render with an empty `<h1>`.
describe("resolveWatchVideoBySlug — locale fallback", () => {
  afterEach(() => {
    queryMock.mockReset()
    vi.resetModules()
  })

  it("uses the English alias when exact and broad copy are empty for a non-en request", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            locales: [],
            exactLocales: [],
            broadLocales: [],
            englishLocales: [
              {
                documentId: "loc-en",
                title: "Jesus (English fallback)",
                description: "English description",
                snippet: "English snippet",
                imageAlt: "Jesus still",
              },
            ],
            studyQuestions: [],
            exactStudyQuestions: [],
            broadStudyQuestions: [],
            englishStudyQuestions: [],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeAdminDub(),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "fr")

    expect(queryMock).toHaveBeenCalledTimes(2)
    const snapshotCall = queryMock.mock.calls[0][0] as {
      variables: {
        locale: string
        languageSlug: string | null
        videoSlug: string
      }
    }
    expect(snapshotCall.variables).toEqual({
      locale: "fr",
      languageSlug: null,
      videoSlug: "jesus",
    })
    expect(result?.video.title).toBe("Jesus (English fallback)")
    expect(result?.video.localePublishedAt).toBeNull()
  })

  it("does not re-fetch when the primary fetch already returns a locale row", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo(),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            studyQuestions: [
              { documentId: "sq-fr", value: "Question?", order: 1 },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeAdminDub(),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "fr")

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(result?.video.title).toBe("Jesus")
  })

  it("queries admin content with BCP-47 when the watch URL uses an audio slug", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            variants: [makeRussianVariant()],
            locales: [
              {
                documentId: "loc-ru",
                publishedAt: "2026-06-02T12:00:00.000Z",
                title: "Jesus RU",
                description: "Russian description",
                snippet: "Russian snippet",
                imageAlt: "Russian still",
              },
            ],
            studyQuestions: [
              { documentId: "sq-ru", value: "Russian question?", order: 1 },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeRussianDub({
            language: {
              coreId: "3934",
              bcp47: "ru",
              iso3: "rus",
              slug: "russian",
              name: "Russian",
            },
            downloads: [
              {
                documentId: "download-ru-low",
                height: 360,
                quality: "low",
                size: "1048576",
              },
            ],
          }),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "russian")

    expect(queryMock).toHaveBeenCalledTimes(2)
    const primaryCall = queryMock.mock.calls[0][0] as {
      variables: {
        locale: string
        languageSlug: string | null
        videoSlug: string
      }
    }
    expect(primaryCall.variables).toEqual({
      locale: "ru",
      languageSlug: "russian",
      videoSlug: "jesus",
    })
    expect(result?.video.title).toBe("Jesus RU")
    expect(result?.video.localePublishedAt).toBe("2026-06-02T12:00:00.000Z")
    expect(result?.selectedVariant.language?.slug).toBe("russian")
    expect(result?.selectedVariant.language?.iso3).toBe("rus")
    expect(result?.selectedVariant.downloads).toEqual([
      {
        documentId: "download-ru-low",
        height: 360,
        quality: "low",
        size: "1048576",
      },
    ])
  })

  it("keeps rendering the playable route when selected dub detail hydration is rate-limited", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            slug: "life-of-jesus-gospel-of-john",
            variants: [makeRussianVariant()],
            locales: [
              {
                documentId: "loc-ru",
                title: "Life of Jesus RU",
                description: "Russian description",
                snippet: "Russian snippet",
                imageAlt: "Russian still",
              },
            ],
          }),
        },
      })
      .mockRejectedValueOnce(
        new Error("You are trying to access 'videoDub' too often"),
      )

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug(
      "life-of-jesus-gospel-of-john",
      "russian",
    )

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(result?.video.slug).toBe("life-of-jesus-gospel-of-john")
    expect(result?.selectedVariant.language?.slug).toBe("russian")
    expect(result?.selectedVariant.hls).toBe(
      "https://cdn.example/jesus-ru.m3u8",
    )
    expect(result?.selectedVariant.muxVideo).toBeNull()
    expect(result?.selectedVariant.downloads).toEqual([])
  })

  it("uses broad BCP-47 content before English when exact languageSlug content is missing", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            variants: [makeRussianVariant()],
            locales: [],
            exactLocales: [],
            broadLocales: [
              {
                documentId: "loc-ru-broad",
                languageSlug: "russian-broad",
                title: "Jesus RU broad",
                description: "Russian broad description",
                snippet: "Russian broad snippet",
                imageAlt: "Russian broad still",
              },
            ],
            studyQuestions: [],
            exactStudyQuestions: [],
            broadStudyQuestions: [
              { documentId: "sq-ru-broad", value: "Broad question?", order: 1 },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeRussianDub(),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "russian")

    expect(queryMock.mock.calls.map((call) => call[0].variables)).toEqual([
      { locale: "ru", languageSlug: "russian", videoSlug: "jesus" },
      { id: "variant-ru" },
    ])
    expect(result?.video.title).toBe("Jesus RU broad")
    expect(result?.video.studyQuestions).toEqual([
      { documentId: "sq-ru-broad", value: "Broad question?", order: 1 },
    ])
  })

  it("uses broad BCP-47 content when exact child titles are missing", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            label: "featureFilm",
            locales: [
              {
                documentId: "loc-ru",
                title: "Jesus RU",
                description: "Russian description",
                snippet: "Russian snippet",
                imageAlt: "Russian still",
              },
            ],
            studyQuestions: [
              { documentId: "sq-ru", value: "Russian question?", order: 1 },
            ],
            children: [
              {
                child: {
                  documentId: "child-1",
                  slug: "the-beginning",
                  label: "SEGMENT",
                  images: [],
                  durationSeconds: 120,
                  muxPlaybackId: "mux-child-1",
                  exactLocales: [],
                  broadLocales: [
                    {
                      documentId: "child-loc-ru",
                      title: "The Beginning RU",
                    },
                  ],
                },
              },
            ],
            variants: [makeRussianVariant()],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeRussianDub(),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "russian")

    expect(queryMock.mock.calls.map((call) => call[0].variables)).toEqual([
      { locale: "ru", languageSlug: "russian", videoSlug: "jesus" },
      { id: "variant-ru" },
    ])
    expect(result?.video.title).toBe("Jesus RU")
    expect(result?.video.children[0]?.title).toBe("The Beginning RU")
    expect(result?.video.children[0]?.muxPlaybackId).toBe("mux-child-1")
  })

  it("falls back to English questions without losing localized title or dub selection", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            variants: [makeRussianVariant()],
            locales: [
              {
                documentId: "loc-ru",
                title: "Jesus RU",
                description: "Russian description",
                snippet: "Russian snippet",
                imageAlt: "Russian still",
              },
            ],
            exactLocales: [
              {
                documentId: "loc-ru",
                title: "Jesus RU",
                description: "Russian description",
                snippet: "Russian snippet",
                imageAlt: "Russian still",
              },
            ],
            studyQuestions: [],
            exactStudyQuestions: [],
            broadLocales: [
              {
                documentId: "loc-ru-broad",
                title: "Jesus RU broad",
                description: "Russian broad description",
                snippet: "Russian broad snippet",
                imageAlt: "Russian broad still",
              },
            ],
            broadStudyQuestions: [],
            englishLocales: [
              {
                documentId: "loc-en",
                title: "Jesus",
                description: "English description",
                snippet: "English snippet",
                imageAlt: "English still",
              },
            ],
            englishStudyQuestions: [
              { documentId: "sq-en", value: "English question?", order: 1 },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeRussianDub(),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "russian")

    expect(queryMock.mock.calls.map((call) => call[0].variables)).toEqual([
      { locale: "ru", languageSlug: "russian", videoSlug: "jesus" },
      { id: "variant-ru" },
    ])
    expect(result?.video.title).toBe("Jesus RU")
    expect(result?.video.studyQuestions).toEqual([
      { documentId: "sq-en", value: "English question?", order: 1 },
    ])
    expect(result?.selectedVariant.language?.slug).toBe("russian")
  })

  it("does not re-fetch when the request is already for locale='en'", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({ locales: [] }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeAdminDub(),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    await resolveWatchVideoBySlug("jesus", "en")

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryMock.mock.calls.map((call) => call[0].variables)).toEqual([
      { locale: "en", languageSlug: null, videoSlug: "jesus" },
      { id: "variant-1" },
    ])
  })
})
