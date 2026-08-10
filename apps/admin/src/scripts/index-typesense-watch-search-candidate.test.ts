import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import type { TypesenseWatchCandidateProjectionSnapshot } from "@/services/typesense-watch-search-indexer"
import {
  CandidateProjectionSafetyError,
  publishTypesenseWatchSearchCandidate,
  retireTypesenseWatchSearchCandidate,
} from "./index-typesense-watch-search-candidate"

const snapshot: TypesenseWatchCandidateProjectionSnapshot = {
  catalog: [
    {
      id: "video-1",
      coreId: "core-1",
      slug: "jesus",
      titles: ["JESUS", "耶稣传"],
      localeCodes: ["en", "zh-hans"],
      descriptions: ["The life of Jesus", "耶稣的一生"],
      localesJson: JSON.stringify([
        {
          locale: "en",
          languageSlug: "english",
          title: "JESUS",
          description: "The life of Jesus",
        },
        {
          locale: "zh-Hans",
          languageSlug: "mandarin-chinese",
          title: "耶稣传",
          description: "耶稣的一生",
        },
      ]),
      label: null,
      childCount: 0,
      imageUrl: null,
      imageBlurDataUrl: null,
      audioLanguageSlugs: [],
      subtitleLanguageSlugs: [],
      audioOptionsJson: "[]",
      subtitleOptionsJson: "[]",
    },
  ],
  availability: [],
  lexical: [
    {
      id: "video-1:slug:english",
      videoId: "video-1",
      canonicalVideoId: "core:core-1",
      languageIdentity: "slug:english",
      localeCodes: ["en"],
      title_en: ["JESUS"],
      metadata_en: ["The life of Jesus"],
    },
    {
      id: "video-1:slug:mandarin-chinese",
      videoId: "video-1",
      canonicalVideoId: "core:core-1",
      languageIdentity: "slug:mandarin-chinese",
      localeCodes: ["zh-hans"],
      title_zh: ["耶稣传"],
      metadata_zh: ["耶稣的一生"],
    },
  ],
  tokenizerLocales: ["en", "zh"],
  counts: { catalog: 1, availability: 0, lexical: 2 },
  digests: {
    catalog: `sha256:${"a".repeat(64)}`,
    availability: `sha256:${"b".repeat(64)}`,
    lexical: `sha256:${"c".repeat(64)}`,
    combined: `sha256:${"d".repeat(64)}`,
  },
  lexicalMemory: {
    searchableBytes: 64,
    estimatedRamLowBytes: 128,
    estimatedRamHighBytes: 192,
  },
}

function lifecycleDouble(generationId = "generation_01") {
  let row: Record<string, unknown> | null = null
  const pointer = { kind: "EVALUATION", generationId: null, version: 0 }
  const lifecycle = {
    // The double accepts the production service's heterogeneous Prisma input.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createBuildingGeneration: vi.fn(async (input: Record<string, any>) => {
      row = {
        ...input,
        state: "BUILDING",
        version: 0,
        catalogCollection: input.members.catalog.collection,
        availabilityCollection: input.members.availability.collection,
        lexicalCollection: input.members.lexical.collection,
        transcriptCollection: input.members.transcript.collection,
        ownedCollections: [
          input.members.catalog.collection,
          input.members.availability.collection,
          input.members.lexical.collection,
        ],
        sharedCollections: [input.members.transcript.collection],
        deletionProgress: {},
      }
      return row
    }),
    getGeneration: vi.fn(async () => row),
    validateAndMarkReady: vi.fn(async (input: { expectedVersion: number }) => {
      row = { ...row, state: "READY", version: input.expectedVersion + 1 }
      return row
    }),
    getPointer: vi.fn(async (kind: "EVALUATION" | "SERVING") =>
      kind === "EVALUATION"
        ? pointer
        : { kind: "SERVING", generationId: null, version: 0 },
    ),
    publishEvaluationGeneration: vi.fn(
      async (input: {
        generationId: string
        expectedPointerVersion: number
      }) => {
        pointer.generationId = input.generationId as never
        pointer.version = input.expectedPointerVersion + 1
        return pointer
      },
    ),
    beginRetirement: vi.fn(async () => {
      if (!row) throw new Error("generation missing")
      if (row.state === "RETIRED" || row.state === "RETIRING") return row
      if (pointer.generationId === row.id) {
        pointer.generationId = null
        pointer.version += 1
      }
      row = {
        ...row,
        state: "RETIRING",
        version: Number(row.version) + 1,
      }
      return row
    }),
    clearPointer: vi.fn(
      async (
        kind: "EVALUATION" | "SERVING",
        input: { generationId: string; expectedPointerVersion: number },
      ) => {
        if (
          kind !== "EVALUATION" ||
          pointer.generationId !== input.generationId ||
          pointer.version !== input.expectedPointerVersion
        ) {
          throw new Error("pointer changed concurrently")
        }
        pointer.generationId = null
        pointer.version += 1
        return pointer
      },
    ),
    transitionGeneration: vi.fn(
      async (input: {
        expectedVersion: number
        nextState: string
        reason?: string
      }) => {
        row = {
          ...row,
          state: input.nextState,
          version: input.expectedVersion + 1,
          invalidationReason: input.reason,
        }
        return row
      },
    ),
    assertRetirementAllowed: vi.fn(async () => undefined),
    recordDeletionProgress: vi.fn(
      async (input: {
        expectedVersion: number
        deletedCollections: string[]
      }) => {
        row = {
          ...row,
          version: input.expectedVersion + 1,
          deletionProgress: { deletedCollections: input.deletedCollections },
        }
        return row
      },
    ),
  }
  return {
    lifecycle,
    get row() {
      return row
    },
    setRow(next: Record<string, unknown>) {
      row = next
    },
    generationId,
  }
}

