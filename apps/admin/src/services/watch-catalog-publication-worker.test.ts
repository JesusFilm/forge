import type { PrismaClient, WatchCatalogPublication } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { env } from "@/config/env"

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  refresh: vi.fn(),
  release: vi.fn(),
  build: vi.fn(),
  publish: vi.fn(),
  retire: vi.fn(),
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
vi.mock("./typesense-watch-search-indexer", () => ({
  buildTypesenseWatchCandidateProjectionSnapshot: mocks.build,
}))
vi.mock("./typesense-watch-catalog-builder", () => ({
  publishTypesenseWatchSearchCandidate: mocks.publish,
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
import { candidateWatchSearchRankingRevision } from "./typesense-watch-search-candidate-identity"

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
      syncState: {
        findMany: vi.fn(async () => [
          { phase: "videos", stats: { errors: phaseErrors } },
        ]),
      },
      coreSyncPhaseExecution: {
        findFirst: vi.fn(async () => (activePhase ? { id: "running" } : null)),
      },
      watchSearchCandidateGeneration: {
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
    mocks.build.mockResolvedValue({
      counts: { catalog: 2, lexical: 2, availability: 2 },
      digests: { combined: "content-1" },
    })
    mocks.publish.mockResolvedValue({ state: "READY" })
  })

  it("acknowledges manifests and indexing only after each succeeds", async () => {
    await publishPendingWatchCatalog(prisma)
    expect(row).toMatchObject({
      requestedVersion: 1,
      searchVersion: 1,
      webVersion: 1,
      baseGenerationId: "qualified-baseline",
      lastError: null,
    })
    expect(row.generationId).toMatch(/^core-catalog-/)
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({ publishEvaluation: false }),
    )
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it("keeps the serving catalog when indexing fails and retries the same immutable build", async () => {
    row.generationId = "previous"
    mocks.publish.mockRejectedValueOnce(new Error("Typesense unavailable"))
    await publishPendingWatchCatalog(prisma)
    expect(row).toMatchObject({
      generationId: "previous",
      searchVersion: 0,
      webVersion: 1,
      attempts: 1,
    })
    const firstGeneration = mocks.publish.mock.calls[0][0].generationId
    row.retryAt = new Date(0)
    await publishPendingWatchCatalog(prisma)
    expect(row.searchVersion).toBe(1)
    expect(mocks.publish.mock.calls[1][0].generationId).toBe(firstGeneration)
    expect(mocks.route).toHaveBeenCalledTimes(1)
  })

  it("publishes search while a failed Web delivery remains pending, then retries only Web", async () => {
    mocks.webhook.mockResolvedValueOnce({ status: "failed", reason: "non_2xx" })
    await publishPendingWatchCatalog(prisma)
    expect(row).toMatchObject({ searchVersion: 1, webVersion: 0, attempts: 1 })
    row.retryAt = new Date(0)
    await publishPendingWatchCatalog(prisma)
    expect(row).toMatchObject({ searchVersion: 1, webVersion: 1, attempts: 0 })
    expect(mocks.publish).toHaveBeenCalledTimes(1)
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
    expect(mocks.build).not.toHaveBeenCalled()
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
    expect(mocks.build).not.toHaveBeenCalled()
    expect(row.searchVersion).toBe(2)
  })

  it("preserves another request arriving during delivery", async () => {
    mocks.publish.mockImplementation(async () => {
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
    expect(row.generationId).toBeNull()
    expect(row.searchVersion).toBe(0)
    expect(row.lastError).toContain("baseline changed")
  })

  it("reuses a validated unchanged snapshot without rebuilding collections", async () => {
    Object.assign(row, {
      generationId: "previous",
      baseGenerationId: "qualified-baseline",
      rankingRevision: candidateWatchSearchRankingRevision(),
      sourceDigest: "content-1",
    })
    mocks.previous.mockResolvedValue({
      state: "READY",
      transcriptCollection: "transcripts",
      contentEmbeddingContractId: "embedding-v2",
      transcriptChunkingVersion: "chunks-v2",
      transcriptProjectionRevision: 1n,
    })
    await publishPendingWatchCatalog(prisma)
    expect(mocks.publish).not.toHaveBeenCalled()
    expect(mocks.resolve).toHaveBeenCalled()
    expect(row.searchVersion).toBe(1)
  })
})
