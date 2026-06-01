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

describe("resolveWatchPage", () => {
  afterEach(() => {
    queryMock.mockReset()
    vi.resetModules()
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
  })

  it("prefers an explicit experience when the slug doesn't match the template slug", async () => {
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

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({
      kind: "experience",
      experience: {
        slug: "christmas",
      },
    })
  })

  it("falls back to the default template for plain video slugs", async () => {
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
          experienceBySlug: null,
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            children: [
              {
                child: {
                  documentId: "child-1",
                  slug: "the-beginning",
                  label: "SEGMENT",
                  locales: [{ documentId: "cl-1", title: "The Beginning" }],
                  images: [
                    {
                      documentId: "img-c",
                      url: "https://cdn.example/child.jpg",
                    },
                  ],
                  dubs: [],
                },
              },
              {
                // Self-child filter: skip the entry pointing back at the
                // current video.
                child: {
                  documentId: "video-1",
                  slug: "jesus",
                  label: null,
                  locales: [{ documentId: "cl-2", title: "Jesus" }],
                  images: [],
                  dubs: [],
                },
              },
            ],
          }),
        },
      })

    const { resolveWatchPage } = await import("./content")

    const result = await resolveWatchPage("en", "jesus")

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
        data: { experienceBySlug: null },
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
      .mockResolvedValueOnce({ data: { experienceBySlug: null } })
      .mockResolvedValueOnce({
        data: {
          // Empty variants — selectPlayableVariant returns null, so
          // normalizeRouteVideo returns null and the route bails.
          videoBySlug: makeAdminVideo({ variants: [] }),
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

  it("re-fetches with locale='en' when the primary fetch returns empty locales for a non-en request", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({ locales: [] }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            locales: [
              {
                documentId: "loc-en",
                title: "Jesus (English fallback)",
                description: "English description",
                snippet: "English snippet",
                imageAlt: "Jesus still",
              },
            ],
          }),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "fr")

    expect(queryMock).toHaveBeenCalledTimes(2)
    const fallbackCall = queryMock.mock.calls[1][0] as {
      variables: { locale: string; videoSlug: string }
    }
    expect(fallbackCall.variables).toEqual({
      locale: "en",
      videoSlug: "jesus",
    })
    expect(result?.video.title).toBe("Jesus (English fallback)")
  })

  it("does not re-fetch when the primary fetch already returns a locale row", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: makeAdminVideo({
          studyQuestions: [
            { documentId: "sq-fr", value: "Question?", order: 1 },
          ],
        }),
      },
    })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "fr")

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(result?.video.title).toBe("Jesus")
  })

  it("queries admin content with BCP-47 when the watch URL uses an audio slug", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: makeAdminVideo({
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
          variants: [
            {
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
              downloads: [],
              muxVideo: { playbackId: "pb-ru" },
            },
          ],
        }),
      },
    })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "russian")

    expect(queryMock).toHaveBeenCalledTimes(1)
    const primaryCall = queryMock.mock.calls[0][0] as {
      variables: { locale: string; videoSlug: string }
    }
    expect(primaryCall.variables).toEqual({
      locale: "ru",
      videoSlug: "jesus",
    })
    expect(result?.video.title).toBe("Jesus RU")
    expect(result?.selectedVariant.language?.slug).toBe("russian")
  })

  it("falls back to English questions without losing localized title or dub selection", async () => {
    queryMock
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            locales: [
              {
                documentId: "loc-ru",
                title: "Jesus RU",
                description: "Russian description",
                snippet: "Russian snippet",
                imageAlt: "Russian still",
              },
            ],
            studyQuestions: [],
            variants: [
              {
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
                downloads: [],
                muxVideo: { playbackId: "pb-ru" },
              },
            ],
          }),
        },
      })
      .mockResolvedValueOnce({
        data: {
          videoBySlug: makeAdminVideo({
            locales: [
              {
                documentId: "loc-en",
                title: "Jesus",
                description: "English description",
                snippet: "English snippet",
                imageAlt: "English still",
              },
            ],
            studyQuestions: [
              { documentId: "sq-en", value: "English question?", order: 1 },
            ],
          }),
        },
      })

    const { resolveWatchVideoBySlug } = await import("./content")

    const result = await resolveWatchVideoBySlug("jesus", "russian")

    expect(
      queryMock.mock.calls.map((call) => call[0].variables.locale),
    ).toEqual(["ru", "en"])
    expect(result?.video.title).toBe("Jesus RU")
    expect(result?.video.studyQuestions).toEqual([
      { documentId: "sq-en", value: "English question?", order: 1 },
    ])
    expect(result?.selectedVariant.language?.slug).toBe("russian")
  })

  it("does not re-fetch when the request is already for locale='en'", async () => {
    queryMock.mockResolvedValueOnce({
      data: {
        videoBySlug: makeAdminVideo({ locales: [] }),
      },
    })

    const { resolveWatchVideoBySlug } = await import("./content")

    await resolveWatchVideoBySlug("jesus", "en")

    expect(queryMock).toHaveBeenCalledTimes(1)
  })
})
