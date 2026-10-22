import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const envMock = vi.hoisted(() => ({
  env: {
    WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED: "false" as
      | boolean
      | "true"
      | "false",
    TYPESENSE_HOST: undefined as string | undefined,
    TYPESENSE_OPERATOR_API_KEY: undefined as string | undefined,
  },
  resolveWatchSearchRuntimeEnv: vi.fn(() => ({
    defaultShadowEnabled: true,
    fleetPrimaryEnabled: false,
    candidateComparisonEnabled: false,
    transcriptProjectionRevision: undefined as bigint | undefined,
  })),
  resolveWatchSearchTranscriptPublicationEnabled: vi.fn(
    (value?: unknown) =>
      (value ?? envMock.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED) ===
        true ||
      (value ?? envMock.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED) ===
        "true",
  ),
}))

const typesenseClientConstructor = vi.hoisted(() => vi.fn())
const candidateGenerationConstructor = vi.hoisted(() => vi.fn())

vi.mock("@/config/env", () => envMock)
vi.mock("./typesense-client", () => ({
  TypesenseClient: vi.fn().mockImplementation((input) => {
    typesenseClientConstructor(input)
    return { getAlias: vi.fn() }
  }),
}))
vi.mock("./typesense-watch-search-candidate-generation", () => ({
  TypesenseWatchSearchCandidateGenerationService: vi
    .fn()
    .mockImplementation((...args) => {
      candidateGenerationConstructor(...args)
      return { assertCurrentPublicationAllowed: vi.fn() }
    }),
}))

function clearWorkerState() {
  const state = (
    globalThis as typeof globalThis & {
      __forgeAdminWatchSearchTranscriptPublication?: {
        timer?: ReturnType<typeof setTimeout>
      }
    }
  ).__forgeAdminWatchSearchTranscriptPublication
  if (state?.timer) clearTimeout(state.timer)
  delete (
    globalThis as typeof globalThis & {
      __forgeAdminWatchSearchTranscriptPublication?: unknown
    }
  ).__forgeAdminWatchSearchTranscriptPublication
}

