import type { PrismaClient } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { candidateWatchCollectionNames } from "./typesense-watch-search-schema"

const source = vi.hoisted(() => ({
  catalog: [] as Array<{ id: string; title: string; coreId?: string }>,
  availability: [] as Array<{ id: string; videoId: string }>,
  lexical: [] as Array<{ id: string; videoId: string; title_en: string }>,
  curations: [] as Array<{ id: string; targetVideoCoreId: string }>,
  snapshot: null as unknown,
}))
vi.mock("./typesense-watch-search-curation", () => ({
  loadWatchSearchCurations: vi.fn(async () => source.curations),
  buildTypesenseWatchCurationProjection: vi.fn(({ setName, curations }) => ({
    name: setName,
    set: { items: curations.map((item: { id: string }) => ({ id: item.id })) },
  })),
}))
vi.mock("./typesense-watch-search-indexer", () => ({
  buildTypesenseWatchCandidateProjectionSnapshot: vi.fn(
    async () => source.snapshot,
  ),
  buildCatalogDocuments: vi.fn(async (_prisma, ids: string[]) =>
    source.catalog.filter((doc) => ids.includes(doc.id)),
  ),
  buildAvailabilityDocuments: vi.fn((docs: Array<{ id: string }>) =>
    source.availability.filter((doc) =>
      docs.some((video) => video.id === doc.videoId),
    ),
  ),
}))
vi.mock("./typesense-watch-search-lexical", () => ({
  buildTypesenseWatchCandidateLexicalDocuments: vi.fn(
    (docs: Array<{ id: string }>) =>
      source.lexical.filter((doc) =>
        docs.some((video) => video.id === doc.videoId),
      ),
  ),
}))

import {
  applyLiveWatchCatalogChanges,
  bootstrapLiveWatchCatalog,
  cleanupRetiredLiveWatchCatalogs,
  refreshLiveWatchCurations,
} from "./watch-catalog-live-index"

const liveId = "core-live-test"
const names = candidateWatchCollectionNames(liveId)

