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

function makeImage(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "img-1",
    url: "https://cdn.example/jesus.jpg",
    thumbnail: "https://cdn.example/jesus-thumb.jpg",
    mobileCinematicHigh: "https://cdn.example/jesus-cinematic.jpg",
    mobileCinematicLow: null,
    videoStill: null,
    blurDataUrl: null,
    dominantColor: null,
    ...overrides,
  }
}

function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "variant-1",
    slug: "english",
    published: true,
    hls: "https://stream.example/jesus.m3u8",
    duration: 123,
    language: {
      coreId: "529",
      bcp47: "en",
      slug: "english",
      name: { en: "English" },
    },
    muxVideo: { playbackId: "mux-playback-1" },
    ...overrides,
  }
}

function makeChild(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "child-1",
    coreId: "child-core-1",
    slug: "episode-one",
    label: "EPISODE",
    durationSeconds: 87,
    primaryLanguage: {
      coreId: "529",
      bcp47: "en",
      slug: "english",
    },
    images: [makeImage({ mobileCinematicHigh: "https://cdn.example/ep1.jpg" })],
    locales: [
      {
        documentId: "child-locale-1",
        languageSlug: "english",
        title: "Episode One",
        description: null,
        snippet: "The first episode",
        imageAlt: "Episode One still",
      },
    ],
    preferredVariant: makeVariant({
      documentId: "child-variant-1",
      hls: "https://stream.example/episode-one.m3u8",
      duration: 87,
      muxVideo: { playbackId: "mux-episode-one" },
    }),
    ...overrides,
  }
}

function makeVideo(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "video-1",
    coreId: "1_jf-0-0",
    slug: "jesus",
    label: "FEATURE_FILM",
    durationSeconds: 123,
    primaryLanguage: {
      coreId: "529",
      bcp47: "en",
      slug: "english",
    },
    images: [makeImage()],
    locales: [
      {
        documentId: "locale-1",
        languageSlug: "english",
        title: "Jesus",
        description: "A full description",
        snippet: "The story of Jesus",
        imageAlt: "Jesus still",
      },
    ],
    preferredVariant: makeVariant(),
    children: [],
    ...overrides,
  }
}

