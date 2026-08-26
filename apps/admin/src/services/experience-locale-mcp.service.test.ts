import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Principal } from "@/auth/principal"
import { BlocksSchema } from "@/domain/blocks"
import { StorefrontStageAttributionMismatchError } from "@/services/errors"
import { ExperienceLocaleMcpService } from "./experience-locale-mcp.service"
import { VideoService } from "./video.service"

const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    WATCH_CANONICAL_ORIGIN: "https://watch.staging.example",
  },
}))

vi.mock("@/config/env", () => ({ env: mockEnv }))
vi.mock("@/services/revalidate-webhook", () => ({
  emitRevalidateWebhook: vi.fn(),
}))
vi.mock("@/services/watch-route-manifest-refresh.service", () => ({
  refreshWatchRouteManifest: vi.fn().mockResolvedValue({ ok: true }),
}))

function mockPrisma() {
  const experienceLocaleCreate = vi.fn()
  const experienceLocaleFindUniqueOrThrow = vi.fn()
  const experienceLocaleCount = vi.fn().mockResolvedValue(1)
  const contentRevisionFindFirst = vi.fn().mockResolvedValue(null)
  const contentRevisionUpdate = vi.fn()
  const contentRevisionCreate = vi.fn().mockResolvedValue({
    id: "draft-1",
    previewToken: "preview-token",
    revisedAt: updatedAt,
    revisedBy: "admin-1",
    revisedByKind: "USER",
    reason: "draft saved",
  })
  return {
    $transaction: vi.fn((callback) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([]),
        contentRevision: {
          findFirst: contentRevisionFindFirst,
          create: contentRevisionCreate,
          update: contentRevisionUpdate,
        },
        seoProposalMaterialization: { updateMany: vi.fn() },
        experience: { update: vi.fn() },
        experienceLocale: {
          create: experienceLocaleCreate,
          count: experienceLocaleCount,
          findUniqueOrThrow: experienceLocaleFindUniqueOrThrow,
          update: vi.fn(),
        },
      }),
    ),
    experience: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    experienceLocale: {
      count: experienceLocaleCount,
      create: experienceLocaleCreate,
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: experienceLocaleFindUniqueOrThrow,
    },
    contentRevision: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: contentRevisionFindFirst,
      create: contentRevisionCreate,
      update: contentRevisionUpdate,
    },
    language: {
      findFirst: vi.fn(),
    },
    video: {
      findMany: vi.fn(),
    },
    videoDub: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    videoSubtitle: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    biblePassageCache: {
      findMany: vi.fn(),
    },
    bibleCitation: {
      findMany: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const ADMIN: Principal = { id: "admin-1", role: "ADMIN" }
const VIEWER: Principal = { id: "viewer-1", role: "VIEWER" }
const PUBLIC_USER: Principal | null = null

const updatedAt = new Date("2026-07-21T12:00:00.000Z")

const LOCALE_ROW = {
  id: "loc-es",
  experienceId: "exp-1",
  locale: "es",
  slug: "esperanza",
  isHomepage: false,
  pathSegment: null,
  title: "Esperanza",
  metaDescription: null,
  ogTitle: null,
  ogDescription: null,
  ogImageUrl: null,
  blocks: [{ t: "text", heading: "Esperanza" }],
  status: "DRAFT",
  publishedAt: null,
  updatedAt,
}

describe("ExperienceLocaleMcpService", () => {
  let prisma: ReturnType<typeof mockPrisma>
  let service: ExperienceLocaleMcpService

  beforeEach(() => {
    prisma = mockPrisma()
    service = new ExperienceLocaleMcpService(prisma)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("lists compact Experience rows with locale summaries", async () => {
    prisma.experience.findMany.mockResolvedValueOnce([
      {
        id: "exp-1",
        isTemplate: false,
        ownerId: "admin-1",
        updatedAt,
        locales: [
          {
            id: "loc-en",
            locale: "en",
            slug: "hope",
            title: "Hope",
            status: "PUBLISHED",
            updatedAt,
          },
        ],
      },
    ])

    await expect(
      service.listExperiences({
        input: { q: "hope", limit: 10 },
        user: VIEWER,
      }),
    ).resolves.toEqual({
      experiences: [
        {
          id: "exp-1",
          isTemplate: false,
          ownerId: "admin-1",
          updatedAt: updatedAt.toISOString(),
          locales: [
            {
              id: "loc-en",
              locale: "en",
              slug: "hope",
              title: "Hope",
              status: "PUBLISHED",
              updatedAt: updatedAt.toISOString(),
              hasDraft: false,
              activeDraft: null,
            },
          ],
        },
      ],
    })

    expect(prisma.experience.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
          locales: expect.objectContaining({ some: expect.any(Object) }),
        }),
        take: 10,
      }),
    )
  })

  it("rejects public Experience reads", async () => {
    await expect(
      service.listExperiences({ input: {}, user: PUBLIC_USER }),
    ).rejects.toThrow("Forbidden")
  })

  it("reads a locale with blocks and parent Experience context", async () => {
    const row = {
      id: "loc-en",
      experienceId: "exp-1",
      locale: "en",
      slug: "hope",
      isHomepage: false,
      pathSegment: null,
      title: "Hope",
      metaDescription: "Meta",
      ogTitle: null,
      ogDescription: null,
      ogImageUrl: null,
      blocks: [{ t: "text", heading: "Hope" }],
      status: "DRAFT",
      publishedAt: null,
      updatedAt,
      experience: {
        id: "exp-1",
        isTemplate: false,
        ownerId: "admin-1",
      },
    }
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(row)
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(row)

    await expect(
      service.readLocale({
        input: { experienceId: "exp-1", locale: "en" },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      experience: { id: "exp-1" },
      locale: {
        id: "loc-en",
        blocks: [{ t: "text", heading: "Hope" }],
        updatedAt: updatedAt.toISOString(),
      },
    })
  })

  it("reads the active draft as effective state while preserving canonical", async () => {
    const canonical = {
      ...LOCALE_ROW,
      locale: "en",
      slug: "hope",
      title: "Live Hope",
      status: "PUBLISHED",
      experience: {
        id: "exp-1",
        isTemplate: false,
        ownerId: "admin-1",
        archivedAt: null,
      },
    }
    prisma.experienceLocale.findFirst.mockResolvedValueOnce(canonical)
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(canonical)
    prisma.contentRevision.findFirst.mockResolvedValueOnce({
      id: "draft-en",
      snapshot: {
        v: 1,
        data: {
          slug: "hope-new",
          isHomepage: false,
          pathSegment: null,
          title: "Draft Hope",
          metaDescription: null,
          ogTitle: null,
          ogDescription: null,
          ogImageUrl: null,
          blocks: LOCALE_ROW.blocks,
        },
      },
      previewToken: "preview-token",
      revisedAt: updatedAt,
      revisedBy: "admin-1",
      revisedByKind: "USER",
      reason: "draft saved",
    })

    await expect(
      service.readLocale({
        input: { experienceId: "exp-1", locale: "en" },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      canonical: { slug: "hope", title: "Live Hope" },
      effective: { slug: "hope-new", title: "Draft Hope" },
      locale: { slug: "hope-new", title: "Draft Hope" },
      hasDraft: true,
      activeDraft: {
        id: "draft-en",
        previewUrl:
          "https://watch.staging.example/watch/preview/experience/preview-token",
      },
    })
  })

  it("finds Experiences missing requested target locales", async () => {
    prisma.experience.findMany.mockResolvedValueOnce([
      {
        id: "exp-1",
        isTemplate: false,
        ownerId: "admin-1",
        locales: [
          {
            id: "loc-en",
            locale: "en",
            slug: "hope",
            title: "Hope",
            status: "PUBLISHED",
          },
          {
            id: "loc-es",
            locale: "es",
            slug: "esperanza",
            title: "Esperanza",
            status: "DRAFT",
          },
        ],
      },
      {
        id: "exp-2",
        isTemplate: false,
        ownerId: "admin-1",
        locales: [
          {
            id: "loc-en-2",
            locale: "en",
            slug: "faith",
            title: "Faith",
            status: "PUBLISHED",
          },
        ],
      },
    ])

    await expect(
      service.findMissingLocales({
        input: { sourceLocale: "en", targetLocales: ["es", "fr", "es"] },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      targetLocales: ["es", "fr"],
      experiences: [
        {
          id: "exp-1",
          missingLocales: ["fr"],
          existingTargetLocales: [expect.objectContaining({ locale: "es" })],
        },
        {
          id: "exp-2",
          missingLocales: ["es", "fr"],
        },
      ],
    })
  })

  it("returns bounded homepage, inventory, and recent translation evidence for storefront curation", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-21T12:00:00.000Z"))
    const inventorySpy = vi
      .spyOn(VideoService.prototype, "getWatchLanguageInventory")
      .mockResolvedValueOnce({
        language: { slug: "english", name: { en: "English" }, bcp47: "en" },
        counts: {
          audioCollections: 1,
          audioVideos: 1,
          subtitleOnlyVideos: 0,
          total: 2,
        },
        promoted: [],
        audioCollections: [],
        audioVideos: [],
        subtitleOnlyVideos: [],
      })
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-home-en",
      locale: "en",
      slug: "home",
      title: "Watch",
      isHomepage: true,
      status: "PUBLISHED",
      experience: {
        id: "exp-home",
        isTemplate: false,
        ownerId: "admin-1",
        archivedAt: null,
      },
    }
    prisma.experienceLocale.findMany.mockResolvedValueOnce([
      { id: canonical.id, experienceId: canonical.experienceId },
    ])
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(canonical)
    prisma.language.findFirst.mockResolvedValueOnce({
      id: "language-en",
      bcp47: "en",
      iso3: "eng",
      slug: "english",
      name: { en: "English" },
    })
    prisma.videoDub.findMany.mockResolvedValueOnce([
      {
        updatedAt: new Date("2026-08-20T10:00:00.000Z"),
        aiGenerated: false,
        language: {
          id: "language-es",
          bcp47: "es",
          slug: "spanish",
          name: { en: "Spanish" },
        },
        video: {
          id: "video-1",
          coreId: "core-video-1",
          slug: "jesus-film",
          label: "FEATURE_FILM",
          locales: [{ locale: "en", title: "JESUS" }],
        },
      },
    ])
    prisma.videoSubtitle.findMany.mockResolvedValueOnce([
      {
        updatedAt: new Date("2026-08-20T11:00:00.000Z"),
        aiGenerated: true,
        language: {
          id: "language-es",
          bcp47: "es",
          slug: "spanish",
          name: { en: "Spanish" },
        },
        video: {
          id: "video-1",
          coreId: "core-video-1",
          slug: "jesus-film",
          label: "FEATURE_FILM",
          locales: [{ locale: "en", title: "JESUS" }],
        },
      },
    ])

    await expect(
      service.getStorefrontHomepageContext({
        input: { locale: "en", recentLimit: 5 },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      locale: "en",
      generatedAt: "2026-08-21T12:00:00.000Z",
      homepageMatchCount: 1,
      homepage: {
        experienceId: "exp-1",
        hasDraft: false,
        canonicalDigest: createHash("sha256")
          .update(JSON.stringify(canonical.blocks))
          .digest("hex"),
        canonical: { id: "loc-home-en", isHomepage: true },
      },
      targetLanguage: { id: "language-en", slug: "english", bcp47: "en" },
      inventory: { counts: { total: 2 } },
      recentTranslations: [
        {
          videoId: "video-1",
          title: "JESUS",
          language: { id: "language-es", slug: "spanish" },
          availability: ["audio", "subtitles"],
          aiGenerated: true,
          updatedAt: "2026-08-20T11:00:00.000Z",
        },
      ],
    })
    expect(inventorySpy).toHaveBeenCalledWith({
      languageSlug: "english",
      limit: 5,
    })
    expect(prisma.videoDub.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 15 }),
    )
  })

  it("reads storefront draft attribution without minting or exposing preview access", async () => {
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-home-en",
      locale: "en",
      slug: "home",
      title: "Watch",
      isHomepage: true,
      status: "PUBLISHED",
      experience: {
        id: "exp-home",
        isTemplate: false,
        ownerId: "admin-1",
        archivedAt: null,
      },
    }
    const draft = {
      id: "draft-home-en",
      snapshot: {
        v: 1,
        data: {
          ...LOCALE_ROW,
          title: "Secret effective draft title",
          blocks: [{ t: "text", heading: "Secret draft body" }],
        },
      },
      previewToken: null,
      revisedAt: updatedAt,
      revisedBy: "admin-1",
      revisedByKind: "AI",
      reason: "storefront operation attribution",
    }
    prisma.experienceLocale.findMany.mockResolvedValueOnce([
      { id: canonical.id, experienceId: canonical.experienceId },
    ])
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(canonical)
    prisma.contentRevision.findFirst.mockResolvedValueOnce(draft)
    prisma.language.findFirst.mockResolvedValueOnce(null)

    const result = await service.getStorefrontHomepageContext({
      input: { locale: "en" },
      user: ADMIN,
    })

    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(prisma.contentRevision.update).not.toHaveBeenCalled()
    expect(prisma.contentRevision.findFirst).toHaveBeenCalledWith({
      where: {
        entityType: "ExperienceLocale",
        entityId: "loc-home-en",
        status: "DRAFT",
      },
      orderBy: { revisedAt: "desc" },
      select: {
        id: true,
        revisedAt: true,
        revisedBy: true,
        revisedByKind: true,
        reason: true,
      },
    })
    expect(result.homepage).toEqual({
      experienceId: "exp-1",
      canonical: expect.objectContaining({
        id: "loc-home-en",
        title: "Watch",
      }),
      canonicalDigest: createHash("sha256")
        .update(JSON.stringify(canonical.blocks))
        .digest("hex"),
      hasDraft: true,
      activeDraft: {
        id: "draft-home-en",
        revisedAt: updatedAt.toISOString(),
        revisedBy: "admin-1",
        revisedByKind: "AI",
        reason: "storefront operation attribution",
        operationId: null,
        candidateDigest: null,
      },
    })
    expect(JSON.stringify(result.homepage)).not.toContain("preview")
    expect(JSON.stringify(result.homepage)).not.toContain("Secret")
  })

  it("forbids unauthorized storefront context reads before querying", async () => {
    await expect(
      service.getStorefrontHomepageContext({
        input: { locale: "en" },
        user: PUBLIC_USER,
      }),
    ).rejects.toThrow("Forbidden")

    expect(prisma.experienceLocale.findMany).not.toHaveBeenCalled()
    expect(prisma.contentRevision.findFirst).not.toHaveBeenCalled()
  })

  it("validates create drafts with existing Experience schemas", () => {
    expect(
      service.validateLocaleDraft({
        input: {
          draft: {
            experienceId: "exp-1",
            locale: "es",
            slug: "esperanza",
            title: "Esperanza",
            blocks: [{ t: "text", heading: "Esperanza" }],
          },
        },
      }),
    ).toMatchObject({ valid: true, issues: [] })
  })

  it("atomically stages storefront blocks when canonical is unchanged and no draft exists", async () => {
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-home-en",
      locale: "en",
      isHomepage: true,
      status: "PUBLISHED",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      experience: {
        ownerId: "admin-1",
        archivedAt: null,
        isTemplate: false,
      },
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)
    const operationId = "c6d38f67-8e52-477d-9c97-d50ac32d25a8"
    const candidateDigest = createHash("sha256")
      .update(JSON.stringify([]))
      .digest("hex")
    prisma.contentRevision.create.mockResolvedValueOnce({
      id: "draft-1",
      previewToken: "preview-token",
      revisedAt: updatedAt,
      revisedBy: "admin-1",
      revisedByKind: "AI",
      reason: `storefront-curator:${operationId}:${candidateDigest}`,
    })

    await expect(
      service.stageStorefrontHomepage({
        input: {
          localeId: canonical.id,
          expectedCanonicalUpdatedAt: updatedAt.toISOString(),
          blocks: [],
          operationId,
          candidateDigest,
        },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      locale: { id: "loc-home-en", blocks: [] },
      draftAttribution: { operationId, candidateDigest },
      previewUrl:
        "https://watch.staging.example/watch/preview/experience/preview-token",
    })
    expect(prisma.contentRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          revisedByKind: "AI",
          reason: `storefront-curator:${operationId}:${candidateDigest}`,
        }),
      }),
    )
  })

  it("canonicalizes UUID attribution and RFC3339 offset timestamps", async () => {
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-home-en",
      locale: "en",
      isHomepage: true,
      status: "PUBLISHED",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      experience: {
        ownerId: "admin-1",
        archivedAt: null,
        isTemplate: false,
      },
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)
    const operationId = "C6D38F67-8E52-477D-9C97-D50AC32D25A8"
    const canonicalOperationId = operationId.toLowerCase()
    const candidateDigest = createHash("sha256")
      .update(JSON.stringify([]))
      .digest("hex")
    prisma.contentRevision.create.mockResolvedValueOnce({
      id: "draft-1",
      previewToken: "preview-token",
      revisedAt: updatedAt,
      revisedBy: "admin-1",
      revisedByKind: "AI",
      reason: `storefront-curator:${canonicalOperationId}:${candidateDigest}`,
    })

    await expect(
      service.stageStorefrontHomepage({
        input: {
          localeId: canonical.id,
          expectedCanonicalUpdatedAt: "2026-07-21T08:00:00-04:00",
          blocks: [],
          operationId,
          candidateDigest,
        },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      draftAttribution: { operationId: canonicalOperationId, candidateDigest },
    })
    expect(prisma.contentRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: `storefront-curator:${canonicalOperationId}:${candidateDigest}`,
        }),
      }),
    )
  })

  it("stages the exact attributed blocks without editor backfill", async () => {
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-home-en",
      locale: "en",
      isHomepage: true,
      status: "PUBLISHED",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      experience: {
        ownerId: "admin-1",
        archivedAt: null,
        isTemplate: false,
      },
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)
    const blocks = [
      {
        t: "video",
        sectionKey: "human-video",
        videoId: "human-video-1",
        streamingUrl: "https://human.example/video.m3u8",
      },
      {
        t: "mediaCollection",
        sectionKey: "storefront-curator-new_releases",
        variant: "carousel",
        itemsSource: "manual",
        thumbnailOrientation: "horizontal",
        showItemNumbers: false,
        title: "New releases",
        items: [{ videoId: "curated-video-1" }],
      },
    ]
    const normalizedBlocks = BlocksSchema.parse(blocks)
    const operationId = "c6d38f67-8e52-477d-9c97-d50ac32d25a8"
    const candidateDigest = createHash("sha256")
      .update(JSON.stringify(normalizedBlocks))
      .digest("hex")
    prisma.contentRevision.create.mockResolvedValueOnce({
      id: "draft-1",
      previewToken: "preview-token",
      revisedAt: updatedAt,
      revisedBy: "admin-1",
      revisedByKind: "AI",
      reason: `storefront-curator:${operationId}:${candidateDigest}`,
    })

    await service.stageStorefrontHomepage({
      input: {
        localeId: canonical.id,
        expectedCanonicalUpdatedAt: updatedAt.toISOString(),
        blocks,
        operationId,
        candidateDigest,
      },
      user: ADMIN,
    })

    expect(prisma.language.findFirst).not.toHaveBeenCalled()
    expect(prisma.videoDub.findMany).not.toHaveBeenCalled()
    expect(prisma.contentRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          snapshot: expect.objectContaining({
            data: expect.objectContaining({ blocks: normalizedBlocks }),
          }),
          reason: `storefront-curator:${operationId}:${candidateDigest}`,
        }),
      }),
    )
  })

  it("rejects a storefront candidate digest that does not match normalized blocks", async () => {
    await expect(
      service.stageStorefrontHomepage({
        input: {
          localeId: "loc-home-en",
          expectedCanonicalUpdatedAt: updatedAt.toISOString(),
          blocks: [],
          operationId: "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
          candidateDigest: "0".repeat(64),
        },
        user: ADMIN,
      }),
    ).rejects.toThrow("candidate digest")
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each([
    ["non-homepage", false, "PUBLISHED", null],
    ["unpublished", true, "DRAFT", null],
    ["archived", true, "PUBLISHED", updatedAt],
  ])(
    "rejects a %s storefront stage target",
    async (_label, isHomepage, status, archivedAt) => {
      const canonical = {
        ...LOCALE_ROW,
        id: "loc-home-en",
        locale: "en",
        isHomepage,
        status,
        createdAt: new Date("2026-07-20T12:00:00.000Z"),
        experience: {
          ownerId: "admin-1",
          archivedAt,
          isTemplate: false,
        },
      }
      prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)
      const candidateDigest = createHash("sha256")
        .update(JSON.stringify([]))
        .digest("hex")

      await expect(
        service.stageStorefrontHomepage({
          input: {
            localeId: canonical.id,
            expectedCanonicalUpdatedAt: updatedAt.toISOString(),
            blocks: [],
            operationId: "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
            candidateDigest,
          },
          user: ADMIN,
        }),
      ).rejects.toThrow(
        "Storefront staging target must be the unique published homepage",
      )
      expect(prisma.contentRevision.create).not.toHaveBeenCalled()
    },
  )

  it("rejects an ambiguous duplicate published homepage target", async () => {
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-home-en",
      locale: "en",
      isHomepage: true,
      status: "PUBLISHED",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      experience: {
        ownerId: "admin-1",
        archivedAt: null,
        isTemplate: false,
      },
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)
    prisma.experienceLocale.count.mockResolvedValueOnce(2)
    const candidateDigest = createHash("sha256")
      .update(JSON.stringify([]))
      .digest("hex")

    await expect(
      service.stageStorefrontHomepage({
        input: {
          localeId: canonical.id,
          expectedCanonicalUpdatedAt: updatedAt.toISOString(),
          blocks: [],
          operationId: "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
          candidateDigest,
        },
        user: ADMIN,
      }),
    ).rejects.toThrow(
      "Storefront staging target must be the unique published homepage",
    )
    expect(prisma.contentRevision.create).not.toHaveBeenCalled()
  })

  it("throws a typed error when committed draft attribution mismatches", async () => {
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-home-en",
      locale: "en",
      isHomepage: true,
      status: "PUBLISHED",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      experience: {
        ownerId: "admin-1",
        archivedAt: null,
        isTemplate: false,
      },
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)
    const candidateDigest = createHash("sha256")
      .update(JSON.stringify([]))
      .digest("hex")
    prisma.contentRevision.create.mockResolvedValueOnce({
      id: "draft-1",
      previewToken: "preview-token",
      revisedAt: updatedAt,
      revisedBy: "admin-1",
      revisedByKind: "AI",
      reason: `storefront-curator:11111111-1111-4111-8111-111111111111:${candidateDigest}`,
    })

    await expect(
      service.stageStorefrontHomepage({
        input: {
          localeId: canonical.id,
          expectedCanonicalUpdatedAt: updatedAt.toISOString(),
          blocks: [],
          operationId: "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
          candidateDigest,
        },
        user: ADMIN,
      }),
    ).rejects.toBeInstanceOf(StorefrontStageAttributionMismatchError)
  })

  it("refuses storefront staging when a shared draft appeared", async () => {
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-home-en",
      locale: "en",
      isHomepage: true,
      status: "PUBLISHED",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      experience: {
        ownerId: "admin-1",
        archivedAt: null,
        isTemplate: false,
      },
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)
    prisma.contentRevision.findFirst.mockResolvedValueOnce({
      id: "human-draft",
      snapshot: { v: 1, data: {} },
      previewToken: "human-preview",
      revisedAt: updatedAt,
      revisedBy: "admin-2",
      revisedByKind: "USER",
      reason: "Human edit",
    })

    await expect(
      service.stageStorefrontHomepage({
        input: {
          localeId: canonical.id,
          expectedCanonicalUpdatedAt: updatedAt.toISOString(),
          blocks: [],
          operationId: "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
          candidateDigest: createHash("sha256")
            .update(JSON.stringify([]))
            .digest("hex"),
        },
        user: ADMIN,
      }),
    ).rejects.toThrow("modified concurrently")
    expect(prisma.contentRevision.create).not.toHaveBeenCalled()
  })

  it("refuses storefront staging when canonical content changed", async () => {
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-home-en",
      locale: "en",
      isHomepage: true,
      status: "PUBLISHED",
      createdAt: new Date("2026-07-20T12:00:00.000Z"),
      experience: {
        ownerId: "admin-1",
        archivedAt: null,
        isTemplate: false,
      },
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)

    await expect(
      service.stageStorefrontHomepage({
        input: {
          localeId: canonical.id,
          expectedCanonicalUpdatedAt: "2026-07-21T11:59:59.000Z",
          blocks: [],
          operationId: "c6d38f67-8e52-477d-9c97-d50ac32d25a8",
          candidateDigest: createHash("sha256")
            .update(JSON.stringify([]))
            .digest("hex"),
        },
        user: ADMIN,
      }),
    ).rejects.toThrow("modified concurrently")
    expect(prisma.contentRevision.create).not.toHaveBeenCalled()
  })

  it("returns validation issues for bad drafts", () => {
    expect(
      service.validateLocaleDraft({
        input: {
          draft: {
            experienceId: "exp-1",
            locale: "es",
            slug: "",
            blocks: [{ t: "notReal" }],
          },
        },
      }),
    ).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "slug" }),
        expect.objectContaining({ path: expect.stringContaining("blocks") }),
      ]),
    })
  })

  it("creates locales through the existing Experience service", async () => {
    prisma.experience.findUniqueOrThrow.mockResolvedValueOnce({
      ownerId: "admin-1",
      archivedAt: null,
    })
    prisma.experienceLocale.create.mockResolvedValueOnce(LOCALE_ROW)

    await expect(
      service.createLocale({
        input: {
          experienceId: "exp-1",
          locale: "es",
          draft: {
            slug: "esperanza",
            title: "Esperanza",
            blocks: [{ t: "text", heading: "Esperanza" }],
          },
        },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      locale: {
        id: "loc-es",
        experienceId: "exp-1",
        locale: "es",
        slug: "esperanza",
      },
    })

    expect(prisma.experienceLocale.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          locale: "es",
          slug: "esperanza",
          experienceId: "exp-1",
          blocks: [],
        }),
      }),
    )
  })

  it("updates locales through the existing Experience service", async () => {
    const canonical = {
      ...LOCALE_ROW,
      id: "loc-es",
      experience: {
        ownerId: "admin-1",
        archivedAt: null,
        isTemplate: false,
      },
      createdAt: new Date("2026-07-21T11:00:00.000Z"),
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)

    await expect(
      service.updateLocale({
        input: {
          localeId: "loc-es",
          draft: { title: "Esperanza viva" },
        },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      locale: {
        id: "loc-es",
        title: "Esperanza viva",
      },
    })
  })

  it("rejects parent-scoped isTemplate in locale draft updates", async () => {
    await expect(
      service.updateLocale({
        input: { localeId: "loc-es", draft: { isTemplate: true } },
        user: ADMIN,
      }),
    ).rejects.toThrow()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it("discovers the stable preview URL for the active draft", async () => {
    const canonical = {
      ...LOCALE_ROW,
      experience: {
        ownerId: "admin-1",
        archivedAt: null,
        isTemplate: false,
      },
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(canonical)
    prisma.contentRevision.findFirst.mockResolvedValueOnce({
      id: "draft-es",
      snapshot: { v: 1, data: {} },
      previewToken: "preview-token",
      revisedAt: updatedAt,
      revisedBy: "admin-1",
      revisedByKind: "USER",
      reason: null,
    })

    await expect(
      service.previewLocale({ input: { localeId: "loc-es" }, user: ADMIN }),
    ).resolves.toEqual({
      localeId: "loc-es",
      draftRevisionId: "draft-es",
      previewUrl:
        "https://watch.staging.example/watch/preview/experience/preview-token",
    })
  })

  it("publishes locales through the existing Experience service", async () => {
    const canonical = {
      ...LOCALE_ROW,
      status: "DRAFT",
      experience: { ownerId: "admin-1", archivedAt: null },
      createdAt: new Date("2026-07-21T11:00:00.000Z"),
    }
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValue(canonical)

    const published = {
      ...LOCALE_ROW,
      status: "PUBLISHED",
      publishedAt: new Date("2026-07-21T12:30:00.000Z"),
    }
    prisma.$transaction.mockImplementationOnce(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $queryRaw: vi.fn(),
          contentRevision: {
            findFirst: vi.fn().mockResolvedValue({
              id: "draft-1",
              snapshot: {
                v: 1,
                data: {
                  slug: LOCALE_ROW.slug,
                  isHomepage: false,
                  pathSegment: null,
                  title: LOCALE_ROW.title,
                  metaDescription: null,
                  ogTitle: null,
                  ogDescription: null,
                  ogImageUrl: null,
                  blocks: LOCALE_ROW.blocks,
                },
              },
            }),
            create: vi.fn(),
            update: vi.fn(),
          },
          experienceLocale: {
            findUniqueOrThrow: vi.fn().mockResolvedValue(canonical),
            update: vi.fn().mockResolvedValueOnce(published),
          },
        }),
    )

    await expect(
      service.publishLocale({
        input: {
          localeId: "loc-es",
          reason: "bulk locale factory approved",
        },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      reason: "bulk locale factory approved",
      locale: {
        id: "loc-es",
        status: "PUBLISHED",
        publishedAt: "2026-07-21T12:30:00.000Z",
      },
    })
  })

  it("diffs a draft against a source locale", async () => {
    prisma.experienceLocale.findUniqueOrThrow.mockResolvedValueOnce(LOCALE_ROW)

    await expect(
      service.diffLocaleDraft({
        input: {
          sourceLocaleId: "loc-es",
          targetDraft: {
            title: "Nueva esperanza",
            blocks: LOCALE_ROW.blocks,
          },
        },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      source: { id: "loc-es", title: "Esperanza" },
      changes: [
        { field: "title", changed: true },
        { field: "blocks", changed: false },
      ],
    })
  })

  it("checks target-language video availability in blocks", async () => {
    prisma.language.findFirst.mockResolvedValueOnce({
      id: "lang-es",
      bcp47: "es",
      slug: "spanish",
    })
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-1",
        coreId: "core-video-1",
        slug: "hope-video",
        label: "FEATURE_FILM",
        publishedAt: new Date("2026-07-20T12:00:00.000Z"),
        locales: [
          { locale: "es", languageSlug: "spanish", title: "Esperanza" },
        ],
        dubs: [
          {
            id: "dub-es",
            hls: "https://stream.example/hls.m3u8",
            dash: null,
            share: null,
            muxVideoId: null,
          },
        ],
        subtitles: [],
      },
    ])

    await expect(
      service.checkMedia({
        input: {
          targetLocale: "es",
          blocks: [
            {
              t: "videoCarousel",
              items: [{ videoId: "video-1" }, { videoSlug: "missing-video" }],
            },
          ],
        },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      targetLanguage: { id: "lang-es" },
      videos: [
        {
          id: "video-1",
          availability: { audio: true, acceptable: true },
        },
      ],
      unresolvedReferences: [
        expect.objectContaining({ value: "missing-video" }),
      ],
    })
  })

  it("searches replacement videos with target-language availability", async () => {
    prisma.language.findFirst.mockResolvedValueOnce({
      id: "lang-fr",
      bcp47: "fr",
      slug: "french",
    })
    prisma.video.findMany.mockResolvedValueOnce([
      {
        id: "video-fr",
        coreId: "core-video-fr",
        slug: "hope-fr",
        label: null,
        publishedAt: null,
        locales: [{ locale: "fr", languageSlug: "french", title: "Espoir" }],
        dubs: [],
        subtitles: [
          {
            id: "subtitle-fr",
            value: "WEBVTT...",
            vttSrc: null,
            srtSrc: null,
          },
        ],
      },
    ])

    await expect(
      service.searchReplacementVideos({
        input: { q: "hope", locale: "fr", limit: 5 },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      query: "hope",
      locale: "fr",
      videos: [
        {
          id: "video-fr",
          availability: { subtitles: true, acceptable: true },
        },
      ],
    })
  })

  it("looks up cached Bible passages and citation metadata", async () => {
    prisma.biblePassageCache.findMany.mockResolvedValueOnce([
      {
        id: "passage-1",
        provider: "youversion",
        versionId: "111",
        reference: "John.3.16",
        humanReference: "John 3:16",
        versionAbbreviation: "NIV",
        versionTitle: "New International Version",
        contentFormat: "text",
        content: "For God so loved the world...",
        copyright: "copyright",
        publisherUrl: "https://example.com",
        expiresAt: new Date("2026-07-28T12:00:00.000Z"),
      },
    ])
    prisma.bibleCitation.findMany.mockResolvedValueOnce([
      {
        id: "citation-1",
        osisId: "John.3.16",
        chapterStart: 3,
        chapterEnd: 3,
        verseStart: 16,
        verseEnd: 16,
        bibleBook: { osisId: "John", name: { en: "John" } },
        video: { id: "video-1", slug: "hope-video" },
      },
    ])

    await expect(
      service.lookupBible({
        input: { query: "John.3.16", locale: "en" },
        user: ADMIN,
      }),
    ).resolves.toMatchObject({
      query: "John.3.16",
      cachedPassages: [
        {
          id: "passage-1",
          expiresAt: "2026-07-28T12:00:00.000Z",
        },
      ],
      citations: [expect.objectContaining({ osisId: "John.3.16" })],
    })
  })
})
