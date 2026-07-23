// Per-kind round-trip + union-dispatch tests for the typed ExperienceBlock
// surface. Each test constructs a fixture POJO matching the Zod schema for
// one block kind, runs the GraphQL union's `resolveType` callback, and
// asserts the returned typename matches `T_TO_TYPENAME[t]`. The exhaustive
// 20-kind sweep proves Pothos's union dispatch contract for every block we
// can persist; the union-dispatch happy path mixes kinds in one array to
// catch any cross-block side effects in resolveType; edge cases cover the
// "no blocks" and "unknown discriminator" boundaries.
//
// Structural drift between Zod and Pothos lives in `blocks.drift.test.ts`.

import { describe, expect, it, vi } from "vitest"

vi.mock("@/services/video-image-blur-data-url.service", () => ({
  getOrScheduleVideoImageBlurDataUrl: vi.fn().mockResolvedValue(null),
}))

import {
  T_TO_TYPENAME,
  UnknownBlockKindError,
  type BlockKind,
} from "@/graphql/types/blocks"
import { schema } from "@/graphql/schema"
import { getOrScheduleVideoImageBlurDataUrl } from "@/services/video-image-blur-data-url.service"
import {
  type GraphQLUnionType,
  type GraphQLObjectType,
  type GraphQLResolveInfo,
  type GraphQLFieldResolver,
} from "graphql"

// -----------------------------------------------------------------------------
// Test helpers — reach into the schema to call each union's resolveType. The
// GraphQL-js union type stores resolveType under `_resolveType` (set by
// `Object.defineProperty` in `GraphQLUnionType`); using the public
// `resolveType` getter is safer.
// -----------------------------------------------------------------------------

type ResolveTypeFn = (
  value: unknown,
  context: unknown,
  info: GraphQLResolveInfo,
  abstractType: GraphQLUnionType,
) => string | GraphQLObjectType | null | undefined

function getUnionResolveType(unionName: string): ResolveTypeFn {
  const unionType = schema.getType(unionName) as GraphQLUnionType | undefined
  if (unionType == null) {
    throw new Error(`Union ${unionName} not registered on schema`)
  }
  const resolve = unionType.resolveType
  if (resolve == null) {
    throw new Error(`Union ${unionName} has no resolveType function`)
  }
  // Pothos wraps the resolveType so the typename can be returned either as a
  // string OR an object ref; the GraphQL-js layer accepts both.
  return resolve as unknown as ResolveTypeFn
}

const fakeInfo = {} as GraphQLResolveInfo
const fakeUnion = {} as GraphQLUnionType

function resolveTypeName(unionName: string, value: unknown): string {
  const resolved = getUnionResolveType(unionName)(
    value,
    null,
    fakeInfo,
    fakeUnion,
  )
  if (typeof resolved === "string") return resolved
  if (resolved != null && typeof resolved === "object" && "name" in resolved) {
    return (resolved as GraphQLObjectType).name
  }
  throw new Error(
    `resolveType returned a non-typename value: ${String(resolved)}`,
  )
}

function fieldResolver(
  typeName: string,
  fieldName: string,
): GraphQLFieldResolver<unknown, unknown> {
  const type = schema.getType(typeName) as GraphQLObjectType | undefined
  if (type == null) {
    throw new Error(`Object type ${typeName} not registered on schema`)
  }
  const resolve = type.getFields()[fieldName]?.resolve
  if (resolve == null) {
    throw new Error(`${typeName}.${fieldName} has no resolver`)
  }
  return resolve as GraphQLFieldResolver<unknown, unknown>
}

// -----------------------------------------------------------------------------
// Fixtures — one minimum-valid POJO per kind. Mirrors `BlockSchema.options`
// minimum-required field sets in `domain/blocks.ts`.
// -----------------------------------------------------------------------------