describe("ensureWatchSearchTranscriptPublicationWorkerStarted", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    clearWorkerState()
    envMock.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED = "false"
    envMock.env.TYPESENSE_HOST = undefined
    envMock.env.TYPESENSE_OPERATOR_API_KEY = undefined
  })

  afterEach(() => {
    clearWorkerState()
    vi.useRealTimers()
  })

  it("starts when the runtime flag is the raw string true", async () => {
    envMock.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED = "true"
    envMock.env.TYPESENSE_HOST = "http://typesense.internal:8108"
    envMock.env.TYPESENSE_OPERATOR_API_KEY = "operator-key"
    const prisma = { id: "prisma" } as never

    const { ensureWatchSearchTranscriptPublicationWorkerStarted } =
      await import("./typesense-watch-search-transcript-publication")

    await expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted(prisma),
    ).resolves.toEqual({ started: true })
    expect(
      envMock.resolveWatchSearchTranscriptPublicationEnabled,
    ).toHaveBeenCalledOnce()
    expect(typesenseClientConstructor).toHaveBeenCalledWith({
      host: "http://typesense.internal:8108",
      apiKey: "operator-key",
      timeoutMs: 30_000,
    })
    expect(candidateGenerationConstructor).toHaveBeenCalledWith(
      prisma,
      expect.any(Object),
    )
  })

  it("fails worker startup when publication is enabled without operator configuration", async () => {
    envMock.env.WATCH_SEARCH_TRANSCRIPT_PUBLICATION_ENABLED = "true"
    const prisma = { id: "prisma" } as never

    const {
      ensureWatchSearchTranscriptPublicationWorkerStarted,
      WatchSearchTranscriptPublicationError,
    } = await import("./typesense-watch-search-transcript-publication")

    await expect(
      ensureWatchSearchTranscriptPublicationWorkerStarted(prisma),
    ).rejects.toBeInstanceOf(WatchSearchTranscriptPublicationError)
    expect(typesenseClientConstructor).not.toHaveBeenCalled()
    expect(candidateGenerationConstructor).not.toHaveBeenCalled()
  })

  it("continues the legacy runtime projection revision when creating the first stored row", async () => {
    envMock.resolveWatchSearchRuntimeEnv.mockReturnValue({
      defaultShadowEnabled: true,
      fleetPrimaryEnabled: false,
      candidateComparisonEnabled: false,
      transcriptProjectionRevision: 7n,
    })

    const { _internals } =
      await import("./typesense-watch-search-transcript-publication")

    expect(_internals.initialProjectionRevision()).toBe(8n)
  })

  it("allows bootstrap but rejects incremental collection or contract identity drift", async () => {
    const { _internals, WatchSearchTranscriptPublicationError } =
      await import("./typesense-watch-search-transcript-publication")
    const next = {
      transcriptCollection: "watch_search_transcripts_active_1",
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
    }

    expect(() =>
      _internals.assertIncrementalPublicationIdentity(
        {
          transcriptCollection: null,
          contentEmbeddingContractId: null,
          transcriptChunkingVersion: null,
          projectionRevision: 0n,
        },
        next,
      ),
    ).not.toThrow()
    expect(() =>
      _internals.assertIncrementalPublicationIdentity(
        { ...next, projectionRevision: 7n },
        { ...next, transcriptCollection: "watch_search_transcripts_active_2" },
      ),
    ).toThrow(WatchSearchTranscriptPublicationError)
    expect(() =>
      _internals.assertIncrementalPublicationIdentity(
        { ...next, projectionRevision: 7n },
        { ...next, contentEmbeddingContractId: "contract-v2" },
      ),
    ).toThrow(/full transcript rebuild/i)
    expect(() =>
      _internals.assertIncrementalPublicationIdentity(
        { ...next, projectionRevision: 7n },
        { ...next, transcriptChunkingVersion: "mastra-v2" },
      ),
    ).toThrow(/full transcript rebuild/i)
  })

  it("sizes the publication lease to the transcript batch and caps it", async () => {
    const { _internals } =
      await import("./typesense-watch-search-transcript-publication")

    expect(
      _internals.publicationLeaseMs({
        currentDocumentCount: 1,
        staleDocumentCount: 0,
      }),
    ).toBe(60_250)
    expect(
      _internals.publicationLeaseMs({
        currentDocumentCount: 2_000,
        staleDocumentCount: 500,
      }),
    ).toBe(300_000)
  })

  it("backs off repeated publication failures so one poison transcript cannot starve the queue", async () => {
    const { _internals } =
      await import("./typesense-watch-search-transcript-publication")

    expect(_internals.publicationRetryDelayMs(1)).toBe(5_000)
    expect(_internals.publicationRetryDelayMs(2)).toBe(10_000)
    expect(_internals.publicationRetryDelayMs(3)).toBe(20_000)
    expect(_internals.publicationRetryDelayMs(7)).toBe(300_000)
    expect(_internals.publicationRetryDelayMs(100)).toBe(300_000)
  })

  it("fingerprints numeric fields at Typesense float storage width", async () => {
    const { _internals } =
      await import("./typesense-watch-search-transcript-publication")
    const canonical = {
      id: "chunk-1",
      documentKind: "transcript" as const,
      videoId: "video-1",
      videoEditionId: "edition-1",
      canonicalVideoId: "core:video-1",
      language: "en",
      publiclyVisible: true,
      text: "Hope and fellowship",
      startSeconds: 12.3456789,
      embedding: [0.123456789, -0.987654321],
    }
    const typesenseReadback = {
      ...canonical,
      startSeconds: Math.fround(canonical.startSeconds),
      embedding: canonical.embedding.map(Math.fround),
    }

    expect(_internals.normalizeTranscriptDocument(canonical)).toEqual(
      _internals.normalizeTranscriptDocument(typesenseReadback),
    )
    expect(
      _internals.sha256(_internals.normalizeTranscriptDocument(canonical)),
    ).toBe(
      _internals.sha256(
        _internals.normalizeTranscriptDocument(typesenseReadback),
      ),
    )
  })

  it("bounds per-document readback concurrency", async () => {
    const { _internals } =
      await import("./typesense-watch-search-transcript-publication")
    let inFlight = 0
    let peakInFlight = 0

    const results = await _internals.mapWithConcurrency(
      Array.from({ length: 40 }, (_, index) => index),
      16,
      async (value) => {
        inFlight += 1
        peakInFlight = Math.max(peakInFlight, inFlight)
        await Promise.resolve()
        await Promise.resolve()
        inFlight -= 1
        return value
      },
    )

    expect(results).toEqual(Array.from({ length: 40 }, (_, index) => index))
    expect(peakInFlight).toBeLessThanOrEqual(16)
  })

  it("batches stale document filters below request-target limits", async () => {
    const { _internals } =
      await import("./typesense-watch-search-transcript-publication")
    const deleteDocumentsByFilter = vi.fn().mockResolvedValue(0)
    const ids = Array.from({ length: 205 }, (_, index) => `chunk-${index}`)

    await _internals.deleteStaleTranscriptDocuments(
      { deleteDocumentsByFilter },
      "watch_search_transcripts_active",
      ids,
    )

    expect(deleteDocumentsByFilter).toHaveBeenCalledTimes(3)
    expect(deleteDocumentsByFilter).toHaveBeenNthCalledWith(
      1,
      "watch_search_transcripts_active",
      _internals.exactIdFilter(ids.slice(0, 100)),
    )
    expect(deleteDocumentsByFilter).toHaveBeenNthCalledWith(
      2,
      "watch_search_transcripts_active",
      _internals.exactIdFilter(ids.slice(100, 200)),
    )
    expect(deleteDocumentsByFilter).toHaveBeenNthCalledWith(
      3,
      "watch_search_transcripts_active",
      _internals.exactIdFilter(ids.slice(200)),
    )
  })

  it("batches vector-bearing transcript upserts below request-body limits", async () => {
    const { _internals } =
      await import("./typesense-watch-search-transcript-publication")
    const importDocuments = vi.fn().mockResolvedValue(undefined)
    const documents = Array.from({ length: 205 }, (_, index) => ({
      id: `chunk-${index}`,
      documentKind: "transcript" as const,
      videoId: "video-1",
      videoEditionId: "edition-1",
      canonicalVideoId: "core-video-1",
      language: "en",
      publiclyVisible: true,
      text: `Chunk ${index}`,
      startSeconds: index,
      embedding: [index],
    }))

    await _internals.upsertCurrentTranscriptDocuments(
      { importDocuments },
      "watch_search_transcripts_active",
      documents,
    )

    expect(importDocuments).toHaveBeenCalledTimes(3)
    expect(importDocuments).toHaveBeenNthCalledWith(
      1,
      "watch_search_transcripts_active",
      documents.slice(0, 100),
      "upsert",
    )
    expect(importDocuments).toHaveBeenNthCalledWith(
      2,
      "watch_search_transcripts_active",
      documents.slice(100, 200),
      "upsert",
    )
    expect(importDocuments).toHaveBeenNthCalledWith(
      3,
      "watch_search_transcripts_active",
      documents.slice(200),
      "upsert",
    )
  })
})

