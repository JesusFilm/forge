import { describe, expect, it } from "vitest"
import { shouldRequestWatchCatalogPublication } from "./watch-catalog-publication"

describe("Core to Watch publication admission", () => {
  it("publishes full, incremental, and scoped successful content imports", () => {
    expect(
      shouldRequestWatchCatalogPublication([
        { phase: "videos", updated: 5, errors: 0 },
      ]),
    ).toBe(true)
    expect(
      shouldRequestWatchCatalogPublication([
        { phase: "video-dubs", updated: 1, errors: 0 },
      ]),
    ).toBe(true)
    expect(
      shouldRequestWatchCatalogPublication([
        { phase: "video-images", softDeleted: 1, errors: 0 },
      ]),
    ).toBe(true)
  })
  it("does not publish a failed run, even when some records were written", () => {
    expect(
      shouldRequestWatchCatalogPublication([
        { phase: "videos", updated: 5, errors: 1 },
        { phase: "video-dubs", updated: 4, errors: 0 },
      ]),
    ).toBe(false)
  })
  it("queues no-op recovery completions but ignores unrelated phases", () => {
    expect(
      shouldRequestWatchCatalogPublication([
        { phase: "videos", updated: 0, errors: 0 },
      ]),
    ).toBe(true)
    expect(
      shouldRequestWatchCatalogPublication([
        { phase: "countries", updated: 5, errors: 0 },
      ]),
    ).toBe(false)
    expect(shouldRequestWatchCatalogPublication([])).toBe(false)
  })
})

import type { PrismaClient } from "@prisma/client"
import { vi } from "vitest"
import {
  createCandidateWatchSearchProfile,
  createCurrentWatchSearchProfile,
} from "./typesense-watch-search-profile"
import { resolvePublishedWatchCatalog } from "./watch-catalog-publication"

describe("automatic catalog resolution", () => {
  const generation = {
    generationId: "base",
    indexContractRevision: "contract-v4",
    contentEmbeddingContractId: "embedding-v2",
    transcriptChunkingVersion: "chunks-v2",
    transcriptProjectionRevision: 1n,
    collections: {
      catalog: "watch_search_candidate_base_catalog",
      availability: "watch_search_candidate_base_availability",
      lexical: "watch_search_candidate_base_lexical",
      transcript: "shared-transcript",
    },
    fieldManifests: {
      catalog: [{ name: "id", type: "string" as const }],
      availability: [{ name: "id", type: "string" as const }],
      lexical: [{ name: "id", type: "string" as const }],
      transcript: [{ name: "id", type: "string" as const }],
    },
  }
  const base = createCandidateWatchSearchProfile(generation, "qualified-engine")
  function dependencies(patch = {}) {
    const findUnique = vi.fn().mockResolvedValue({
      generationId: "fresh-content",
      baseGenerationId: "base",
      rankingRevision: "ranking-v3",
      searchVersion: 3,
      ...patch,
    })
    const resolveGeneration = vi.fn().mockResolvedValue({
      ...generation,
      generationId: "fresh-content",
      transcriptProjectionRevision: 2n,
      collections: {
        catalog: "watch_search_candidate_fresh-content_catalog",
        availability: "watch_search_candidate_fresh-content_availability",
        lexical: "watch_search_candidate_fresh-content_lexical",
        transcript: "shared-transcript",
      },
    })
    return {
      prisma: {
        watchCatalogPublication: { findUnique },
      } as unknown as PrismaClient,
      generations: { resolveGeneration },
      rankingRevision: "ranking-v3",
      base,
    }
  }
  it("serves the complete new content tuple without claiming a new qualification", async () => {
    const deps = dependencies()
    const profile = await resolvePublishedWatchCatalog(deps)
    expect(profile.generationId).toBe("fresh-content")
    expect(profile.binding.lexical).toBe(
      "watch_search_candidate_fresh-content_lexical",
    )
    expect(profile.qrelsRevision).toBe("catalog-refresh:3:qualified-engine")
    expect(deps.generations.resolveGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "fresh-content",
        indexContractRevision: "contract-v4",
        transcriptCollection: "shared-transcript",
      }),
    )
    expect(
      deps.generations.resolveGeneration.mock.calls[0][0],
    ).not.toHaveProperty("requireQualified")
  })
  it("serves a separately owned live catalog without resolving it as a qualified generation", async () => {
    const deps = dependencies({
      generationId: null,
      liveCollectionId: "core-live-example",
      liveLexicalFields: [{ name: "title_fr", type: "string[]" }],
    })
    const profile = await resolvePublishedWatchCatalog(deps)
    expect(profile.binding.catalog).toBe(
      "watch_search_candidate_core-live-example_catalog",
    )
    expect(profile.fieldManifests?.lexical).toEqual([
      { name: "title_fr", type: "string[]" },
    ])
    expect(deps.generations.resolveGeneration).not.toHaveBeenCalled()
  })
  it("changes the live probe identity after a dirty-only publication", async () => {
    const deps = dependencies({
      generationId: null,
      liveCollectionId: "core-live-example",
      liveLexicalFields: [{ name: "title_fr", type: "string[]" }],
      lastPublishedAt: new Date("2026-09-30T01:00:00.000Z"),
    })
    const first = await resolvePublishedWatchCatalog(deps)
    vi.mocked(deps.prisma.watchCatalogPublication.findUnique).mockResolvedValue(
      {
        generationId: null,
        liveCollectionId: "core-live-example",
        liveLexicalFields: [{ name: "title_fr", type: "string[]" }],
        baseGenerationId: "base",
        rankingRevision: "ranking-v3",
        searchVersion: 3,
        lastPublishedAt: new Date("2026-09-30T01:01:00.000Z"),
      } as never,
    )
    const second = await resolvePublishedWatchCatalog(deps)
    expect(second.qrelsRevision).not.toBe(first.qrelsRevision)
  })
  it.each([
    { baseGenerationId: "another-base" },
    { rankingRevision: "other-ranking" },
    { generationId: null },
  ])(
    "keeps the selected baseline when the catalog is incompatible: %j",
    async (patch) => {
      const deps = dependencies(patch)
      expect(await resolvePublishedWatchCatalog(deps)).toBe(base)
      expect(deps.generations.resolveGeneration).not.toHaveBeenCalled()
    },
  )
  it("does not apply Candidate content to CURRENT", async () => {
    const deps = { ...dependencies(), base: createCurrentWatchSearchProfile() }
    expect(await resolvePublishedWatchCatalog(deps)).toBe(deps.base)
    expect(
      deps.prisma.watchCatalogPublication.findUnique,
    ).not.toHaveBeenCalled()
  })
  it("refuses a missing or invalidated active tuple rather than partially changing bindings", async () => {
    const deps = dependencies()
    deps.generations.resolveGeneration.mockRejectedValue(new Error("not READY"))
    await expect(resolvePublishedWatchCatalog(deps)).rejects.toThrow(
      "not READY",
    )
  })
})
