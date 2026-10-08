import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../config/env", () => ({
  env: {
    ADMIN_MASTRA_RECOMMENDATION_API_KEY: "fixture-key",
    ADMIN_RECOMMENDATION_CATALOG_URL: "http://localhost/catalog",
    ADMIN_RECOMMENDATION_INGEST_URL: "http://localhost/ingest",
    PRECOMPUTED_GA4_PROPERTY_ID: undefined,
  },
}))

import { createAdminSourceDependencies, type Video } from "./source-generation"
import { buildCandidateRetrieval } from "./candidate-retrieval"
import { manualGenerationInputDigest } from "./manual-subscription-catalog"

afterEach(() => vi.unstubAllGlobals())

describe("Admin producer transport", () => {
  it("retains a sealed catalog identity when transcript descriptors cross HTTP", async () => {
    const cutoff = "2026-10-06T00:00:00.000Z"
    const video: Video = {
      id: "source",
      coreId: "source-core",
      slug: "source",
      locale: "en",
      title: "Hope",
      description: "Hope during hardship.",
      descriptionTruncated: false,
      keywords: [],
      keywordsTruncated: false,
      bibleCitations: [],
      bibleCitationsTruncated: false,
      parentVideoIds: [],
      childVideoIds: [],
      transcriptLanguages: ["en"],
      transcriptSelection: {
        policy: "english-per-edition-with-complete-fallback-v1",
        availableTranscriptCount: 1,
        incompleteTranscriptCount: 0,
        skippedEditionCount: 0,
        selected: [
          {
            // Existing Admin PostgreSQL JSONB descriptor serialization.
            language: "en",
            totalChunks: 1,
            transcriptId: "transcript",
            videoEditionId: "edition",
          },
        ],
      },
    }
    const chunks = [
      {
        id: "chunk",
        transcriptId: "transcript",
        language: "en",
        chunkIndex: 0,
        text: "Hope during hardship.",
      },
    ]
    const native = {
      async video() {
        return video
      },
      async catalog() {
        return { videos: [video], nextCursor: null }
      },
      async chunks() {
        return { chunks, nextCursor: null }
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        const request = JSON.parse(String(options.body)) as { action: string }
        const result =
          request.action === "catalog"
            ? { action: "catalog", videos: [video], nextCursor: null }
            : request.action === "video"
              ? { action: "video", video }
              : { action: "chunks", chunks, nextCursor: null }
        return Response.json({ result })
      }),
    )
    const wire = createAdminSourceDependencies().catalog
    const nativeRetrieval = await buildCandidateRetrieval(
      native,
      [video],
      cutoff,
    )
    expect(nativeRetrieval.selectedCorpusDigest).toBe(
      "dce262cb31df3053836038c27f505cbfdff224690b433bbe19fb5ca65819966c",
    )
    const parsed = await wire.catalog({ cutoff })
    expect(parsed.videos).toEqual([video])
    const wireRetrieval = await buildCandidateRetrieval(
      wire,
      parsed.videos,
      cutoff,
    )
    expect(wireRetrieval.selectedCorpusDigest).toBe(
      nativeRetrieval.selectedCorpusDigest,
    )
    expect(wireRetrieval.candidatePoolDigest).toBe(
      nativeRetrieval.candidatePoolDigest,
    )
    const identity = (videos: Video[]) =>
      manualGenerationInputDigest({
        inputCutoff: cutoff,
        videos,
        selectedCorpusDigest: nativeRetrieval.selectedCorpusDigest,
        candidatePoolDigest: nativeRetrieval.candidatePoolDigest,
      })
    expect(identity(parsed.videos)).toBe(identity([video]))
    expect(identity([await wire.video({ videoId: video.id, cutoff })])).toBe(
      identity([video]),
    )
  })

  it("preserves only the exact live foreign source claim conflict", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(
        { error: "Source has a live claim", reason: "conflict" },
        { status: 409 },
      ),
    )
    vi.stubGlobal("fetch", fetchImpl)
    await expect(
      createAdminSourceDependencies().ingest({
        action: "claim",
        generationId: "generation",
        sourceVideoId: "source",
        claimId: "claim",
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "Source has a live claim",
    })
    expect(fetchImpl).toHaveBeenCalledOnce()

    for (const [action, error] of [
      ["claim", "A different conflict"],
      ["complete", "Source has a live claim"],
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ error, reason: "conflict" }, { status: 409 }),
        ),
      )
      await expect(
        createAdminSourceDependencies().ingest({ action }),
      ).rejects.toMatchObject({ code: "contract_rejected" })
    }
  })
})