function typesenseDouble() {
  const schemas = new Map<string, { name: string; fields: unknown[] }>([
    [
      "watch_search_transcripts_active",
      {
        name: "watch_search_transcripts_active",
        fields: [
          { name: "embedding", type: "float[]", num_dim: 1536 },
          { name: "publiclyVisible", type: "bool", facet: true },
        ],
      },
    ],
  ])
  const documents = new Map<string, unknown[]>()
  return {
    schemas,
    documents,
    client: {
      getCollectionSchema: vi.fn(async (name: string) => {
        const schema = schemas.get(name)
        if (!schema) throw Object.assign(new Error("missing"), { status: 404 })
        return schema
      }),
      createCollection: vi.fn(
        async (schema: { name: string; fields: unknown[] }) => {
          schemas.set(schema.name, schema)
          return schema
        },
      ),
      importDocuments: vi.fn(
        async (collection: string, batch: unknown[], action: string) => {
          expect(action).toBe("upsert")
          documents.set(collection, batch)
        },
      ),
      multiSearch: vi.fn(async (searches: Array<{ collection: string }>) =>
        searches.map((search) => ({
          found: documents.get(search.collection)?.length ?? 0,
          out_of: documents.get(search.collection)?.length ?? 0,
          page: 1,
          search_time_ms: 1,
          hits: [],
        })),
      ),
      getAlias: vi.fn(async (alias: string) => ({
        name: alias,
        collection_name: `${alias}_current`,
      })),
      deleteCollection: vi.fn(async (_collection: string) => undefined),
      upsertAlias: vi.fn(),
      deleteAlias: vi.fn(),
    },
  }
}

