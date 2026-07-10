import { describe, expect, it } from "vitest"
import { AdminGraphqlClientError } from "./admin-graphql-client.js"
import type {
  AdminCatalogItem,
  AdminCatalogPage,
} from "./admin-graphql-client.js"
import {
  CatalogSyncService,
  InMemoryCatalogRepository,
  MISSING_FROM_ADMIN_REASON,
  type AdminCatalogClient,
} from "./catalog-sync.js"

const syncStartedAt = new Date("2026-06-10T00:00:00.000Z")
const syncFinishedAt = new Date("2026-06-10T00:01:00.000Z")

describe("CatalogSyncService", () => {
  it("pages through Admin catalog rows and records sync counters", async () => {
    const repository = new InMemoryCatalogRepository()
    const client = new StubAdminCatalogClient([
      page({
        nodes: [
          item({ coreId: "core-1", videoVariantId: "variant-en" }),
          item({
            coreId: "core-2",
            videoVariantId: "variant-fr",
            indexable: false,
            mediaSourceType: "NONE",
            mediaSourceUrl: null,
            nonIndexableReason: "video_unpublished",
            videoPublished: false,
          }),
        ],
        endCursor: "cursor-1",
        hasNextPage: true,
      }),
      page({
        nodes: [
          item({
            coreId: "core-1",
            sourceTitle: "JESUS - Spanish",
            sourceTitleLocale: "es",
            videoVariantId: "variant-es",
            adminDubId: "admin-dub-es",
            languageSlug: "spanish",
            locale: "es",
          }),
        ],
        endCursor: "cursor-2",
        hasNextPage: false,
      }),
    ])

    const result = await createService({ client, repository }).syncCatalog()

    expect(client.calls).toEqual([
      { first: 2, after: null },
      { first: 2, after: "cursor-1" },
    ])
    expect(result).toMatchObject({
      status: "completed",
      cursor: "cursor-2",
      videosSeen: 2,
      variantsSeen: 3,
      variantsIndexable: 2,
      missingVariantsMarked: 0,
    })
    expect(repository.videos.size).toBe(2)
    expect(repository.variants.size).toBe(3)
    expect(repository.variants.get("core-1:variant-es")).toMatchObject({
      coreId: "core-1",
      videoVariantId: "variant-es",
      languageSlug: "spanish",
      locale: "es",
      indexable: true,
    })
  })

  it("reruns idempotently without duplicating videos or variants", async () => {
    const repository = new InMemoryCatalogRepository()
    await createService({
      repository,
      client: new StubAdminCatalogClient([
        page({
          nodes: [item({ sourceTitle: "Original title" })],
          endCursor: "cursor-1",
          hasNextPage: false,
        }),
      ]),
    }).syncCatalog()

    await createService({
      repository,
      client: new StubAdminCatalogClient([
        page({
          nodes: [
            item({
              sourceTitle: "Updated title",
              adminDubId: "admin-dub-updated",
              downloadQuality: "720p",
            }),
          ],
          endCursor: "cursor-2",
          hasNextPage: false,
        }),
      ]),
    }).syncCatalog()

    expect(repository.videos.size).toBe(1)
    expect(repository.variants.size).toBe(1)
    expect(repository.videos.get("core-video-1")).toMatchObject({
      title: "Updated title",
    })
    expect(repository.variants.get("core-video-1:variant-en")).toMatchObject({
      adminDubId: "admin-dub-updated",
      downloadQuality: "720p",
    })
  })

  it("preserves Admin indexable and non-indexable state on variants", async () => {
    const repository = new InMemoryCatalogRepository()
    await createService({
      repository,
      client: new StubAdminCatalogClient([
        page({
          nodes: [
            item({
              indexable: false,
              nonIndexableReason: "media_missing",
              mediaSourceType: "NONE",
              mediaSourceUrl: null,
              videoPublished: true,
              dubPublished: false,
              videoNoIndex: true,
              videoDeleted: true,
              dubDeleted: true,
              deletedAt: "2026-06-09T00:00:00.000Z",
            }),
          ],
          endCursor: "cursor-1",
          hasNextPage: false,
        }),
      ]),
    }).syncCatalog()

    expect(repository.variants.get("core-video-1:variant-en")).toMatchObject({
      indexable: false,
      nonIndexableReason: "media_missing",
      mediaSourceType: "NONE",
      mediaSourceUrl: null,
      published: false,
      videoPublished: true,
      dubPublished: false,
      videoNoIndex: true,
      videoDeleted: true,
      dubDeleted: true,
      deletedAt: new Date("2026-06-09T00:00:00.000Z"),
    })
  })

  it("records failed page summaries with the last successful cursor", async () => {
    const repository = new InMemoryCatalogRepository()
    const client = new StubAdminCatalogClient([
      page({
        nodes: [item()],
        endCursor: "cursor-1",
        hasNextPage: true,
      }),
      new AdminGraphqlClientError(
        "Admin GraphQL returned errors for videoMapperCatalog",
        "graphql_error",
        { errors: [{ message: "BAD_USER_INPUT" }] },
      ),
    ])

    const result = await createService({ client, repository }).syncCatalog()

    expect(result).toMatchObject({
      status: "failed",
      cursor: "cursor-1",
      videosSeen: 1,
      variantsSeen: 1,
      variantsIndexable: 1,
      missingVariantsMarked: 0,
      failureSummary: {
        code: "graphql_error",
        cursor: "cursor-1",
        page: 1,
        details: { errors: [{ message: "BAD_USER_INPUT" }] },
      },
    })
  })

  it("summarizes malformed rows without dumping payloads or media URLs", async () => {
    const repository = new InMemoryCatalogRepository()
    const client = new StubAdminCatalogClient([
      page({
        nodes: [
          {
            ...item({
              coreId: "",
              mediaSourceUrl: "https://media.example.com/private.mp4",
            }),
          } as AdminCatalogItem,
        ],
        endCursor: "cursor-1",
        hasNextPage: false,
      }),
    ])

    const result = await createService({ client, repository }).syncCatalog()

    expect(result).toMatchObject({
      status: "failed",
      variantsSeen: 0,
      failureSummary: {
        code: "malformed_catalog_rows",
        malformedRows: [
          {
            index: 0,
            reason: "coreId is required",
            videoVariantId: "variant-en",
            adminDubId: "admin-dub-1",
          },
        ],
      },
    })
    expect(repository.variants.size).toBe(0)
    expect(JSON.stringify(result.failureSummary)).not.toContain(
      "https://media.example.com/private.mp4",
    )
  })

  it("marks variants missing from a completed Admin snapshot as non-indexable", async () => {
    const repository = new InMemoryCatalogRepository()
    await repository.upsertCatalogVideo({
      coreId: "stale-core",
      title: "Stale",
      titleLocale: "en",
      included: true,
      lastSyncedAt: new Date("2026-06-09T00:00:00.000Z"),
    })
    await repository.upsertCatalogVariant({
      coreId: "stale-core",
      videoVariantId: "stale-variant",
      adminVideoId: "admin-video-stale",
      adminDubId: "admin-dub-stale",
      editionCoreId: null,
      editionName: null,
      languageId: null,
      languageSlug: null,
      locale: null,
      durationSeconds: null,
      lengthInMilliseconds: null,
      hlsUrl: null,
      dashUrl: null,
      downloadUrl: null,
      downloadQuality: null,
      downloadWidth: null,
      downloadHeight: null,
      mediaSourceType: "DOWNLOAD",
      mediaSourceUrl: "https://media.example.com/stale.mp4",
      indexable: true,
      nonIndexableReason: null,
      published: true,
      videoPublished: true,
      dubPublished: true,
      videoNoIndex: false,
      videoDeleted: false,
      dubDeleted: false,
      deletedAt: null,
      lastSyncedAt: new Date("2026-06-09T00:00:00.000Z"),
    })

    const result = await createService({
      repository,
      client: new StubAdminCatalogClient([
        page({ nodes: [], endCursor: null, hasNextPage: false }),
      ]),
    }).syncCatalog()

    expect(result).toMatchObject({
      status: "completed",
      missingVariantsMarked: 1,
    })
    expect(repository.variants.get("stale-core:stale-variant")).toMatchObject({
      indexable: false,
      nonIndexableReason: MISSING_FROM_ADMIN_REASON,
      published: false,
      dubPublished: false,
      lastSyncedAt: syncStartedAt,
    })
  })
})

