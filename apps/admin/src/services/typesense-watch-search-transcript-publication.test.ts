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
})