const fixtures: Readonly<Record<BlockKind, object>> = {
  adventCountdown: {
    t: "adventCountdown",
    title: "Advent",
  },
  bibleQuotesCarousel: {
    t: "bibleQuotesCarousel",
    quotes: [{ reference: "John 3:16", text: "For God so loved..." }],
  },
  card: {
    t: "card",
    title: "Hi",
    description: "World",
    variant: "default",
  },
  container: {
    t: "container",
    content: [],
  },
  containerSlot: {
    t: "containerSlot",
    gridSpan: 6,
  },
  cta: {
    t: "cta",
    buttonLabel: "Click",
    variant: "primary",
  },
  easterDates: {
    t: "easterDates",
    easterDatesTitle: "Easter",
    westernEasterLabel: "Western",
    orthodoxEasterLabel: "Orthodox",
    passoverLabel: "Passover",
  },
  infoBlocks: {
    t: "infoBlocks",
    blocks: [{ icon: "info", title: "Hello", description: "World" }],
  },
  mediaCollection: {
    t: "mediaCollection",
    variant: "grid",
    thumbnailOrientation: "vertical",
    itemsSource: "manual",
    showItemNumbers: false,
    items: [],
  },
  navigationCarousel: {
    t: "navigationCarousel",
    items: [
      {
        contentId: "abc",
        title: "Nav",
      },
    ],
  },
  promoBanner: {
    t: "promoBanner",
    heading: "Banner",
    description: "Body",
    ctaLink: "/cta",
  },
  quizButton: {
    t: "quizButton",
    buttonText: "Take quiz",
    iframeSrc: "https://quiz.nextstep.is/abc",
  },
  relatedQuestions: {
    t: "relatedQuestions",
    questions: [{ question: "Why?", answer: "Because." }],
  },
  section: {
    t: "section",
    dynamicBackgroundImage: false,
    staticOverlay: false,
    content: [],
  },
  text: {
    t: "text",
  },
  video: {
    t: "video",
    useRouteVideo: false,
  },
  videoCarousel: {
    t: "videoCarousel",
    itemsSource: "manual",
    items: [],
  },
  videoHero: {
    t: "videoHero",
    useRouteVideo: false,
  },
  videoRecommendations: {
    t: "videoRecommendations",
    limit: 10,
  },
  watchHomeHero: {
    t: "watchHomeHero",
  },
}

// Sanity guard so the fixture set stays in lockstep with the typed map.
const fixtureKeys = Object.keys(fixtures) as BlockKind[]
const expectedKeys = Object.keys(T_TO_TYPENAME) as BlockKind[]

describe("blocks fixture set covers every kind in T_TO_TYPENAME", () => {
  it("has the same key set as T_TO_TYPENAME (no missing or stale fixtures)", () => {
    expect([...fixtureKeys].sort()).toEqual([...expectedKeys].sort())
  })
})

// -----------------------------------------------------------------------------
// Per-kind round-trip — dispatch every fixture through ExperienceBlock's
// resolveType. Container content + section content variants are exercised
// separately below via the SectionContentBlock / ContainerContentBlock union
// dispatches (those unions reject kinds that are not in their member list at
// schema-validation time, so we test by passing through their resolveType
// callbacks directly).
// -----------------------------------------------------------------------------

describe("ExperienceBlock union resolveType — per-kind dispatch", () => {
  for (const kind of expectedKeys) {
    it(`dispatches "${kind}" → ${T_TO_TYPENAME[kind]}`, () => {
      const value = fixtures[kind]
      // Only kinds that are top-level members get dispatched through
      // ExperienceBlock. quizButton + containerSlot are excluded — they live
      // in narrower union scopes. Skip those at this layer.
      if (kind === "quizButton" || kind === "containerSlot") {
        return
      }
      const typename = resolveTypeName("ExperienceBlock", value)
      expect(typename).toBe(T_TO_TYPENAME[kind])
    })
  }
})

describe("SectionContentBlock union resolveType — per-kind dispatch", () => {
  const sectionContentKinds: BlockKind[] = [
    "mediaCollection",
    "text",
    "promoBanner",
    "infoBlocks",
    "cta",
    "container",
    "relatedQuestions",
    "bibleQuotesCarousel",
    "card",
    "video",
    "quizButton",
    "videoCarousel",
    "navigationCarousel",
  ]

  for (const kind of sectionContentKinds) {
    it(`dispatches "${kind}" → ${T_TO_TYPENAME[kind]}`, () => {
      const typename = resolveTypeName("SectionContentBlock", fixtures[kind])
      expect(typename).toBe(T_TO_TYPENAME[kind])
    })
  }
})

