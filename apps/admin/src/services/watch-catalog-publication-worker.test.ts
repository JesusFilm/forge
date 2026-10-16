import type { PrismaClient, WatchCatalogPublication } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  refresh: vi.fn(),
  release: vi.fn(),
  bootstrap: vi.fn(),
  apply: vi.fn(),
  cleanup: vi.fn(),
  curations: vi.fn(),
  retire: vi.fn(),
  dirty: vi.fn(),
  route: vi.fn(),
  seo: vi.fn(),
  webhook: vi.fn(),
  baseline: vi.fn(),
  previous: vi.fn(),
  resolve: vi.fn(),
  pointer: vi.fn(),
}))
vi.mock("./core-sync/lock", () => ({
  acquireSyncLock: mocks.acquire,
  refreshSyncLock: mocks.refresh,
  releaseSyncLock: mocks.release,
}))
vi.mock("./watch-catalog-live-index", () => ({
  bootstrapLiveWatchCatalog: mocks.bootstrap,
  applyLiveWatchCatalogChanges: mocks.apply,
  cleanupRetiredLiveWatchCatalogs: mocks.cleanup,
  refreshLiveWatchCurations: mocks.curations,
  LiveWatchSchemaExpansionError: class extends Error {
    constructor(readonly field: string) {
      super(field)
    }
  },
}))
vi.mock("./typesense-watch-catalog-builder", () => ({
  retireTypesenseWatchSearchCandidate: mocks.retire,
}))
vi.mock("./typesense-client", () => ({ TypesenseClient: class {} }))
vi.mock("./typesense-watch-search-candidate-generation", () => ({
  TypesenseWatchSearchCandidateGenerationService: class {
    getGeneration = mocks.previous
    resolveGeneration = mocks.resolve
    getPointer = mocks.pointer
  },
}))
vi.mock("./typesense-watch-search-current-transcript-projection", () => ({
  resolveCurrentWatchSearchTranscriptProjectionWithFallback: async () => ({
    transcriptCollection: "transcripts",
    contentEmbeddingContractId: "embedding-v2",
    transcriptChunkingVersion: "chunks-v2",
    projectionRevision: 1n,
  }),
}))
vi.mock("./typesense-watch-search-publication-lock", () => ({
  withTypesenseWatchSearchIndexLock: async (fn: () => Promise<unknown>) => fn(),
}))
vi.mock("./typesense-watch-search-serving-profile", () => ({
  resolveWatchSearchServingProfile: mocks.baseline,
}))
vi.mock("./watch-route-manifest-refresh.service", () => ({
  refreshWatchRouteManifest: mocks.route,
}))
vi.mock("./watch-seo-manifest-refresh.service", () => ({
  refreshWatchSeoManifest: mocks.seo,
}))
vi.mock("./revalidate-webhook", () => ({
  emitRevalidateWebhook: mocks.webhook,
}))
import {
  deliverWatchManifests,
  publishPendingWatchCatalog,
} from "./watch-catalog-publication-worker"
import { LiveWatchSchemaExpansionError } from "./watch-catalog-live-index"

