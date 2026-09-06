import type { PrismaClient } from "@prisma/client"
import { describe, expect, it, vi } from "vitest"

import {
  CANDIDATE_SERVING_SERVICE_CACHE_TTL_MS,
  resolveCachedCandidateServingService,
  resolveWatchSearchServingProfile,
} from "@/services/index"
import type { TypesenseWatchSearchService } from "@/services/typesense-watch-search.service"
import {
  TYPESENSE_WATCH_AVAILABILITY_ALIAS,
  TYPESENSE_WATCH_CATALOG_ALIAS,
  TYPESENSE_WATCH_LEXICAL_ALIAS,
  TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
} from "@/services/typesense-watch-search-schema"

const fields = {
  catalog: [{ name: "slug", type: "string" }],
  availability: [{ name: "videoId", type: "string" }],
  lexical: [{ name: "title_en", type: "string[]" }],
  transcript: [{ name: "embedding", type: "float[]" }],
}

const transcriptCompatibility = {
  contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
  transcriptChunkingVersion: "mastra-v1",
} as const

function fixture() {
  const getPointer = vi.fn(async () => ({
    kind: "SERVING" as const,
    generationId: "generation-a",
    version: 1,
    updatedAt: new Date("2026-08-10T00:00:00.000Z"),
  }))
  const getAlias = vi.fn(async (name: string) => ({
    name,
    collection_name:
      name === TYPESENSE_WATCH_TRANSCRIPT_ALIAS
        ? "watch_search_transcripts_20260810"
        : `${name}_20260810`,
  }))
  const resolveGeneration = vi.fn(async (input) => ({
    generationId: input.generationId,
    indexContractRevision: input.indexContractRevision,
    ...transcriptCompatibility,
    transcriptProjectionRevision: input.transcriptProjectionRevision ?? 7n,
    collections: {
      catalog: `watch_search_candidate_${input.generationId}_catalog`,
      availability: `watch_search_candidate_${input.generationId}_availability`,
      lexical: `watch_search_candidate_${input.generationId}_lexical`,
      transcript: input.transcriptCollection,
    },
    fieldManifests: fields,
  }))
  return { getAlias, getPointer, resolveGeneration }
}