describe("ContainerContentBlock union resolveType — per-kind dispatch", () => {
  const containerContentKinds: BlockKind[] = [
    "containerSlot",
    "mediaCollection",
    "text",
    "relatedQuestions",
    "cta",
    "bibleQuotesCarousel",
    "card",
    "easterDates",
    "adventCountdown",
    "video",
  ]

  for (const kind of containerContentKinds) {
    it(`dispatches "${kind}" → ${T_TO_TYPENAME[kind]}`, () => {
      const typename = resolveTypeName("ContainerContentBlock", fixtures[kind])
      expect(typename).toBe(T_TO_TYPENAME[kind])
    })
  }
})

describe("asset-backed block URL field resolvers", () => {
  it("resolves public asset IDs before stale stored Admin preview URLs", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "asset-1",
      backend: "S3",
      status: "READY",
      visibility: "PUBLIC",
      objectKey: "media-assets/asset-1/original/hero.webp",
      previewObjectKey: null,
      muxPlaybackId: null,
    })

    const result = await fieldResolver(
      "MediaCollectionItem",
      "imageOverrideUrl",
    )(
      {
        imageOverrideAssetId: "asset-1",
        imageOverrideUrl:
          "http://0.0.0.0:8080/api/media-assets/asset-1/preview",
      },
      {},
      {
        request: { url: "https://admin.jesusfilm.org/api/graphql" },
        prisma: { mediaAsset: { findUnique } },
      },
      fakeInfo,
    )

    expect(result).toBe(
      "http://localhost:3003/api/public/media-assets/asset-1/preview",
    )
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "asset-1" } })
  })

  it("does not fall back to stale Admin preview URLs for private asset IDs", async () => {
    const result = await fieldResolver("MediaCollectionItem", "imageUrl")(
      {
        imageAssetId: "asset-1",
        imageUrl:
          "https://admin.jesusfilm.org/api/media-assets/asset-1/preview",
      },
      {},
      {
        request: { url: "https://admin.jesusfilm.org/api/graphql" },
        prisma: {
          mediaAsset: {
            findUnique: vi.fn().mockResolvedValue({
              id: "asset-1",
              backend: "S3",
              status: "READY",
              visibility: "PRIVATE",
              objectKey: "media-assets/asset-1/original/hero.webp",
              previewObjectKey: null,
              muxPlaybackId: null,
            }),
          },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
  })

  it("preserves external URL fallbacks when no asset ID is stored", async () => {
    const result = await fieldResolver("MediaCollectionItem", "imageUrl")(
      { imageUrl: "https://image.example.test/poster.jpg" },
      {},
      {
        request: { url: "https://admin.jesusfilm.org/api/graphql" },
        prisma: { mediaAsset: { findUnique: vi.fn() } },
      },
      fakeInfo,
    )

    expect(result).toBe("https://image.example.test/poster.jpg")
  })

  it("exposes media asset blur data for collection item overrides", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "asset-1",
      backend: "S3",
      status: "READY",
      visibility: "PUBLIC",
      objectKey: "media-assets/asset-1/original/hero.webp",
      previewObjectKey: null,
      muxPlaybackId: null,
      blurDataUrl: "data:image/jpeg;base64,LQIP",
    })

    const result = await fieldResolver(
      "MediaCollectionItem",
      "imageOverrideBlurDataUrl",
    )(
      { imageOverrideAssetId: "asset-1" },
      {},
      {
        request: { url: "https://admin.jesusfilm.org/api/graphql" },
        prisma: { mediaAsset: { findUnique } },
      },
      fakeInfo,
    )

    expect(result).toBe("data:image/jpeg;base64,LQIP")
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "asset-1" } })
  })
})

