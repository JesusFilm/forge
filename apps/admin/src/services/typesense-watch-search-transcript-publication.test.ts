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

    const { _internals } = await import(
      "./typesense-watch-search-transcript-publication"
    )

    expect(_internals.initialProjectionRevision()).toBe(8n)
  })
})