describe("resolveWatchSearchServingProfile", () => {
  it("coalesces candidate profile resolution, refreshes after TTL, and retries failures", async () => {
    const prisma = {} as PrismaClient
    let now = 1_000
    const firstService = {
      search: vi.fn(),
    } as unknown as TypesenseWatchSearchService
    const secondService = {
      search: vi.fn(),
    } as unknown as TypesenseWatchSearchService
    const create = vi
      .fn<() => Promise<TypesenseWatchSearchService>>()
      .mockResolvedValueOnce(firstService)
      .mockResolvedValueOnce(secondService)

    await expect(
      Promise.all([
        resolveCachedCandidateServingService({
          prisma,
          create,
          now: () => now,
        }),
        resolveCachedCandidateServingService({
          prisma,
          create,
          now: () => now,
        }),
      ]),
    ).resolves.toEqual([firstService, firstService])
    expect(create).toHaveBeenCalledOnce()

    now += CANDIDATE_SERVING_SERVICE_CACHE_TTL_MS
    await expect(
      resolveCachedCandidateServingService({ prisma, create, now: () => now }),
    ).resolves.toBe(secondService)
    expect(create).toHaveBeenCalledTimes(2)

    const retryPrisma = {} as PrismaClient
    const retry = vi
      .fn<() => Promise<TypesenseWatchSearchService>>()
      .mockRejectedValueOnce(new Error("pointer moved"))
      .mockResolvedValueOnce(firstService)
    await expect(
      resolveCachedCandidateServingService({
        prisma: retryPrisma,
        create: retry,
        now: () => now,
      }),
    ).rejects.toThrow("pointer moved")
    await expect(
      resolveCachedCandidateServingService({
        prisma: retryPrisma,
        create: retry,
        now: () => now,
      }),
    ).resolves.toBe(firstService)
    expect(retry).toHaveBeenCalledTimes(2)
  })

  it("defaults public MODERN to the current aliases without candidate reads", async () => {
    const { getAlias, getPointer, resolveGeneration } = fixture()
    const profile = await resolveWatchSearchServingProfile({
      selector: "CURRENT",
      indexContractRevision: null,
      rankingRevision: null,
      transcriptCompatibility: null,
      qrelsRevision: null,
      typesense: { getAlias },
      generations: { getPointer, resolveGeneration },
    })

    expect(profile).toMatchObject({
      kind: "CURRENT",
      binding: {
        catalog: TYPESENSE_WATCH_CATALOG_ALIAS,
        availability: TYPESENSE_WATCH_AVAILABILITY_ALIAS,
        lexical: TYPESENSE_WATCH_LEXICAL_ALIAS,
        transcript: TYPESENSE_WATCH_TRANSCRIPT_ALIAS,
      },
    })
    expect(getAlias).not.toHaveBeenCalled()
    expect(resolveGeneration).not.toHaveBeenCalled()
    expect(getPointer).not.toHaveBeenCalled()
  })

  it("resolves only the exact qualified pinned generation", async () => {
    const { getAlias, getPointer, resolveGeneration } = fixture()
    const profile = await resolveWatchSearchServingProfile({
      selector: "CANDIDATE:generation-a",
      indexContractRevision: "revision-a",
      rankingRevision: "title-and-brand-v2",
      transcriptCompatibility,
      qrelsRevision: "qrels-1",
      typesense: { getAlias },
      generations: { getPointer, resolveGeneration },
    })

    expect(resolveGeneration).toHaveBeenCalledWith({
      generationId: "generation-a",
      indexContractRevision: "revision-a",
      rankingRevision: "title-and-brand-v2",
      transcriptCollection: "watch_search_transcripts_20260810",
      ...transcriptCompatibility,
      requireQualified: true,
      currentBindings: [
        `${TYPESENSE_WATCH_CATALOG_ALIAS}_20260810`,
        `${TYPESENSE_WATCH_AVAILABILITY_ALIAS}_20260810`,
        `${TYPESENSE_WATCH_LEXICAL_ALIAS}_20260810`,
        "watch_search_transcripts_20260810",
      ],
      qrelsRevision: "qrels-1",
    })
    expect(profile).toMatchObject({
      kind: "CANDIDATE",
      generationId: "generation-a",
      qrelsRevision: "qrels-1",
    })
  })

  it("fails closed for missing identity and propagates invalid qualification or drift", async () => {
    const first = fixture()
    await expect(
      resolveWatchSearchServingProfile({
        selector: "CANDIDATE:generation-a",
        indexContractRevision: null,
        rankingRevision: "title-and-brand-v2",
        transcriptCompatibility,
        qrelsRevision: "qrels-1",
        typesense: { getAlias: first.getAlias },
        generations: {
          getPointer: first.getPointer,
          resolveGeneration: first.resolveGeneration,
        },
      }),
    ).rejects.toThrow(/index contract revision/i)

    const second = fixture()
    second.resolveGeneration.mockRejectedValueOnce(
      new Error("exact passing qualification missing"),
    )
    await expect(
      resolveWatchSearchServingProfile({
        selector: "CANDIDATE:generation-a",
        indexContractRevision: "revision-a",
        rankingRevision: "title-and-brand-v2",
        transcriptCompatibility,
        qrelsRevision: "qrels-1",
        typesense: { getAlias: second.getAlias },
        generations: {
          getPointer: second.getPointer,
          resolveGeneration: second.resolveGeneration,
        },
      }),
    ).rejects.toThrow("exact passing qualification missing")
  })

  it("fails closed when the env selector bypasses the serving pointer", async () => {
    const fixtureValue = fixture()
    fixtureValue.getPointer.mockResolvedValueOnce({
      kind: "SERVING",
      generationId: "generation-b",
      version: 2,
      updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    })

    await expect(
      resolveWatchSearchServingProfile({
        selector: "CANDIDATE:generation-a",
        indexContractRevision: "revision-a",
        rankingRevision: "title-and-brand-v2",
        transcriptCompatibility,
        qrelsRevision: "qrels-1",
        typesense: { getAlias: fixtureValue.getAlias },
        generations: {
          getPointer: fixtureValue.getPointer,
          resolveGeneration: fixtureValue.resolveGeneration,
        },
      }),
    ).rejects.toThrow(/serving pointer/i)
    expect(fixtureValue.resolveGeneration).not.toHaveBeenCalled()
  })
})