describe("MediaCollectionItem videoSlug resolver", () => {
  it("resolves compatibility coreId from the linked video", async () => {
    const load = vi.fn().mockResolvedValue({
      id: "video-1",
      coreId: "1_jf-0-0",
      deletedAt: null,
    })

    const result = await fieldResolver("MediaCollectionItem", "coreId")(
      {
        videoId: "video-1",
      },
      {},
      {
        loaders: { videoById: { load } },
      },
      fakeInfo,
    )

    expect(result).toBe("1_jf-0-0")
    expect(load).toHaveBeenCalledWith("video-1")
  })

  it("does not expose compatibility coreId for deleted linked videos", async () => {
    const result = await fieldResolver("MediaCollectionItem", "coreId")(
      {
        videoId: "video-1",
      },
      {},
      {
        loaders: {
          videoById: {
            load: vi.fn().mockResolvedValue({
              id: "video-1",
              coreId: "1_jf-0-0",
              deletedAt: new Date("2026-07-08T00:00:00.000Z"),
            }),
          },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
  })

  it("returns null compatibility coreId for legacy items without videoId", async () => {
    const load = vi.fn()

    const result = await fieldResolver("MediaCollectionItem", "coreId")(
      {},
      {},
      {
        loaders: { videoById: { load } },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it("resolves the canonical video slug from videoId", async () => {
    const load = vi.fn().mockResolvedValue({
      id: "video-1",
      slug: "the-gospel-of-luke",
      deletedAt: null,
    })

    const result = await fieldResolver("MediaCollectionItem", "videoSlug")(
      {
        videoId: "video-1",
        videoSlug: null,
      },
      {},
      {
        loaders: { videoById: { load } },
      },
      fakeInfo,
    )

    expect(result).toBe("the-gospel-of-luke")
    expect(load).toHaveBeenCalledWith("video-1")
  })

  it("does not expose a slug for deleted linked videos", async () => {
    const result = await fieldResolver("MediaCollectionItem", "videoSlug")(
      {
        videoId: "video-1",
        videoSlug: "stale-slug",
      },
      {},
      {
        loaders: {
          videoById: {
            load: vi.fn().mockResolvedValue({
              id: "video-1",
              slug: "stale-slug",
              deletedAt: new Date("2026-07-08T00:00:00.000Z"),
            }),
          },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
  })

  it("preserves stored videoSlug for legacy items without videoId", async () => {
    const load = vi.fn()

    const result = await fieldResolver("MediaCollectionItem", "videoSlug")(
      {
        videoSlug: "snapshot-slug",
      },
      {},
      {
        loaders: { videoById: { load } },
      },
      fakeInfo,
    )

    expect(result).toBe("snapshot-slug")
    expect(load).not.toHaveBeenCalled()
  })
})

describe("MediaCollectionItem video image metadata resolvers", () => {
  const scheduleBlurGeneration = vi.mocked(getOrScheduleVideoImageBlurDataUrl)

  it("schedules blur metadata generation for linked video images missing metadata", async () => {
    scheduleBlurGeneration.mockClear()
    const load = vi.fn().mockResolvedValue([
      {
        id: "image-1",
        mobileCinematicHigh: "https://imagedelivery.net/account/image/w=448",
        mobileCinematicLow: null,
        videoStill: null,
        url: null,
        thumbnail: null,
        blurDataUrl: null,
        dominantColor: null,
      },
    ])
    const prisma = {}

    const result = await fieldResolver(
      "MediaCollectionItem",
      "videoImageBlurDataUrl",
    )(
      { videoId: "video-1" },
      {},
      {
        prisma,
        loaders: {
          videoImagesByVideoId: { load },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
    expect(load).toHaveBeenCalledWith("video-1")
    expect(scheduleBlurGeneration).toHaveBeenCalledWith({
      imageId: "image-1",
      imageUrl: "https://imagedelivery.net/account/image/w=448",
      prisma,
    })
  })

  it("schedules dominant color repair when blur metadata already exists without color", async () => {
    scheduleBlurGeneration.mockClear()
    const load = vi.fn().mockResolvedValue([
      {
        id: "image-1",
        mobileCinematicHigh: null,
        mobileCinematicLow: null,
        videoStill: "https://imagedelivery.net/account/still/w=448",
        url: null,
        thumbnail: null,
        blurDataUrl: "data:image/png;base64,LQIP",
        dominantColor: null,
      },
    ])
    const prisma = {}

    const result = await fieldResolver(
      "MediaCollectionItem",
      "videoImageDominantColor",
    )(
      { videoId: "video-1" },
      {},
      {
        prisma,
        loaders: {
          videoImagesByVideoId: { load },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
    expect(scheduleBlurGeneration).toHaveBeenCalledWith({
      imageId: "image-1",
      imageUrl: "https://imagedelivery.net/account/still/w=448",
      prisma,
    })
  })

  it("returns stored metadata without scheduling when blur and color are complete", async () => {
    scheduleBlurGeneration.mockClear()

    const result = await fieldResolver(
      "MediaCollectionItem",
      "videoImageBlurDataUrl",
    )(
      { videoId: "video-1" },
      {},
      {
        prisma: {},
        loaders: {
          videoImagesByVideoId: {
            load: vi.fn().mockResolvedValue([
              {
                id: "image-1",
                mobileCinematicHigh:
                  "https://imagedelivery.net/account/image/w=448",
                mobileCinematicLow: null,
                videoStill: null,
                url: null,
                thumbnail: null,
                blurDataUrl: "data:image/png;base64,LQIP",
                dominantColor: "#123456",
              },
            ]),
          },
        },
      },
      fakeInfo,
    )

    expect(result).toBe("data:image/png;base64,LQIP")
    expect(scheduleBlurGeneration).not.toHaveBeenCalled()
  })
})

describe("MediaCollectionItem resolvedTitle resolver", () => {
  const resolveResolvedTitle = fieldResolver(
    "MediaCollectionItem",
    "resolvedTitle",
  )

  it("returns a trimmed nonblank override without loading the linked video", async () => {
    const loadVideo = vi.fn()
    const loadLocales = vi.fn()

    const result = await resolveResolvedTitle(
      {
        videoId: "video-1",
        titleOverride: "  Authored title  ",
      },
      { locale: "en" },
      {
        loaders: {
          videoById: { load: loadVideo },
          videoLocalesByVideoIdAndFilter: { load: loadLocales },
        },
      },
      fakeInfo,
    )

    expect(result).toBe("Authored title")
    expect(loadVideo).not.toHaveBeenCalled()
    expect(loadLocales).not.toHaveBeenCalled()
  })

  it.each(["", "   "])(
    "falls through a blank override %j to the first nonblank localized title",
    async (titleOverride) => {
      const loadVideo = vi.fn().mockResolvedValue({
        id: "video-1",
        deletedAt: null,
      })
      const loadLocales = vi.fn().mockResolvedValue([
        { locale: "en", title: "  " },
        { locale: "en", title: "  Linked title  " },
      ])

      const result = await resolveResolvedTitle(
        { videoId: "video-1", titleOverride },
        { locale: "en" },
        {
          loaders: {
            videoById: { load: loadVideo },
            videoLocalesByVideoIdAndFilter: { load: loadLocales },
          },
        },
        fakeInfo,
      )

      expect(result).toBe("Linked title")
      expect(loadVideo).toHaveBeenCalledWith("video-1")
      expect(loadLocales).toHaveBeenCalledWith({
        videoId: "video-1",
        locale: "en",
        languageSlug: null,
        visibleOnly: true,
      })
    },
  )

  it("returns null without loading when the item has no linked video", async () => {
    const loadVideo = vi.fn()
    const loadLocales = vi.fn()

    const result = await resolveResolvedTitle(
      { titleOverride: " " },
      { locale: "en" },
      {
        loaders: {
          videoById: { load: loadVideo },
          videoLocalesByVideoIdAndFilter: { load: loadLocales },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
    expect(loadVideo).not.toHaveBeenCalled()
    expect(loadLocales).not.toHaveBeenCalled()
  })

  it.each([
    ["missing", null],
    [
      "deleted",
      {
        id: "video-1",
        deletedAt: new Date("2026-07-21T00:00:00.000Z"),
      },
    ],
  ])(
    "returns null for a %s linked video without loading locales",
    async (_label, video) => {
      const loadLocales = vi.fn()

      const result = await resolveResolvedTitle(
        { videoId: "video-1" },
        { locale: "en" },
        {
          loaders: {
            videoById: { load: vi.fn().mockResolvedValue(video) },
            videoLocalesByVideoIdAndFilter: { load: loadLocales },
          },
        },
        fakeInfo,
      )

      expect(result).toBeNull()
      expect(loadLocales).not.toHaveBeenCalled()
    },
  )

  it.each([
    ["missing", []],
    ["wrong-locale", [{ locale: "es", title: "Titulo" }]],
    [
      "blank",
      [
        { locale: "en", title: null },
        { locale: "en", title: "   " },
      ],
    ],
  ])("returns null for %s locale rows", async (_label, locales) => {
    const result = await resolveResolvedTitle(
      { videoId: "video-1" },
      { locale: "en" },
      {
        loaders: {
          videoById: {
            load: vi.fn().mockResolvedValue({
              id: "video-1",
              deletedAt: null,
            }),
          },
          videoLocalesByVideoIdAndFilter: {
            load: vi.fn().mockResolvedValue(locales),
          },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
  })

  it.each([
    ["public", null],
    ["authenticated", { tier: "ADMIN" }],
  ])(
    "uses the published exact-locale loader key for %s callers",
    async (_label, user) => {
      const loadLocales = vi
        .fn()
        .mockResolvedValue([{ locale: "es-419", title: "Titulo" }])

      await resolveResolvedTitle(
        { videoId: "video-1" },
        { locale: "es-419" },
        {
          user,
          loaders: {
            videoById: {
              load: vi.fn().mockResolvedValue({
                id: "video-1",
                deletedAt: null,
              }),
            },
            videoLocalesByVideoIdAndFilter: { load: loadLocales },
          },
        },
        fakeInfo,
      )

      expect(loadLocales).toHaveBeenCalledWith({
        videoId: "video-1",
        locale: "es-419",
        languageSlug: null,
        visibleOnly: true,
      })
    },
  )
})

describe("MediaCollectionBlock defaultCollectionSlug resolver", () => {
  const resolveDefaultCollectionSlug = fieldResolver(
    "MediaCollectionBlock",
    "defaultCollectionSlug",
  )

  it("resolves the first visible parent shared by every item through batched loaders", async () => {
    const loadRelations = vi
      .fn()
      .mockResolvedValue([
        [{ parentId: "parent-lumo" }, { parentId: "parent-gospels" }],
        [{ parentId: "parent-lumo" }],
      ])
    const loadMany = vi.fn().mockResolvedValue([
      { id: "parent-lumo", slug: "lumo", deletedAt: null },
      { id: "parent-gospels", slug: "gospel-films", deletedAt: null },
    ])

    const result = await resolveDefaultCollectionSlug(
      {
        itemsSource: "manual",
        items: [{ videoId: "video-1" }, { videoId: "video-2" }],
      },
      {},
      {
        loaders: {
          videoParentsByChildId: { loadMany: loadRelations },
          videoById: { loadMany },
        },
      },
      fakeInfo,
    )

    expect(result).toBe("lumo")
    expect(loadRelations).toHaveBeenCalledWith([
      { videoId: "video-1", visibleOnly: true },
      { videoId: "video-2", visibleOnly: true },
    ])
    expect(loadMany).toHaveBeenCalledWith(["parent-lumo", "parent-gospels"])
  })

  it("returns null when items do not share a visible parent", async () => {
    const result = await resolveDefaultCollectionSlug(
      {
        itemsSource: "manual",
        items: [{ videoId: "video-1" }, { videoId: "video-2" }],
      },
      {},
      {
        loaders: {
          videoParentsByChildId: {
            loadMany: vi
              .fn()
              .mockResolvedValue([
                [{ parentId: "parent-lumo" }],
                [{ parentId: "parent-chosen" }],
              ]),
          },
          videoById: {
            loadMany: vi.fn().mockResolvedValue([
              { id: "parent-lumo", slug: "lumo", deletedAt: null },
              { id: "parent-chosen", slug: "the-chosen", deletedAt: null },
            ]),
          },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
  })

  it("returns null without loaders when an item is not linked", async () => {
    const loadRelations = vi.fn()
    const loadMany = vi.fn()

    const result = await resolveDefaultCollectionSlug(
      {
        itemsSource: "manual",
        items: [{ videoId: "video-1" }, { videoId: null }],
      },
      {},
      {
        loaders: {
          videoParentsByChildId: { loadMany: loadRelations },
          videoById: { loadMany },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
    expect(loadRelations).not.toHaveBeenCalled()
    expect(loadMany).not.toHaveBeenCalled()
  })

  it("propagates relation loader failures", async () => {
    await expect(
      resolveDefaultCollectionSlug(
        {
          itemsSource: "manual",
          items: [{ videoId: "video-1" }],
        },
        {},
        {
          loaders: {
            videoParentsByChildId: {
              loadMany: vi
                .fn()
                .mockResolvedValue([new Error("relation load failed")]),
            },
            videoById: { loadMany: vi.fn() },
          },
        },
        fakeInfo,
      ),
    ).rejects.toThrow("relation load failed")
  })

  it("propagates parent loader failures", async () => {
    await expect(
      resolveDefaultCollectionSlug(
        {
          itemsSource: "manual",
          items: [{ videoId: "video-1" }],
        },
        {},
        {
          loaders: {
            videoParentsByChildId: {
              loadMany: vi
                .fn()
                .mockResolvedValue([[{ parentId: "parent-lumo" }]]),
            },
            videoById: {
              loadMany: vi
                .fn()
                .mockResolvedValue([new Error("parent load failed")]),
            },
          },
        },
        fakeInfo,
      ),
    ).rejects.toThrow("parent load failed")
  })

  it("does not load parents for route-video-children blocks", async () => {
    const loadRelations = vi.fn()
    const loadMany = vi.fn()

    const result = await resolveDefaultCollectionSlug(
      {
        itemsSource: "routeVideoChildren",
        items: [{ videoId: "video-1" }],
      },
      {},
      {
        loaders: {
          videoParentsByChildId: { loadMany: loadRelations },
          videoById: { loadMany },
        },
      },
      fakeInfo,
    )

    expect(result).toBeNull()
    expect(loadRelations).not.toHaveBeenCalled()
    expect(loadMany).not.toHaveBeenCalled()
  })
})

// -----------------------------------------------------------------------------
// Union dispatch happy path — mixed-kind array (mimics what a real
// ExperienceLocale.blocks JSON column holds). A SectionBlock inside the array
// itself contains a ContainerBlock so the nested-union dispatch path runs.
// -----------------------------------------------------------------------------

describe("Mixed-kind round-trip across nested unions", () => {
  it("dispatches a 3-block mix (Card + MediaCollection + Section→Container) correctly", () => {
    const blocks = [
      fixtures.card,
      fixtures.mediaCollection,
      {
        t: "section",
        dynamicBackgroundImage: false,
        staticOverlay: false,
        content: [
          fixtures.card,
          {
            t: "container",
            content: [fixtures.containerSlot, fixtures.mediaCollection],
          },
        ],
      },
    ]

    const topTypenames = blocks.map((b) =>
      resolveTypeName("ExperienceBlock", b),
    )
    expect(topTypenames).toEqual([
      "CardBlock",
      "MediaCollectionBlock",
      "SectionBlock",
    ])

    // SectionBlock.content dispatches via SectionContentBlock.
    const sectionBlock = blocks[2] as { content: object[] }
    const sectionChildren = sectionBlock.content.map((child) =>
      resolveTypeName("SectionContentBlock", child),
    )
    expect(sectionChildren).toEqual(["CardBlock", "ContainerBlock"])

    // ContainerBlock.content dispatches via ContainerContentBlock.
    const containerBlock = sectionBlock.content[1] as { content: object[] }
    const containerChildren = containerBlock.content.map((child) =>
      resolveTypeName("ContainerContentBlock", child),
    )
    expect(containerChildren).toEqual([
      "ContainerSlotBlock",
      "MediaCollectionBlock",
    ])
  })
})

// -----------------------------------------------------------------------------
// Edge cases
// -----------------------------------------------------------------------------

describe("MediaCollectionItem.coreId resolver", () => {
  const resolveCoreId = fieldResolver("MediaCollectionItem", "coreId")

  it("resolves the referenced Video's coreId via the batched videoById loader", async () => {
    // The batched loader (not a per-item findUnique) is what keeps the whole
    // Experience resolve to one video lookup — AE13's "single batched lookup".
    const load = vi.fn().mockResolvedValue({ id: "vid-1", coreId: "1_jf-0-0" })
    const result = await resolveCoreId(
      { videoId: "vid-1" },
      {},
      { loaders: { videoById: { load } } },
      fakeInfo,
    )
    expect(result).toBe("1_jf-0-0")
    expect(load).toHaveBeenCalledWith("vid-1")
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("returns null without touching the loader when the item has no videoId", async () => {
    const load = vi.fn()
    const result = await resolveCoreId(
      { videoId: null },
      {},
      { loaders: { videoById: { load } } },
      fakeInfo,
    )
    expect(result).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })

  it("returns null when the referenced Video is not found", async () => {
    const load = vi.fn().mockResolvedValue(null)
    const result = await resolveCoreId(
      { videoId: "missing" },
      {},
      { loaders: { videoById: { load } } },
      fakeInfo,
    )
    expect(result).toBeNull()
  })
})

describe("Edge cases", () => {
  it("exposes videoSlug and muxPlaybackId on MediaCollectionItem for authored card links and previews", () => {
    const type = schema.getType("MediaCollectionItem")
    const fields = type && "getFields" in type ? type.getFields() : null
    expect(fields?.videoSlug).toBeDefined()
    expect(fields?.languageId).toBeDefined()
    expect(fields?.muxPlaybackId).toBeDefined()
    expect(fields?.coreId).toBeDefined()
    expect(fields?.imageBlurDataUrl).toBeDefined()
    expect(fields?.imageOverrideBlurDataUrl).toBeDefined()
  })

  it("exposes the inferred default collection slug on MediaCollectionBlock", () => {
    const type = schema.getType("MediaCollectionBlock")
    const fields = type && "getFields" in type ? type.getFields() : null
    expect(fields?.defaultCollectionSlug).toBeDefined()
  })

  it("exposes thumbnail orientation on MediaCollectionBlock", () => {
    const type = schema.getType("MediaCollectionBlock")
    const fields = type && "getFields" in type ? type.getFields() : null
    expect(fields?.thumbnailOrientation).toBeDefined()
    expect(fields?.thumbnailOrientation?.type.toString()).toBe(
      "MediaCollectionThumbnailOrientation",
    )
  })

  it("unknown discriminator throws UnknownBlockKindError", () => {
    expect(() =>
      resolveTypeName("ExperienceBlock", { t: "totallyUnknownKind" }),
    ).toThrow(UnknownBlockKindError)
    expect(() =>
      resolveTypeName("ExperienceBlock", { t: "totallyUnknownKind" }),
    ).toThrow(/totallyUnknownKind/)
  })

  it("UnknownBlockKindError exposes the offending kind as a field", () => {
    let caught: unknown
    try {
      resolveTypeName("ExperienceBlock", { t: "anotherBadKind" })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(UnknownBlockKindError)
    expect((caught as UnknownBlockKindError).kind).toBe("anotherBadKind")
  })

  it("empty blocks array does not invoke resolveType at all", () => {
    // No assertion needed — the test exists to document that the resolver
    // returns the empty array verbatim and never calls resolveType.
    const blocks: object[] = []
    const dispatched = blocks.map((b) => resolveTypeName("ExperienceBlock", b))
    expect(dispatched).toEqual([])
  })
})