function createService({
  client,
  repository = new InMemoryCatalogRepository(),
}: {
  client: AdminCatalogClient
  repository?: InMemoryCatalogRepository
}) {
  const dates = [syncStartedAt, syncFinishedAt]
  return new CatalogSyncService({
    client,
    repository,
    pageSize: 2,
    now: () => dates.shift() ?? syncFinishedAt,
  })
}

class StubAdminCatalogClient implements AdminCatalogClient {
  readonly calls: Array<{ first: number; after: string | null }> = []

  constructor(
    private readonly results: Array<AdminCatalogPage | AdminGraphqlClientError>,
  ) {}

  async fetchCatalogPage(input: {
    first: number
    after?: string | null
  }): Promise<AdminCatalogPage> {
    this.calls.push({ first: input.first, after: input.after ?? null })
    const result = this.results.shift()
    if (!result) throw new Error("No stub catalog page configured")
    if (result instanceof AdminGraphqlClientError) throw result
    return result
  }
}

function page({
  nodes,
  endCursor,
  hasNextPage,
}: {
  nodes: AdminCatalogItem[]
  endCursor: string | null
  hasNextPage: boolean
}): AdminCatalogPage {
  return {
    nodes,
    pageInfo: {
      startCursor: nodes.length > 0 ? "start-cursor" : null,
      endCursor,
      hasNextPage,
    },
  }
}

function item(overrides: Partial<AdminCatalogItem> = {}): AdminCatalogItem {
  return {
    coreId: "core-video-1",
    sourceTitle: "JESUS",
    sourceTitleLocale: "en",
    videoVariantId: "variant-en",
    adminVideoId: "admin-video-1",
    adminDubId: "admin-dub-1",
    languageId: "lang-core-en",
    languageSlug: "english",
    locale: "en",
    editionCoreId: "edition-core-1",
    editionName: "Feature",
    durationSeconds: 120,
    lengthInMilliseconds: "120000",
    hlsUrl: "https://media.example.com/video.m3u8",
    dashUrl: null,
    shareUrl: "https://share.example.com/video",
    downloadUrl: "https://media.example.com/video.mp4",
    downloadQuality: "1080p",
    downloadWidth: 1920,
    downloadHeight: 1080,
    mediaSourceType: "DOWNLOAD",
    mediaSourceUrl: "https://media.example.com/video.mp4",
    videoPublished: true,
    dubPublished: true,
    videoNoIndex: false,
    videoDeleted: false,
    dubDeleted: false,
    deletedAt: null,
    indexable: true,
    nonIndexableReason: null,
    ...overrides,
  }
}
