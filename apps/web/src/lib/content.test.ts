import { afterEach, describe, expect, it, vi } from "vitest"
import { print } from "graphql"

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
          keyParts: ["watch-page", "v5-category-rail-compatibility"],
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
          keyParts: ["watch-experience-page", "v2-category-rail-compatibility"],
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
      watchHomeCategoryRailCompatibility: "supported",
      experience: {
        slug: "home",
      },
    })
  })

  it("retries once with the legacy fragment only for the category typename validation error", async () => {
    const validationError = Object.assign(
      new Error('Unknown type "WatchHomeCategoryRailBlock".'),
      {
        errors: [
          {
            message:
              'Unknown type "WatchHomeCategoryRailBlock". Did you mean "WatchHomeHeroBlock"?',
            extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
          },
        ],
      },
    )
    queryMock.mockRejectedValueOnce(validationError).mockResolvedValueOnce({
      data: {
        watchSetting: {
          documentId: "watch-settings-1",
          homepageExperience: {
            __typename: "ExperienceLocale",
            id: "exp-home-1",
            slug: "home",
            title: "Home",
            blocks: [],
          },
          defaultTemplateExperience: null,
        },
      },
    })

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en")

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(print(queryMock.mock.calls[0][0].query)).toContain(
      "WatchHomeCategoryRailBlock",
    )
    expect(print(queryMock.mock.calls[1][0].query)).not.toContain(
      "WatchHomeCategoryRailBlock",
    )
    expect(result).toMatchObject({
      error: null,
      data: {
        kind: "experience",
        watchHomeCategoryRailCompatibility: "legacy-schema",
      },
    })
  })

  it("never retries the legacy query more than once", async () => {
    const unknownTypeError = {
      errors: [
        {
          message: 'Unknown type "WatchHomeCategoryRailBlock".',
          extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
        },
      ],
    }
    queryMock.mockResolvedValueOnce(unknownTypeError).mockResolvedValueOnce({
      errors: [
        {
          message: "Legacy query also failed",
          extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
        },
      ],
    })

    const { resolveWatchPage } = await import("./content")
    const result = await resolveWatchPage("en")

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(result.data).toBeNull()
    expect(result.error?.message).toBe("Legacy query also failed")
  })

  it.each([
    ["network", "reject", new Error("fetch failed")],
    ["timeout", "reject", new Error("request timed out")],
    ["authorization", "resolve", { error: new Error("Unauthorized") }],
    [
      "resolver",
      "resolve",
      {
        errors: [
          {
            message: "Watch setting resolver failed",
            path: ["watchSetting"],
            extensions: { code: "INTERNAL_SERVER_ERROR" },
          },
        ],
      },
    ],
    [
      "unrelated validation",
      "resolve",
      {
        errors: [
          {
            message: 'Unknown type "SomeOtherBlock".',
            extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
          },
        ],
      },
    ],
  ])(
    "does not enable compatibility or retry for a %s failure",
    async (_label, behavior, failure) => {
      if (behavior === "reject") queryMock.mockRejectedValueOnce(failure)
      else queryMock.mockResolvedValueOnce(failure)

      const { resolveWatchPage } = await import("./content")
      const result = await resolveWatchPage("en")

      expect(queryMock).toHaveBeenCalledTimes(1)
      expect(result.data).toBeNull()
      expect(result.error).not.toBeNull()
    },
  )

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

  it("reuses a proven legacy schema for the explicit experience lookup", async () => {
    const validationError = Object.assign(
      new Error('Unknown type "WatchHomeCategoryRailBlock".'),
      {
        errors: [
          {
            message: 'Unknown type "WatchHomeCategoryRailBlock".',
            extensions: { code: "GRAPHQL_VALIDATION_FAILED" },
          },
        ],
      },
    )
    queryMock
      .mockRejectedValueOnce(validationError)
      .mockResolvedValueOnce({
        data: {
          watchSetting: {
            documentId: "watch-settings-1",
            homepageExperience: null,
            defaultTemplateExperience: null,
          },
        },
      })
      .mockResolvedValueOnce({ data: { videoBySlug: null } })
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

    expect(queryMock).toHaveBeenCalledTimes(4)
    expect(print(queryMock.mock.calls[3][0].query)).not.toContain(
      "WatchHomeCategoryRailBlock",
    )
    expect(result).toMatchObject({
      error: null,
      data: {
        kind: "experience",
        experience: { slug: "christmas" },
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
                searchTitle:
                  "Watch JESUS — Full Movie Free Online | Jesus Film Project",
                searchDescription: "Watch the JESUS film free online.",
                socialImage: {
                  url: "https://admin.example/public/jesus-social.jpg",
                  width: 1200,
                  height: 630,
                },
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
        searchTitle:
          "Watch JESUS — Full Movie Free Online | Jesus Film Project",
        searchDescription: "Watch the JESUS film free online.",
        socialImage: {
          url: "https://admin.example/public/jesus-social.jpg",
          width: 1200,
          height: 630,
        },
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
describe("resolveWatchUnavailableRecoveryTarget", () => {
  afterEach(() => {
    queryMock.mockReset()
    vi.resetModules()
  })

  it("returns requested-language copy and stable artwork without selecting playback", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        watchVideoRouteSnapshotBySlug: makeAdminVideo({
          slug: "good-friday-live",
          images: [
            {
              documentId: "img-good-friday",
              url: "https://imagedelivery.net/account/original.jpg",
              mobileCinematicHigh:
                "https://imagedelivery.net/account/cinematic-high.jpg",
            },
          ],
          locales: [],
          exactLocales: [
            {
              documentId: "loc-zh-hans",
              languageSlug: "chinese-simplified",
              title: "耶稣受难日直播",
            },
          ],
          broadLocales: [],
          englishLocales: [
            {
              documentId: "loc-en",
              languageSlug: "english",
              title: "Good Friday Live",
            },
          ],
          variants: [],
        }),
      },
    })

    const { resolveWatchUnavailableRecoveryTarget } = await import("./content")
    const target = await resolveWatchUnavailableRecoveryTarget(
      "good-friday-live",
      "chinese-simplified",
    )

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0][0].variables).toEqual({
      locale: "zh-Hans",
      languageSlug: "chinese-simplified",
      videoSlug: "good-friday-live",
    })
    expect(target).toEqual({
      contentTitle: "耶稣受难日直播",
      imageUrl: "https://imagedelivery.net/account/cinematic-high.jpg",
    })
  })

  it("returns no target when Admin no longer has the manifest-listed video", async () => {
    queryMock.mockResolvedValueOnce({
      data: { watchVideoRouteSnapshotBySlug: null },
    })

    const { resolveWatchUnavailableRecoveryTarget } = await import("./content")

    await expect(
      resolveWatchUnavailableRecoveryTarget(
        "good-friday-live",
        "chinese-simplified",
      ),
    ).resolves.toBeNull()
  })
})

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

  it("keeps canonical BCP-47 tags when loading localized content", async () => {
    const chineseVariant = {
      ...(makeAdminVideo().variants as Record<string, unknown>[])[0],
      documentId: "variant-zh-hans",
      slug: "chinese-simplified",
      hls: "https://cdn.example/god-rescue-plan-zh-hans.m3u8",
      language: {
        coreId: "lang-zh-hans",
        bcp47: "zh-hans",
        slug: "chinese-simplified",
        name: "Chinese, Simplified",
      },
    }
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchVideoRouteSnapshotBySlug: makeAdminVideo({
            slug: "god-rescue-plan",
            locales: [],
            exactLocales: [
              {
                documentId: "loc-zh-hans",
                languageSlug: "chinese-simplified",
                title: "上帝的拯救计划",
                description: "中文简介",
              },
            ],
            broadLocales: [],
            englishLocales: [
              {
                documentId: "loc-en",
                languageSlug: "english",
                title: "God's Rescue Plan",
              },
            ],
            variants: [chineseVariant],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeAdminDub(chineseVariant),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug(
      "god-rescue-plan",
      "chinese-simplified",
    )

    expect(queryMock.mock.calls[0][0].variables).toEqual({
      locale: "zh-Hans",
      languageSlug: "chinese-simplified",
      videoSlug: "god-rescue-plan",
    })
    expect(result?.video.title).toBe("上帝的拯救计划")
    expect(result?.video.description).toBe("中文简介")
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
                searchTitle: "Watch Jesus in English",
                searchDescription: "English search description",
                socialImage: {
                  url: "https://admin.example/english.jpg",
                  width: 1200,
                  height: 630,
                },
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
    expect(result?.video.searchTitle).toBe("Watch Jesus in English")
    expect(result?.video.searchDescription).toBe("English search description")
    expect(result?.video.socialImage?.url).toBe(
      "https://admin.example/english.jpg",
    )
    expect(result?.video.localePublishedAt).toBeNull()
  })

  it("hydrates the same-audio edition selected for requested subtitles", async () => {
    const selectedEditionVariant = {
      ...(makeAdminVideo().variants as Record<string, unknown>[])[0],
      documentId: "variant-english-edition-with-russian",
      duration: 110,
    }
    queryMock
      .mockResolvedValueOnce({
        data: {
          watchVideoRouteSnapshotBySlug: makeAdminVideo({
            slug: "perfect-2",
            // Admin has already preferred this edition over a longer English
            // dub whose edition does not contain the requested Russian VTT.
            variants: [selectedEditionVariant],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeAdminDub({
            ...selectedEditionVariant,
            videoEdition: {
              subtitles: [
                {
                  documentId: "sub-russian-edition-wide",
                  vttSrc: "https://cdn.example/russian.vtt",
                  srtSrc: null,
                  primary: false,
                  aiGenerated: false,
                  video: null,
                  language: {
                    coreId: "3934",
                    bcp47: "ru",
                    slug: "russian",
                    name: "Russian",
                  },
                },
              ],
            },
          }),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug(
      "perfect-2",
      "english",
      "russian",
    )

    expect(queryMock.mock.calls.map((call) => call[0].variables)).toEqual([
      {
        locale: "en",
        languageSlug: "english",
        subtitleLanguageSlug: "russian",
        videoSlug: "perfect-2",
      },
      { id: "variant-english-edition-with-russian" },
    ])
    expect(result?.selectedVariant.documentId).toBe(
      "variant-english-edition-with-russian",
    )
    expect(result?.video.subtitles).toEqual([
      expect.objectContaining({ documentId: "sub-russian-edition-wide" }),
    ])
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

  it("keeps edition-wide and current-Video subtitles while excluding sibling-owned tracks", async () => {
    const subtitleLanguage = (slug: string, bcp47: string) => ({
      coreId: slug,
      bcp47,
      slug,
      name: slug,
    })
    const subtitle = ({
      documentId,
      languageSlug,
      ownerId,
    }: {
      documentId: string
      languageSlug: string
      ownerId: string | null
    }) => ({
      documentId,
      vttSrc: `https://cdn.example/${documentId}.vtt`,
      srtSrc: null,
      primary: false,
      aiGenerated: false,
      video: ownerId ? { documentId: ownerId } : null,
      language: subtitleLanguage(
        languageSlug,
        languageSlug === "russian" ? "ru" : "en",
      ),
    })

    queryMock
      .mockResolvedValueOnce({
        data: { videoBySlug: makeAdminVideo() },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeAdminDub({
            videoEdition: {
              subtitles: [
                subtitle({
                  documentId: "sub-sibling-ru",
                  languageSlug: "russian",
                  ownerId: "video-2",
                }),
                subtitle({
                  documentId: "sub-global-ru",
                  languageSlug: "russian",
                  ownerId: null,
                }),
                subtitle({
                  documentId: "sub-current-ru",
                  languageSlug: "russian",
                  ownerId: "video-1",
                }),
                subtitle({
                  documentId: "sub-global-en",
                  languageSlug: "english",
                  ownerId: null,
                }),
              ],
            },
          }),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "en")

    expect(result?.video.subtitles.map((track) => track.documentId)).toEqual([
      "sub-global-en",
      "sub-current-ru",
    ])
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
                searchTitle: "Смотреть фильм ИИСУС",
                searchDescription: "Русское описание для поиска",
                socialImage: {
                  url: "https://admin.example/russian.jpg",
                  width: 1200,
                  height: 630,
                },
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
    expect(result?.video.searchTitle).toBe("Смотреть фильм ИИСУС")
    expect(result?.video.searchDescription).toBe("Русское описание для поиска")
    expect(result?.video.socialImage?.url).toBe(
      "https://admin.example/russian.jpg",
    )
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
                searchTitle: "Broad Russian search title",
                searchDescription: null,
                socialImage: {
                  url: "https://admin.example/russian-broad.jpg",
                  width: null,
                  height: null,
                },
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
    expect(result?.video.searchTitle).toBe("Broad Russian search title")
    expect(result?.video.searchDescription).toBeNull()
    expect(result?.video.socialImage).toEqual({
      url: "https://admin.example/russian-broad.jpg",
      width: null,
      height: null,
    })
    expect(result?.video.studyQuestions).toEqual([
      { documentId: "sq-ru-broad", value: "Broad question?", order: 1 },
    ])
  })

  it("uses broad English content when the exact English-slug title is blank", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            locales: [],
            exactLocales: [
              {
                documentId: "loc-en-slug",
                title: "  ",
                description: "Exact English-slug description",
                snippet: "Exact English-slug snippet",
                imageAlt: "Exact English-slug still",
              },
            ],
            broadLocales: [
              {
                documentId: "loc-en-broad",
                title: "  Jesus from broad English  ",
                description: "Broad English description",
              },
            ],
            englishLocales: [],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeAdminDub(),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "english")

    expect(queryMock.mock.calls.map((call) => call[0].variables)).toEqual([
      { locale: "en", languageSlug: "english", videoSlug: "jesus" },
      { id: "variant-1" },
    ])
    expect(result?.video.title).toBe("Jesus from broad English")
    expect(result?.video.description).toBe("Exact English-slug description")
    expect(result?.video.snippet).toBe("Exact English-slug snippet")
    expect(result?.video.imageAlt).toBe("Exact English-slug still")
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

  it("falls back blank localized titles to English without replacing localized copy", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            slug: "lumo-the-gospel-of-mark",
            label: "featureFilm",
            variants: [makeRussianVariant()],
            locales: [],
            exactLocales: [
              {
                documentId: "loc-ru",
                title: "   ",
                description: "Russian description",
                snippet: "Russian snippet",
                imageAlt: "Russian still",
              },
            ],
            broadLocales: [
              {
                documentId: "loc-ru-broad",
                title: "\n\t",
                description: "Broad Russian description",
              },
            ],
            englishLocales: [
              {
                documentId: "loc-en",
                title: "  LUMO – The Gospel of Mark  ",
                description: "English description",
              },
            ],
            parents: [
              {
                parent: {
                  documentId: "parent-1",
                  slug: "lumo-gospels",
                  noIndex: false,
                  label: "SERIES",
                  images: [],
                  children: [],
                  exactLocales: [{ documentId: "parent-loc-ru", title: " " }],
                  broadLocales: [],
                  englishLocales: [
                    {
                      documentId: "parent-loc-en",
                      title: "  LUMO Gospels  ",
                    },
                  ],
                },
              },
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
                  exactLocales: [{ documentId: "child-loc-ru", title: "" }],
                  broadLocales: [],
                  englishLocales: [
                    {
                      documentId: "child-loc-en",
                      title: "  The Beginning  ",
                    },
                  ],
                },
              },
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

    const result = await resolveWatchVideoBySlug(
      "lumo-the-gospel-of-mark",
      "russian",
    )

    expect(result?.video.title).toBe("LUMO – The Gospel of Mark")
    expect(result?.video.description).toBe("Russian description")
    expect(result?.video.snippet).toBe("Russian snippet")
    expect(result?.video.imageAlt).toBe("Russian still")
    expect(result?.video.parents[0]?.title).toBe("LUMO Gospels")
    expect(result?.video.children[0]?.title).toBe("The Beginning")
  })

  it("uses a later nonblank requested-language title before English", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            variants: [makeRussianVariant()],
            locales: [],
            exactLocales: [
              {
                documentId: "loc-ru-blank",
                title: " ",
                description: "Russian description",
              },
              {
                documentId: "loc-ru-titled",
                title: "  Иисус  ",
                description: "Secondary Russian description",
              },
            ],
            broadLocales: [],
            englishLocales: [
              { documentId: "loc-en", title: "Jesus in English" },
            ],
            studyQuestions: [
              { documentId: "sq-ru", value: "Question?", order: 1 },
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

    expect(result?.video.title).toBe("Иисус")
    expect(result?.video.description).toBe("Russian description")
  })

  it("humanizes the slug when localized and English titles are blank", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            slug: "lumo_the--gospel-of-mark",
            variants: [makeRussianVariant()],
            locales: [],
            exactLocales: [
              {
                documentId: "loc-ru",
                title: " ",
                description: "Russian description",
                snippet: "Russian snippet",
                imageAlt: "Russian still",
              },
            ],
            broadLocales: [],
            englishLocales: [
              {
                documentId: "loc-en",
                title: "\t",
                description: "English description",
                snippet: "English snippet",
                imageAlt: "English still",
              },
            ],
            parents: [
              {
                parent: {
                  documentId: "parent-1",
                  slug: "lumo__gospel--collection",
                  noIndex: false,
                  label: "SERIES",
                  images: [],
                  exactLocales: [{ documentId: "parent-loc-ru", title: " " }],
                  broadLocales: [],
                  englishLocales: [
                    { documentId: "parent-loc-en", title: "\n" },
                  ],
                  children: [
                    {
                      order: 7,
                      child: {
                        documentId: "nested-child-1",
                        slug: "episode__one--begins",
                        label: "SEGMENT",
                        images: [],
                        muxPlaybackId: "mux-nested-child-1",
                        exactLocales: [
                          {
                            documentId: "nested-child-loc-ru",
                            title: " ",
                          },
                        ],
                        broadLocales: [],
                        englishLocales: [
                          {
                            documentId: "nested-child-loc-en",
                            title: "\t",
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
            children: [
              {
                order: 11,
                child: {
                  documentId: "child-1",
                  slug: "the__first--chapter",
                  label: "SEGMENT",
                  images: [],
                  durationSeconds: 120,
                  muxPlaybackId: "mux-child-1",
                  exactLocales: [{ documentId: "child-loc-ru", title: " " }],
                  broadLocales: [],
                  englishLocales: [{ documentId: "child-loc-en", title: "\t" }],
                },
              },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoDub: makeRussianDub(),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: { childDubLanguages: [] },
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug(
      "lumo_the--gospel-of-mark",
      "russian",
    )

    expect(result?.video.title).toBe("Lumo The Gospel Of Mark")
    expect(result?.video.description).toBe("Russian description")
    expect(result?.video.snippet).toBe("Russian snippet")
    expect(result?.video.imageAlt).toBe("Russian still")
    expect(result?.video.parents[0]?.title).toBe("Lumo Gospel Collection")
    expect(result?.video.parents[0]?.children[0]?.title).toBe(
      "Episode One Begins",
    )
    expect(result?.video.parents[0]?.children[0]?.order).toBe(7)
    expect(result?.video.children[0]?.title).toBe("The First Chapter")
    expect(result?.video.children[0]?.order).toBe(11)
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