describe("buildWatchHomeModelFromVideos", () => {
  afterEach(() => {
    queryMock.mockReset()
    unstableCacheCalls.length = 0
    vi.resetModules()
  })

  it("declares tags on the cached watch home model", async () => {
    await import("../watch-home")

    expect(unstableCacheCalls).toContainEqual({
      keyParts: ["watch-home", "v6-real-images-with-dominant-colors"],
      options: {
        revalidate: 60,
        tags: ["watch:home", "watch:video"],
      },
    })
  })

  it("maps admin videos into hero slides and configured sections with safe watch URLs", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [
        makeVideo(),
        makeVideo({
          documentId: "video-2",
          coreId: "2_GOJ-0-0",
          slug: "gospel-of-john",
          locales: [
            {
              documentId: "locale-2",
              languageSlug: "english",
              title: "The Gospel of John",
              description: null,
              snippet: "John's Gospel",
              imageAlt: null,
            },
          ],
        }),
      ] as never,
    })

    expect(model.heroSlides.map((slide) => slide.title)).toEqual([
      "Jesus",
      "The Gospel of John",
    ])
    expect(model.heroSlides[0]?.href).toBe("/jesus.html/english.html")
    expect(model.heroSlides[0]?.imageUrl).toBe(
      "https://cdn.example/jesus-cinematic.jpg",
    )
    expect(model.heroSlides[0]?.metaLabel).toBe("2:03")

    const gospelRail = model.sections.find(
      (section) => section.id === "home-video-gospels",
    )
    expect(gospelRail?.cards.map((card) => card.coreId)).toEqual([
      "1_jf-0-0",
      "2_GOJ-0-0",
    ])
    expect(model.carousel.pools[0]).toMatchObject({
      collectionIds: ["1_jf-0-0"],
    })
    expect(model.carousel.pools[0]?.videos[0]).toMatchObject({
      kind: "video",
      title: "Jesus",
      src: "https://stream.example/jesus.m3u8",
    })
    expect(model.carousel.muxInserts.map((insert) => insert.id)).toEqual([
      "welcome-start",
      "join-us",
      "telling-the-story-of-jesus",
    ])
  })

  it("renders limited child cards with parent-scoped episode routes", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [
        makeVideo({
          documentId: "lumo",
          coreId: "LUMOCollection",
          slug: "lumo",
          label: "COLLECTION",
          children: [
            { child: makeChild() },
            {
              child: makeChild({ documentId: "child-2", slug: "episode-two" }),
            },
          ],
        }),
      ] as never,
    })

    const vertical = model.sections.find(
      (section) => section.id === "home-collection-showcase-grid-vertical",
    )
    expect(vertical?.cards).toHaveLength(1)
    expect(vertical?.cards[0]?.title).toBe("Episode One")
    expect(vertical?.cards[0]?.href).toBe("/lumo.html/episode-one/english.html")
    expect(vertical?.cards[0]?.parentCoreId).toBe("LUMOCollection")
  })

  it("applies homepage media overrides to configured child cards", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [
        makeVideo({
          documentId: "lumo-admin-id",
          coreId: "LUMOCollection",
          slug: "lumo",
          label: "COLLECTION",
          children: [{ child: makeChild() }],
        }),
      ] as never,
      experienceBlocks: [
        {
          __typename: "MediaCollectionBlock",
          sectionKey: "home-collection-showcase-grid-vertical",
          items: [
            {
              videoId: "lumo-admin-id",
              imageOverrideUrl:
                "http://localhost:3003/api/media-assets/asset-1/preview",
              imageOverrideBlurDataUrl:
                "data:image/jpeg;base64,override-placeholder",
              imageOverrideDominantColor: "#787e16",
            },
          ],
        },
      ] as never,
    })

    const vertical = model.sections.find(
      (section) => section.id === "home-collection-showcase-grid-vertical",
    )
    expect(vertical?.cards[0]?.imageUrl).toBe(
      "http://localhost:3003/api/media-assets/asset-1/preview",
    )
    expect(vertical?.cards[0]?.blurDataUrl).toBe(
      "data:image/jpeg;base64,override-placeholder",
    )
    expect(vertical?.cards[0]?.dominantColor).toBe("#787e16")
  })

  it("selects watch-home image URL, blur, and dominant color from the same image row", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [
        makeVideo({
          images: [
            makeImage({
              documentId: "img-without-render-url",
              url: null,
              thumbnail: null,
              mobileCinematicHigh: null,
              blurDataUrl: "data:image/jpeg;base64,wrong-row",
              dominantColor: "#ffffff",
            }),
            makeImage({
              documentId: "img-rendered",
              mobileCinematicHigh: "https://cdn.example/rendered.jpg",
              blurDataUrl: "data:image/jpeg;base64,right-row",
              dominantColor: "#123456",
            }),
          ],
        }),
      ] as never,
    })

    expect(model.heroSlides[0]).toMatchObject({
      imageUrl: "https://cdn.example/rendered.jpg",
      blurDataUrl: "data:image/jpeg;base64,right-row",
      dominantColor: "#123456",
    })
  })

  it("does not reuse child video color when an authored override image has no color", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [
        makeVideo({
          documentId: "lumo-collection",
          coreId: "LUMOCollection",
          slug: "lumo",
          label: "COLLECTION",
          children: [
            {
              child: makeChild({
                documentId: "lumo-child",
                coreId: "lumo-child-core",
                images: [
                  makeImage({
                    mobileCinematicHigh: "https://cdn.example/lumo-child.jpg",
                    blurDataUrl: "data:image/jpeg;base64,VIDEO",
                    dominantColor: "#778899",
                  }),
                ],
              }),
            },
          ],
        }),
      ] as never,
      experienceBlocks: [
        {
          sectionKey: "home-collection-showcase-grid-vertical",
          items: [
            {
              videoId: "lumo-child",
              imageOverrideUrl: "https://cdn.example/uploaded-scripture.jpg",
              imageOverrideBlurDataUrl: null,
              imageOverrideDominantColor: null,
            },
          ],
        },
      ] as never,
    })

    const scripture = model.sections.find(
      (section) => section.id === "home-collection-showcase-grid-vertical",
    )
    const card = scripture?.cards.find((item) => item.id === "lumo-child")

    expect(card).toMatchObject({
      imageUrl: "https://cdn.example/uploaded-scripture.jpg",
      blurDataUrl: null,
      dominantColor: null,
    })
  })

  it("expands the Journey with Jesus course into child episode cards", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [
        makeVideo({
          documentId: "new-believer-course",
          coreId: "8_NBC",
          slug: "new-believer-course",
          label: "SERIES",
          children: [
            { child: makeChild() },
            {
              child: makeChild({
                documentId: "child-2",
                coreId: "child-core-2",
                slug: "episode-two",
                locales: [
                  {
                    documentId: "child-locale-2",
                    languageSlug: "english",
                    title: "Episode Two",
                    description: null,
                    snippet: "The second episode",
                    imageAlt: "Episode Two still",
                  },
                ],
              }),
            },
          ],
        }),
      ] as never,
    })

    const course = model.sections.find(
      (section) => section.id === "home-collection-new-believer-course",
    )

    expect(course?.cards.map((card) => card.title)).toEqual([
      "Episode One",
      "Episode Two",
    ])
    expect(course?.cards[0]?.href).toBe(
      "/new-believer-course.html/episode-one/english.html",
    )
    expect(course?.cards[0]?.parentCoreId).toBe("8_NBC")
    expect(course?.cards.some((card) => card.coreId === "8_NBC")).toBe(false)
  })

  it("filters blacklisted child videos from carousel pools", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [
        makeVideo({
          documentId: "origins",
          coreId: "7_Origins",
          slug: "origins",
          label: "COLLECTION",
          children: [
            {
              child: makeChild({
                documentId: "blacklisted",
                coreId: "7_Origins4Connect",
                slug: "connect",
              }),
            },
            {
              child: makeChild({
                documentId: "allowed",
                coreId: "7_OriginsAllowed",
                slug: "allowed",
              }),
            },
          ],
        }),
      ] as never,
    })

    const originsPool = model.carousel.pools.find((pool) =>
      pool.collectionIds.includes("7_Origins"),
    )

    expect(originsPool?.videos.map((video) => video.id)).toEqual([
      "7_OriginsAllowed",
    ])
  })

  it("uses Mux thumbnails when admin images are missing and records the image gap", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [
        makeVideo({
          images: [],
          preferredVariant: makeVariant({
            muxVideo: { playbackId: "mux-fallback" },
          }),
        }),
      ] as never,
    })

    expect(model.heroSlides[0]?.imageUrl).toBe(
      "https://image.mux.com/mux-fallback/thumbnail.jpg",
    )
    expect(
      model.missingData.some(
        (item) =>
          item.field === "image" &&
          item.sourceId === "1_jf-0-0" &&
          item.fallback === "Mux thumbnail",
      ),
    ).toBe(true)
  })

  it("normalizes a typed authored program and omits only unresolved video items", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [makeVideo()] as never,
      experienceBlocks: [
        {
          __typename: "WatchHomeHeroBlock",
          t: "watchHomeHero",
          program: {
            intro: {
              id: "welcome",
              playbackId: "welcome-playback",
              posterUrl: "https://cdn.example/welcome.jpg",
              title: "Welcome",
            },
            rotation: ["classics", "campaigns"],
            buckets: [
              {
                __typename: "WatchHomeVideoBucket",
                kind: "video",
                id: "classics",
                label: "Classics",
                items: [
                  {
                    id: "jesus-item",
                    videoId: "video-1",
                    coreId: "1_jf-0-0",
                  },
                  {
                    id: "missing-item",
                    videoId: "missing-video",
                    coreId: "missing-core",
                  },
                ],
              },
              {
                __typename: "WatchHomePromoBucket",
                kind: "promo",
                id: "campaigns",
                label: "Campaigns",
                items: [
                  {
                    id: "join-us",
                    playbackId: "join-playback",
                    posterUrl: "https://cdn.example/join.jpg",
                    title: "Join us",
                    primaryAction: {
                      label: "Join",
                      href: "https://www.jesusfilm.org/join",
                      icon: "join",
                    },
                  },
                ],
              },
            ],
          },
        },
      ] as never,
    })

    expect(model.program?.intro).toMatchObject({
      id: "welcome",
      src: "https://stream.mux.com/welcome-playback.m3u8",
      posterUrl: "https://cdn.example/welcome.jpg",
    })
    expect(model.program?.rotation).toEqual(["classics", "campaigns"])
    expect(model.program?.buckets[0]).toMatchObject({
      kind: "video",
      id: "classics",
      items: [
        {
          id: "jesus-item",
          videoId: "video-1",
          coreId: "1_jf-0-0",
          src: "https://stream.example/jesus.m3u8",
        },
      ],
    })
    expect(model.program?.buckets[1]).toMatchObject({
      kind: "promo",
      items: [
        {
          id: "join-us",
          primaryAction: {
            href: "https://www.jesusfilm.org/join",
          },
        },
      ],
    })
  })

  it("rejects unsafe promo destinations while preserving the rest of the program", async () => {
    const { buildWatchHomeModelFromVideos } = await import("../watch-home")

    const model = buildWatchHomeModelFromVideos({
      locale: "en",
      languageSlug: "english",
      videos: [makeVideo()] as never,
      experienceBlocks: [
        {
          __typename: "WatchHomeHeroBlock",
          t: "watchHomeHero",
          program: {
            rotation: ["campaigns"],
            buckets: [
              {
                __typename: "WatchHomePromoBucket",
                kind: "promo",
                id: "campaigns",
                label: "Campaigns",
                items: [
                  {
                    id: "unsafe",
                    playbackId: "unsafe-playback",
                    posterUrl: "https://cdn.example/unsafe.jpg",
                    title: "Unsafe",
                    primaryAction: {
                      label: "Go",
                      href: "javascript:alert(1)",
                    },
                  },
                  {
                    id: "safe",
                    playbackId: "safe-playback",
                    posterUrl: "https://cdn.example/safe.jpg",
                    title: "Safe",
                    primaryAction: { label: "Watch", href: "/watch" },
                  },
                ],
              },
            ],
          },
        },
      ] as never,
    })

    expect(model.program?.buckets[0]).toMatchObject({
      kind: "promo",
      items: [{ id: "safe" }],
    })
  })
})

