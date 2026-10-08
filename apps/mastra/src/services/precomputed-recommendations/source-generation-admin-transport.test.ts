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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function delayedAdminResponse(delayMs: number) {
  vi.useFakeTimers()
  // Node's native timeout uses an internal timer; use the controllable clock
  // while retaining abort behavior at the actual fetch boundary.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController()
    setTimeout(
      () => controller.abort(new DOMException("Timed out", "TimeoutError")),
      milliseconds,
    )
    return controller.signal
  })
  const fetchImpl = vi.fn(
    (_url: string | URL | Request, options?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = options?.signal
        if (!signal) throw new Error("Request has no deadline")
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", abort)
          resolve(Response.json({ result: { state: "prepared" } }))
        }, delayMs)
        function abort() {
          clearTimeout(timer)
          reject(signal?.reason)
        }
        signal.addEventListener("abort", abort, { once: true })
      }),
  )
  vi.stubGlobal("fetch", fetchImpl)
  return fetchImpl
}

describe("Admin producer transport", () => {
  it("allows a full-catalog import preparation to finish after thirty seconds", async () => {
    const fetchImpl = delayedAdminResponse(50_000)
    const result = createAdminSourceDependencies()
      .ingest({ action: "ga_import_prepare_v1" })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
    await vi.advanceTimersByTimeAsync(50_000)
    expect(await result).toEqual({ value: { state: "prepared" } })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it.each([
    ["ga_import_prepare_v1", 120_000],
    ["ga_import_status_v1", 30_000],
    ["capacity", 30_000],
  ])(
    "bounds %s without retrying a timed-out request",
    async (action, deadline) => {
      const fetchImpl = delayedAdminResponse(180_000)
      let settled = false
      const result = createAdminSourceDependencies()
        .ingest({ action })
        .then(
          () => ({ succeeded: true }),
          (error: unknown) => ({ error }),
        )
        .finally(() => {
          settled = true
        })
      await vi.advanceTimersByTimeAsync(deadline - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(await result).toMatchObject({
        error: { name: "TimeoutError" },
      })
      expect(fetchImpl).toHaveBeenCalledOnce()
    },
  )

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