describe("loadWatchSearchTranscriptPublicationHealth", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function fakePrisma(overrides: {
    projection?: unknown
    pendingCount?: number
    claimedCount?: number
    deadLetterCount?: number
    oldestPending?: { createdAt: Date } | null
    recentDeadLetters?: unknown[]
  }) {
    const counts = [
      overrides.pendingCount ?? 0,
      overrides.claimedCount ?? 0,
      overrides.deadLetterCount ?? 0,
    ]
    let countCallIndex = 0
    return {
      watchSearchCurrentTranscriptProjection: {
        findUnique: vi.fn(async () => overrides.projection ?? null),
      },
      watchSearchCurrentTranscriptPublicationEvent: {
        count: vi.fn(async () => counts[countCallIndex++] ?? 0),
        findFirst: vi.fn(async () => overrides.oldestPending ?? null),
        findMany: vi.fn(async () => overrides.recentDeadLetters ?? []),
      },
    }
  }

  it("reports a healthy empty outbox with no stored projection", async () => {
    const { loadWatchSearchTranscriptPublicationHealth } =
      await import("./typesense-watch-search-transcript-publication")
    const prisma = fakePrisma({})

    await expect(
      loadWatchSearchTranscriptPublicationHealth(
        prisma as never,
        new Date("2026-10-22T00:00:00.000Z"),
      ),
    ).resolves.toEqual({
      projection: null,
      pendingCount: 0,
      claimedCount: 0,
      deadLetterCount: 0,
      oldestPendingCreatedAt: null,
      oldestPendingAgeMs: null,
      stale: false,
      recentDeadLetters: [],
    })
  })

  it("surfaces the stored projection with the revision rendered as a string", async () => {
    const { loadWatchSearchTranscriptPublicationHealth } =
      await import("./typesense-watch-search-transcript-publication")
    const updatedAt = new Date("2026-10-20T00:00:00.000Z")
    const prisma = fakePrisma({
      projection: {
        transcriptCollection: "watch_search_transcripts_active",
        contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
        transcriptChunkingVersion: "mastra-v1",
        projectionRevision: 42n,
        updatedAt,
      },
    })

    const result = await loadWatchSearchTranscriptPublicationHealth(
      prisma as never,
      new Date("2026-10-22T00:00:00.000Z"),
    )

    expect(result.projection).toEqual({
      transcriptCollection: "watch_search_transcripts_active",
      contentEmbeddingContractId: "semantic-transcript-pgvector-v1",
      transcriptChunkingVersion: "mastra-v1",
      projectionRevision: "42",
      updatedAt,
    })
  })

  it("flags stale work once the oldest pending event exceeds the alert threshold", async () => {
    const { loadWatchSearchTranscriptPublicationHealth } =
      await import("./typesense-watch-search-transcript-publication")
    const now = new Date("2026-10-22T00:20:00.000Z")
    const oldestCreatedAt = new Date("2026-10-22T00:00:00.000Z") // exactly 20 minutes old
    const prisma = fakePrisma({
      pendingCount: 3,
      oldestPending: { createdAt: oldestCreatedAt },
    })

    const result = await loadWatchSearchTranscriptPublicationHealth(
      prisma as never,
      now,
    )

    expect(result.oldestPendingCreatedAt).toEqual(oldestCreatedAt)
    expect(result.oldestPendingAgeMs).toBe(20 * 60_000)
    expect(result.stale).toBe(true)
  })

  it("does not flag work within the alert threshold as stale", async () => {
    const { loadWatchSearchTranscriptPublicationHealth } =
      await import("./typesense-watch-search-transcript-publication")
    const now = new Date("2026-10-22T00:05:00.000Z")
    const oldestCreatedAt = new Date("2026-10-22T00:00:00.000Z") // 5 minutes old
    const prisma = fakePrisma({
      pendingCount: 1,
      oldestPending: { createdAt: oldestCreatedAt },
    })

    const result = await loadWatchSearchTranscriptPublicationHealth(
      prisma as never,
      now,
    )

    expect(result.oldestPendingAgeMs).toBe(5 * 60_000)
    expect(result.stale).toBe(false)
  })

  it("surfaces only identity, counts, and redacted error-class codes for dead letters", async () => {
    const { loadWatchSearchTranscriptPublicationHealth } =
      await import("./typesense-watch-search-transcript-publication")
    const deadLetteredAt = new Date("2026-10-21T12:00:00.000Z")
    const prisma = fakePrisma({
      deadLetterCount: 1,
      recentDeadLetters: [
        {
          transcriptId: "transcript-1",
          videoId: "video-1",
          videoEditionId: "edition-1",
          language: "en",
          workKind: "PUBLICATION",
          attemptCount: 8,
          lastErrorCode: "WatchSearchTranscriptPublicationError",
          deadLetteredAt,
        },
      ],
    })

    const result = await loadWatchSearchTranscriptPublicationHealth(
      prisma as never,
      new Date("2026-10-22T00:00:00.000Z"),
    )

    expect(result.deadLetterCount).toBe(1)
    expect(result.recentDeadLetters).toEqual([
      {
        transcriptId: "transcript-1",
        videoId: "video-1",
        videoEditionId: "edition-1",
        language: "en",
        workKind: "PUBLICATION",
        attemptCount: 8,
        lastErrorCode: "WatchSearchTranscriptPublicationError",
        deadLetteredAt,
      },
    ])
  })
})