describe("retryable Watch catalog delivery", () => {
  let row: WatchCatalogPublication
  let prisma: PrismaClient
  let phaseErrors: number
  let activePhase: boolean
  beforeEach(() => {
    vi.resetAllMocks()
    Object.assign(env, {
      TYPESENSE_HOST: "http://typesense.test",
      TYPESENSE_OPERATOR_API_KEY: "test-operator",
    })
    phaseErrors = 0
    activePhase = false
    row = {
      id: "core",
      requestedVersion: 1,
      searchVersion: 0,
      webVersion: 0,
      baseGenerationId: null,
      generationId: null,
      rankingRevision: null,
      sourceDigest: null,
      liveCollectionId: null,
      liveUpdating: false,
      liveLexicalFields: null,
      retiredLive: [],
      buildingLiveCollectionId: null,
      liveCurationDigest: null,
      liveCurationInFlight: false,
      lastRequestedAt: new Date(),
      lastPublishedAt: null,
      retryAt: new Date(0),
      attempts: 0,
      lastError: null,
      updatedAt: new Date(),
    }
    const db = {
      watchCatalogPublication: {
        findUnique: vi.fn(async () => ({ ...row })),
        findUniqueOrThrow: vi.fn(async () => ({ ...row })),
        update: vi.fn(
          async ({ data }: { data: Partial<WatchCatalogPublication> }) =>
            Object.assign(row, data),
        ),
      },
      watchCatalogDirtyVideo: { findFirst: mocks.dirty },
      syncState: {
        findMany: vi.fn(async () => [
          { phase: "videos", stats: { errors: phaseErrors } },
        ]),
      },
      coreSyncPhaseExecution: {
        findFirst: vi.fn(async () => (activePhase ? { id: "running" } : null)),
      },
      watchSearchCandidateGeneration: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        update: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(db),
      ),
    }
    prisma = db as unknown as PrismaClient
    mocks.acquire.mockResolvedValue(true)
    mocks.refresh.mockResolvedValue(true)
    mocks.release.mockResolvedValue(true)
    mocks.route.mockResolvedValue({ status: "refreshed" })
    mocks.seo.mockResolvedValue({ status: "refreshed" })
    mocks.webhook.mockResolvedValue({ status: "sent" })
    mocks.baseline.mockResolvedValue({
      kind: "CANDIDATE",
      generationId: "qualified-baseline",
      indexContractRevision: "contract",
    })
    mocks.pointer.mockResolvedValue({ generationId: "qualified-baseline" })
    mocks.dirty.mockResolvedValue(null)
    mocks.bootstrap.mockImplementation(
      async ({ liveId }: { liveId: string }) => {
        row.liveCollectionId = liveId
        row.buildingLiveCollectionId = null
        row.liveUpdating = true
      },
    )
    mocks.apply.mockResolvedValue(0)
    mocks.cleanup.mockResolvedValue(undefined)
    mocks.curations.mockResolvedValue(false)
  })

  it("acknowledges manifests and indexing only after each succeeds", async () => {
    await publishPendingWatchCatalog(prisma)
    expect(row).toMatchObject({
      requestedVersion: 1,
      searchVersion: 1,
      webVersion: 1,
      baseGenerationId: "qualified-baseline",
      liveUpdating: false,
      lastError: null,
    })
    expect(mocks.bootstrap).toHaveBeenCalledOnce()
    expect(mocks.apply).toHaveBeenCalledOnce()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("retries a failed live catalog bootstrap without repeating Web delivery", async () => {
    row.generationId = "previous"
    mocks.bootstrap.mockImplementationOnce(
      async ({ liveId }: { liveId: string }) => {
        row.buildingLiveCollectionId = liveId
        throw new Error("Typesense unavailable")
      },
    )
    await publishPendingWatchCatalog(prisma)
    expect(row).toMatchObject({
      generationId: "previous",
      searchVersion: 0,
      webVersion: 1,
      attempts: 1,
    })
    const firstGeneration = mocks.bootstrap.mock.calls[0][0].liveId
    row.retryAt = new Date(0)
    await publishPendingWatchCatalog(prisma)
    expect(row.searchVersion).toBe(1)
    expect(mocks.bootstrap.mock.calls[1][0].liveId).toBe(firstGeneration)
    expect(mocks.route).toHaveBeenCalledTimes(1)
  })

  it("publishes search while a failed Web delivery remains pending, then retries only Web", async () => {
    mocks.webhook.mockResolvedValueOnce({ status: "failed", reason: "non_2xx" })
    await publishPendingWatchCatalog(prisma)
    expect(row).toMatchObject({ searchVersion: 1, webVersion: 0, attempts: 1 })
    row.retryAt = new Date(0)
    await publishPendingWatchCatalog(prisma)
    expect(row).toMatchObject({ searchVersion: 1, webVersion: 1, attempts: 0 })
    expect(mocks.apply).toHaveBeenCalledTimes(1)
  })

  it("treats missing webhook configuration as incomplete delivery", async () => {
    mocks.webhook.mockResolvedValue({
      status: "skipped",
      reason: "config_missing",
    })
    await expect(deliverWatchManifests(prisma)).rejects.toThrow(
      "config_missing",
    )
  })

  it("does not publish committed partial data from an active or failed import", async () => {
    activePhase = true
    await publishPendingWatchCatalog(prisma)
    expect(mocks.acquire).not.toHaveBeenCalled()
    activePhase = false
    phaseErrors = 1
    await publishPendingWatchCatalog(prisma)
    expect(mocks.bootstrap).not.toHaveBeenCalled()
    expect(mocks.route).not.toHaveBeenCalled()
    expect(row.searchVersion).toBe(0)
  })

  it("rereads the request under the source lock to avoid regressing an already completed version", async () => {
    mocks.acquire.mockImplementation(async () => {
      row.requestedVersion = 2
      row.searchVersion = 2
      row.webVersion = 2
      return true
    })
    await publishPendingWatchCatalog(prisma)
    expect(mocks.bootstrap).not.toHaveBeenCalled()
    expect(row.searchVersion).toBe(2)
  })

  it("preserves another request arriving during delivery", async () => {
    mocks.apply.mockImplementation(async () => {
      row.requestedVersion = 2
    })
    await publishPendingWatchCatalog(prisma)
    expect(row).toMatchObject({
      requestedVersion: 2,
      searchVersion: 1,
      webVersion: 1,
    })
  })

  it("refuses activation if the qualified baseline changes during the build", async () => {
    mocks.pointer.mockResolvedValue({ generationId: "different-baseline" })
    await publishPendingWatchCatalog(prisma)
    expect(row.searchVersion).toBe(0)
    expect(row.liveUpdating).toBe(true)
    expect(row.lastError).toContain("baseline changed")
  })

  it("processes queued source changes even when version counters are equal", async () => {
    row.searchVersion = 1
    row.webVersion = 1
    mocks.dirty.mockResolvedValue({ videoId: "changed-video" })
    await publishPendingWatchCatalog(prisma)
    expect(mocks.apply).toHaveBeenCalledOnce()
    expect(mocks.route).not.toHaveBeenCalled()
  })

  it("replays an unacknowledged curation write with equal publication counters", async () => {
    row.searchVersion = 1
    row.webVersion = 1
    row.liveCurationInFlight = true
    await publishPendingWatchCatalog(prisma)
    expect(mocks.curations).toHaveBeenCalledOnce()
    expect(mocks.route).not.toHaveBeenCalled()
  })

  it("keeps private probes fenced after a curation-only write fails", async () => {
    row.liveCollectionId = "core-live-current"
    row.baseGenerationId = "qualified-baseline"
    mocks.curations.mockRejectedValueOnce(new Error("curation response lost"))
    await publishPendingWatchCatalog(prisma)
    expect(row.liveUpdating).toBe(true)
    expect(row.searchVersion).toBe(0)
    row.retryAt = new Date(0)
    await publishPendingWatchCatalog(prisma)
    expect(row.liveUpdating).toBe(false)
    expect(row.searchVersion).toBe(1)
  })

  it("rebuilds a distinct live collection when a new locale needs a lexical field", async () => {
    row.liveCollectionId = "core-live-current"
    row.baseGenerationId = "qualified-baseline"
    mocks.apply
      .mockRejectedValueOnce(new LiveWatchSchemaExpansionError("title_sw"))
      .mockResolvedValueOnce(0)
    await publishPendingWatchCatalog(prisma)
    expect(mocks.bootstrap).toHaveBeenCalledOnce()
    expect(mocks.bootstrap.mock.calls[0][0].liveId).toMatch(/^core-live-/)
    expect(mocks.bootstrap.mock.calls[0][0].liveId).not.toBe(
      "core-live-current",
    )
    expect(row.searchVersion).toBe(1)
  })

  it("does not reuse a recently served collection across baseline A-B-A", async () => {
    await publishPendingWatchCatalog(prisma)
    const first = row.liveCollectionId
    row.requestedVersion = 2
    mocks.baseline.mockResolvedValue({
      kind: "CANDIDATE",
      generationId: "baseline-b",
      indexContractRevision: "contract",
    })
    mocks.pointer.mockResolvedValue({ generationId: "baseline-b" })
    await publishPendingWatchCatalog(prisma)
    expect(row.liveCollectionId).not.toBe(first)
    row.requestedVersion = 3
    mocks.baseline.mockResolvedValue({
      kind: "CANDIDATE",
      generationId: "qualified-baseline",
      indexContractRevision: "contract",
    })
    mocks.pointer.mockResolvedValue({ generationId: "qualified-baseline" })
    await publishPendingWatchCatalog(prisma)
    expect(row.liveCollectionId).not.toBe(first)
  })
})