describe("Typesense Watch candidate index CLI", () => {
  it("publishes only candidate-owned projections and reuses transcript identity", async () => {
    const generation = lifecycleDouble()
    const typesense = typesenseDouble()
    const currentCanary = vi.fn(async () => undefined)

    const result = await publishTypesenseWatchSearchCandidate({
      prisma: {} as PrismaClient,
      typesense: typesense.client as never,
      generations: generation.lifecycle as never,
      generationId: generation.generationId,
      applicationRevision: "app-sha-1",
      sourceEpoch: "source-42",
      transcript: {
        collection: "watch_search_transcripts_active",
        projectionRevision: 17n,
      },
      loadSnapshot: async () => snapshot,
      runCurrentCanary: currentCanary,
    })

    const createdNames = typesense.client.createCollection.mock.calls.map(
      ([schema]) => schema.name,
    )
    expect(createdNames).toEqual([
      "watch_search_candidate_generation_01_catalog",
      "watch_search_candidate_generation_01_availability",
      "watch_search_candidate_generation_01_lexical",
    ])
    expect(
      generation.lifecycle.createBuildingGeneration.mock.invocationCallOrder[0],
    ).toBeLessThan(
      typesense.client.createCollection.mock.invocationCallOrder[0]!,
    )
    expect(generation.lifecycle.createBuildingGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDigests: snapshot.digests,
        members: expect.objectContaining({
          transcript: expect.objectContaining({
            collection: "watch_search_transcripts_active",
            ownership: "SHARED",
          }),
        }),
      }),
    )
    expect(typesense.client.importDocuments).toHaveBeenCalledTimes(3)
    expect(typesense.client.importDocuments).not.toHaveBeenCalledWith(
      "watch_search_transcripts_active",
      expect.anything(),
      expect.anything(),
    )
    expect(typesense.client.upsertAlias).not.toHaveBeenCalled()
    expect(typesense.client.deleteAlias).not.toHaveBeenCalled()
    expect(currentCanary).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      generationId: "generation_01",
      transcriptReused: true,
      counts: snapshot.counts,
    })
  })

  it("leaves a durable BUILDING owner when external publication fails", async () => {
    const generation = lifecycleDouble()
    const typesense = typesenseDouble()

    await expect(
      publishTypesenseWatchSearchCandidate({
        prisma: {} as PrismaClient,
        typesense: typesense.client as never,
        generations: generation.lifecycle as never,
        generationId: generation.generationId,
        applicationRevision: "app-sha-1",
        sourceEpoch: "source-42",
        transcript: {
          collection: "watch_search_transcripts_active",
          projectionRevision: 17n,
        },
        loadSnapshot: async () => snapshot,
        failpoint: (step) => {
          if (step === "catalog:created") throw new Error("failpoint")
        },
      }),
    ).rejects.toThrow("failpoint")

    expect(generation.row).toMatchObject({ state: "BUILDING" })
    expect(generation.lifecycle.validateAndMarkReady).not.toHaveBeenCalled()
    expect(
      generation.lifecycle.publishEvaluationGeneration,
    ).not.toHaveBeenCalled()
  })

  it("retires exact owned members resumably and never deletes current or transcript state", async () => {
    const generation = lifecycleDouble()
    generation.setRow({
      id: generation.generationId,
      state: "INVALIDATED",
      version: 2,
      ownedCollections: [
        "watch_search_candidate_generation_01_catalog",
        "watch_search_candidate_generation_01_availability",
        "watch_search_candidate_generation_01_lexical",
      ],
      sharedCollections: ["watch_search_transcripts_active"],
      transcriptCollection: "watch_search_transcripts_active",
      deletionProgress: {},
    })
    const typesense = typesenseDouble()
    await generation.lifecycle.publishEvaluationGeneration({
      generationId: generation.generationId,
      expectedPointerVersion: 0,
    })
    const externallyDeleted = new Set<string>()
    typesense.client.deleteCollection.mockImplementation(async (collection) => {
      if (externallyDeleted.has(collection)) {
        throw Object.assign(new Error("missing"), { status: 404 })
      }
      externallyDeleted.add(collection)
    })
    let failed = false
    const failpoint = (step: string) => {
      if (!failed && step === "availability:deleted") {
        failed = true
        throw new Error("crash after delete")
      }
    }

    await expect(
      retireTypesenseWatchSearchCandidate({
        generationId: generation.generationId,
        typesense: typesense.client as never,
        generations: generation.lifecycle as never,
        assertDrained: async () => undefined,
        failpoint,
      }),
    ).rejects.toThrow("crash after delete")
    await expect(
      retireTypesenseWatchSearchCandidate({
        generationId: generation.generationId,
        typesense: typesense.client as never,
        generations: generation.lifecycle as never,
        assertDrained: async () => undefined,
      }),
    ).resolves.toMatchObject({ state: "RETIRED" })

    const deleted = typesense.client.deleteCollection.mock.calls.map(
      ([collection]) => collection,
    )
    expect(deleted).not.toContain("watch_search_transcripts_active")
    expect(
      deleted.some((name) => name.startsWith("watch_search_catalog_")),
    ).toBe(false)
    expect(deleted.filter((name) => name.endsWith("_catalog"))).toHaveLength(1)
    expect(
      deleted.filter((name) => name.endsWith("_availability")),
    ).toHaveLength(2)
    expect(generation.lifecycle.beginRetirement).toHaveBeenCalledWith(
      generation.generationId,
    )
    await expect(
      generation.lifecycle.getPointer("EVALUATION"),
    ).resolves.toMatchObject({ generationId: null, version: 2 })
  })

  it("rejects forged ownership and drain blockers before deleting anything", async () => {
    const generation = lifecycleDouble()
    generation.setRow({
      id: generation.generationId,
      state: "INVALIDATED",
      version: 2,
      ownedCollections: [
        "watch_search_catalog_current",
        "watch_search_candidate_generation_01_availability",
        "watch_search_candidate_generation_01_lexical",
      ],
      sharedCollections: ["watch_search_transcripts_active"],
      transcriptCollection: "watch_search_transcripts_active",
      deletionProgress: {},
    })
    const typesense = typesenseDouble()

    await expect(
      retireTypesenseWatchSearchCandidate({
        generationId: generation.generationId,
        typesense: typesense.client as never,
        generations: generation.lifecycle as never,
        assertDrained: async () => {
          throw new Error("stale replica")
        },
      }),
    ).rejects.toThrow(/stale replica|ownership/)
    expect(typesense.client.deleteCollection).not.toHaveBeenCalled()

    await expect(
      retireTypesenseWatchSearchCandidate({
        generationId: generation.generationId,
        typesense: typesense.client as never,
        generations: generation.lifecycle as never,
        assertDrained: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(CandidateProjectionSafetyError)
    expect(typesense.client.deleteCollection).not.toHaveBeenCalled()
  })
})