describe("incremental live Watch catalog", () => {
  let states: Map<string, Record<string, unknown>>
  let dirty: Map<string, bigint>
  let documents: Record<string, Map<string, object>>
  let prisma: PrismaClient
  let typesense: Parameters<typeof applyLiveWatchCatalogChanges>[0]["typesense"]
  let failAvailability: boolean

  beforeEach(() => {
    states = new Map()
    dirty = new Map()
    documents = Object.fromEntries(
      Object.values(names).map((name) => [name, new Map<string, object>()]),
    )
    source.catalog = []
    source.availability = []
    source.lexical = []
    source.curations = []
    source.snapshot = null
    failAvailability = false
    const db = {
      watchCatalogDirtyVideo: {
        aggregate: vi.fn(async () => ({
          _max: {
            revision:
              [...dirty.values()].reduce(
                (max, value) => (value > max ? value : max),
                0n,
              ) || null,
          },
        })),
        findMany: vi.fn(async ({ where, take }) =>
          [...dirty]
            .filter(([, revision]) => revision <= where.revision.lte)
            .sort((a, b) => (a[1] < b[1] ? -1 : 1))
            .slice(0, take)
            .map(([videoId, revision]) => ({ videoId, revision })),
        ),
        deleteMany: vi.fn(
          async ({
            where,
          }: {
            where: { videoId: string; revision: bigint }
          }) => {
            if (dirty.get(where.videoId) === where.revision)
              dirty.delete(where.videoId)
          },
        ),
      },
      watchCatalogVideoState: {
        findUnique: vi.fn(async ({ where }: { where: { videoId: string } }) =>
          states.has(where.videoId)
            ? structuredClone(states.get(where.videoId))
            : null,
        ),
        upsert: vi.fn(
          async ({
            where,
            create,
            update,
          }: {
            where: { videoId: string }
            create: Record<string, unknown>
            update: Record<string, unknown>
          }) => {
            states.set(where.videoId, {
              ...(states.get(where.videoId) ?? create),
              ...update,
            })
          },
        ),
        deleteMany: vi.fn(async ({ where }: { where: { videoId: string } }) => {
          states.delete(where.videoId)
        }),
      },
      watchCatalogPublication: { update: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
    }
    prisma = db as unknown as PrismaClient
    typesense = {
      getCollectionSchema: vi.fn(async () => ({
        fields: [{ name: "title_en" }],
      })),
      importDocuments: vi.fn(
        async (name: string, docs: Array<{ id: string }>) => {
          for (const doc of docs)
            documents[name]!.set(doc.id, structuredClone(doc))
          if (name === names.availability && failAvailability) {
            failAvailability = false
            throw new Error("response lost after partial write")
          }
        },
      ),
      deleteDocument: vi.fn(async (name: string, id: string) => {
        documents[name]!.delete(id)
      }),
    } as unknown as typeof typesense
  })

  async function apply() {
    return applyLiveWatchCatalogChanges({
      prisma,
      typesense,
      liveId,
      assertLock: async () => {},
    })
  }

  it("touches only one changed video and does no Typesense writes for an identical projection", async () => {
    source.catalog = [
      { id: "a", title: "A" },
      { id: "b", title: "B" },
    ]
    dirty.set("a", 1n)
    dirty.set("b", 2n)
    await apply()
    vi.mocked(typesense.importDocuments).mockClear()
    vi.mocked(typesense.deleteDocument).mockClear()
    dirty.set("a", 3n)
    await apply()
    expect(typesense.importDocuments).not.toHaveBeenCalled()
    expect(typesense.deleteDocument).not.toHaveBeenCalled()
    source.catalog[0]!.title = "A changed"
    dirty.set("a", 4n)
    await apply()
    expect(typesense.importDocuments).toHaveBeenCalledTimes(1)
    expect(documents[names.catalog]!.get("b")).toEqual({ id: "b", title: "B" })
  })

  it("preserves a newer source revision arriving during an external write", async () => {
    source.catalog = [{ id: "a", title: "A" }]
    dirty.set("a", 1n)
    vi.mocked(typesense.importDocuments).mockImplementationOnce(
      async (name, docs) => {
        for (const doc of docs as Array<{ id: string }>)
          documents[name]!.set(doc.id, structuredClone(doc))
        source.catalog = [{ id: "a", title: "B" }]
        dirty.set("a", 2n)
      },
    )
    await apply()
    expect(dirty.get("a")).toBe(2n)
    expect(documents[names.catalog]!.get("a")).toEqual({ id: "a", title: "A" })
    await apply()
    expect(dirty.has("a")).toBe(false)
    expect(documents[names.catalog]!.get("a")).toEqual({ id: "a", title: "B" })
  })

  it("replays a reverted value and removes a child written before failure", async () => {
    source.catalog = [{ id: "a", title: "A" }]
    source.availability = [{ id: "a:old", videoId: "a" }]
    source.lexical = [{ id: "a:en", videoId: "a", title_en: "A" }]
    dirty.set("a", 1n)
    await apply()
    source.catalog = [{ id: "a", title: "B" }]
    source.availability = [{ id: "a:new", videoId: "a" }]
    dirty.set("a", 2n)
    failAvailability = true
    await expect(apply()).rejects.toThrow("partial write")
    expect(documents[names.catalog]!.get("a")).toEqual({ id: "a", title: "B" })
    expect(documents[names.availability]!.has("a:new")).toBe(true)
    source.catalog = [{ id: "a", title: "A" }]
    source.availability = [{ id: "a:old", videoId: "a" }]
    dirty.set("a", 3n)
    await apply()
    expect(documents[names.catalog]!.get("a")).toEqual({ id: "a", title: "A" })
    expect([...documents[names.availability]!.keys()]).toEqual(["a:old"])
  })

  it("removes a newly inserted video and localized children after an uncheckpointed write", async () => {
    source.catalog = [{ id: "new", title: "new" }]
    source.availability = [{ id: "new:audio", videoId: "new" }]
    source.lexical = [{ id: "new:fr", videoId: "new", title_en: "new" }]
    dirty.set("new", 1n)
    failAvailability = true
    await expect(apply()).rejects.toThrow("partial write")
    source.catalog = []
    source.availability = []
    source.lexical = []
    dirty.set("new", 2n)
    await apply()
    expect([...documents[names.catalog]!.keys()]).toEqual([])
    expect([...documents[names.availability]!.keys()]).toEqual([])
    expect([...documents[names.lexical]!.keys()]).toEqual([])
  })

  it("refreshes edited curations only when their projection changes and retries an uncertain write", async () => {
    const row = {
      liveCurationDigest: null as string | null,
      liveCurationInFlight: false,
    }
    const db = {
      video: {
        findMany: vi.fn(async () => source.catalog.map(({ id }) => ({ id }))),
      },
      watchCatalogPublication: {
        findUniqueOrThrow: vi.fn(async () => ({ ...row })),
        update: vi.fn(async ({ data }: { data: Partial<typeof row> }) =>
          Object.assign(row, data),
        ),
      },
    }
    const upsertCurationSet = vi.fn(async () => undefined)
    const input = {
      prisma: db as unknown as PrismaClient,
      typesense: { upsertCurationSet } as unknown as typeof typesense,
      liveId,
    }
    expect(await refreshLiveWatchCurations(input)).toBe(true)
    expect(await refreshLiveWatchCurations(input)).toBe(false)
    expect(upsertCurationSet).toHaveBeenCalledTimes(1)
    source.catalog = [{ id: "a", title: "A", coreId: "core-a" }]
    source.curations = [{ id: "edited", targetVideoCoreId: "core-a" }]
    upsertCurationSet.mockRejectedValueOnce(new Error("response lost"))
    await expect(refreshLiveWatchCurations(input)).rejects.toThrow(
      "response lost",
    )
    expect(row.liveCurationInFlight).toBe(true)
    expect(await refreshLiveWatchCurations(input)).toBe(true)
    expect(row.liveCurationInFlight).toBe(false)
    expect(upsertCurationSet).toHaveBeenCalledTimes(3)
    source.catalog = []
    expect(await refreshLiveWatchCurations(input)).toBe(true)
    expect(upsertCurationSet).toHaveBeenLastCalledWith(expect.any(String), {
      items: [],
    })
  })

  it("keeps dirty revisions created around bootstrap for bounded replay", async () => {
    source.snapshot = {
      catalog: [{ id: "a", title: "A" }],
      availability: [],
      lexical: [],
      curations: [],
      tokenizerLocales: ["en"],
      counts: { catalog: 1, availability: 0, lexical: 0 },
    }
    dirty.set("a", 1n)
    const publication = {
      generationId: null,
      liveCollectionId: null,
      buildingLiveCollectionId: null,
      retiredLive: [],
    }
    const db = {
      watchCatalogPublication: {
        findUniqueOrThrow: vi.fn(async () => ({ ...publication })),
        update: vi.fn(async ({ data }: { data: Partial<typeof publication> }) =>
          Object.assign(publication, data),
        ),
      },
      watchCatalogVideoState: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
    }
    const bootstrapTypesense = {
      deleteCollection: vi.fn(),
      deleteCurationSet: vi.fn(),
      upsertCurationSet: vi.fn(),
      createCollection: vi.fn(),
      importDocuments: vi.fn(),
      multiSearch: vi.fn(async () => [
        { found: 1 },
        { found: 0 },
        { found: 0 },
      ]),
    }
    await bootstrapLiveWatchCatalog({
      prisma: db as unknown as PrismaClient,
      typesense: bootstrapTypesense as unknown as typeof typesense,
      liveId,
      assertLock: async () => {},
    })
    expect(dirty.get("a")).toBe(1n)
    expect(publication.liveCollectionId).toBe(liveId)
  })

  it("retires only drained, inactive live collections", async () => {
    const expired = "core-live-expired"
    const draining = "core-live-draining"
    const row = {
      liveCollectionId: liveId,
      retiredLive: [
        { id: liveId, after: "2020-01-01T00:00:00.000Z" },
        { id: draining, after: "2999-01-01T00:00:00.000Z" },
        { id: expired, after: "2020-01-01T00:00:00.000Z" },
      ],
    }
    const db = {
      watchCatalogPublication: {
        findUniqueOrThrow: vi.fn(async () => ({ ...row })),
        update: vi.fn(async ({ data }: { data: Partial<typeof row> }) =>
          Object.assign(row, data),
        ),
      },
    }
    const cleanupTypesense = {
      deleteCollection: vi.fn(),
      deleteCurationSet: vi.fn(),
    }
    await cleanupRetiredLiveWatchCatalogs({
      prisma: db as unknown as PrismaClient,
      typesense: cleanupTypesense as unknown as typeof typesense,
      assertLock: async () => {},
    })
    expect(cleanupTypesense.deleteCollection).toHaveBeenCalledTimes(3)
    expect(cleanupTypesense.deleteCollection).toHaveBeenCalledWith(
      candidateWatchCollectionNames(expired).catalog,
    )
    expect(row.retiredLive).toEqual([
      { id: liveId, after: "2020-01-01T00:00:00.000Z" },
      { id: draining, after: "2999-01-01T00:00:00.000Z" },
    ])
  })
})