describe("resolveWatchHome", () => {
  afterEach(() => {
    queryMock.mockReset()
    unstableCacheCalls.length = 0
    vi.resetModules()
  })

  it("queries admin with the public language slug for the UI locale", async () => {
    queryMock.mockResolvedValueOnce({
      data: { watchSetting: { homepageExperience: { blocks: [] } } },
    })
    queryMock.mockResolvedValueOnce({
      data: {
        watchHomeVideos: [makeVideo()],
      },
    })

    const { resolveWatchHome } = await import("../watch-home")

    const result = await resolveWatchHome("ru")

    expect(result.error).toBeNull()
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryMock.mock.calls[1][0].variables.languageSlug).toBe("russian")
    expect(queryMock.mock.calls[1][0].variables.locale).toBe("ru")
    expect(queryMock.mock.calls[1][0].variables.coreIds).toContain("1_jf-0-0")
  })

  it("uses an explicit language slug when the caller provides one", async () => {
    queryMock.mockResolvedValueOnce({
      data: { watchSetting: { homepageExperience: { blocks: [] } } },
    })
    queryMock.mockResolvedValueOnce({
      data: {
        watchHomeVideos: [
          makeVideo({
            preferredVariant: makeVariant({
              slug: "spanish-latin-american",
              language: {
                coreId: "21028",
                bcp47: "es-419",
                slug: "spanish-latin-american",
                name: { en: "Spanish, Latin American" },
              },
            }),
          }),
        ],
      },
    })

    const { resolveWatchHome } = await import("../watch-home")

    const result = await resolveWatchHome("es", "spanish-latin-american")

    expect(result.error).toBeNull()
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryMock.mock.calls[1][0].variables.languageSlug).toBe(
      "spanish-latin-american",
    )
    expect(queryMock.mock.calls[1][0].variables.locale).toBe("es")
  })
})
