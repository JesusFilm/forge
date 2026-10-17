import { createHash, randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"
import { env, resolveWatchCatalogPublicationEnabled } from "@/config/env"
import {
  acquireSyncLock,
  refreshSyncLock,
  releaseSyncLock,
} from "./core-sync/lock"
import { TypesenseClient } from "./typesense-client"
import { TypesenseWatchSearchCandidateGenerationService } from "./typesense-watch-search-candidate-generation"
import {
  candidateWatchSearchIndexContractRevision,
  candidateWatchSearchRankingRevision,
} from "./typesense-watch-search-candidate-identity"
import { resolveCurrentWatchSearchTranscriptProjectionWithFallback } from "./typesense-watch-search-current-transcript-projection"
import { withTypesenseWatchSearchIndexLock } from "./typesense-watch-search-publication-lock"
import { buildTypesenseWatchCandidateProjectionSnapshot } from "./typesense-watch-search-indexer"
import {
  publishTypesenseWatchSearchCandidate,
  retireTypesenseWatchSearchCandidate,
} from "./typesense-watch-catalog-builder"
import {
  WATCH_CATALOG_PUBLICATION_ID,
  requestWatchCatalogPublication,
} from "./watch-catalog-publication"
import { refreshWatchRouteManifest } from "./watch-route-manifest-refresh.service"
import { refreshWatchSeoManifest } from "./watch-seo-manifest-refresh.service"
import {
  emitRevalidateWebhook,
  type RevalidateWebhookInput,
} from "./revalidate-webhook"

const POLL_MS = 30_000
const RECONCILE_MS = 24 * 60 * 60 * 1000
const RETAIN_INACTIVE_GENERATIONS = 1
const RETIRE_DRAIN_MS = 5 * 60 * 1000
const GENERATION_PREFIX = "core-catalog-"

async function strictWebRevalidation(input: RevalidateWebhookInput) {
  const outcome = await emitRevalidateWebhook(input)
  if (outcome.status !== "sent")
    throw new Error(`Watch cache refresh ${outcome.status}: ${outcome.reason}`)
  return outcome
}

export async function deliverWatchManifests(
  prisma: PrismaClient,
): Promise<void> {
  const route = await refreshWatchRouteManifest({
    prisma,
    reason: "core-sync",
    emitWebhook: strictWebRevalidation,
  })
  if (route.status !== "refreshed")
    throw new Error("Watch route manifest delivery failed")
  const seo = await refreshWatchSeoManifest({
    prisma,
    reason: "core-sync",
    emitWebhook: strictWebRevalidation,
  })
  if (seo.status !== "refreshed")
    throw new Error("Watch SEO manifest delivery failed")
  await strictWebRevalidation({ model: "video", slug: null, locale: null })
}

/** Native worker work, never executed inside a Workflow HTTP step. */
export async function publishPendingWatchCatalog(
  prisma: PrismaClient,
): Promise<void> {
  const initial = await prisma.watchCatalogPublication.findUnique({
    where: { id: WATCH_CATALOG_PUBLICATION_ID },
  })
  if (!initial || initial.retryAt > new Date()) return
  let pending = initial
  if (
    pending.searchVersion >= pending.requestedVersion &&
    pending.webVersion >= pending.requestedVersion
  )
    return
  // A restarted phase must retain its run's lock even after a long outage.
  // Do not take a stale Core lock away from queued native recovery.
  if (
    await prisma.coreSyncPhaseExecution.findFirst({
      where: { state: { in: ["PENDING", "RUNNING"] } },
      select: { id: true },
    })
  )
    return
  const holder = `watch-publication-${randomUUID()}`
  if (!(await acquireSyncLock(prisma, holder))) return
  let lockLost = false
  const assertLock = async () => {
    if (lockLost || !(await refreshSyncLock(prisma, holder)))
      throw new Error("Watch publication lost Core sync lock")
  }
  const heartbeat = setInterval(() => {
    void assertLock().catch(() => {
      lockLost = true
    })
  }, 30_000)
  heartbeat.unref?.()
  let version = pending.requestedVersion
  try {
    // Another worker may have completed this request while we acquired the lock.
    pending = await prisma.watchCatalogPublication.findUniqueOrThrow({
      where: { id: WATCH_CATALOG_PUBLICATION_ID },
    })
    version = pending.requestedVersion
    if (
      pending.retryAt > new Date() ||
      (pending.searchVersion >= version && pending.webVersion >= version)
    )
      return
    const activePhase = await prisma.coreSyncPhaseExecution.findFirst({
      where: { state: { in: ["PENDING", "RUNNING"] } },
      select: { id: true },
    })
    if (activePhase) return
    // A partially failed import must recover before an older pending request
    // is allowed to snapshot its committed-but-incomplete data.
    const phases = await prisma.syncState.findMany({
      select: { phase: true, stats: true },
    })
    if (
      phases.some(
        (p) =>
          typeof p.stats === "object" &&
          p.stats !== null &&
          !Array.isArray(p.stats) &&
          Number(p.stats.errors ?? 0) > 0,
      )
    )
      throw new Error("Core sync still has failed phases")

    let searchError: unknown
    try {
      if (pending.searchVersion < version) {
        await withTypesenseWatchSearchIndexLock(async () => {
          if (!env.TYPESENSE_HOST || !env.TYPESENSE_OPERATOR_API_KEY)
            throw new Error(
              "Watch catalog publication requires Typesense operator configuration",
            )
          const typesense = new TypesenseClient({
            host: env.TYPESENSE_HOST,
            apiKey: env.TYPESENSE_OPERATOR_API_KEY,
            timeoutMs: 120_000,
          })
          const generations =
            new TypesenseWatchSearchCandidateGenerationService(
              prisma,
              typesense,
            )
          const cleanupObsoleteCatalogs = async (
            buildingGenerationId?: string,
          ) => {
            // Cleanup cannot turn a successful publication into a failed delivery.
            // Active-reference guards also apply to manual retirement commands.
            try {
              const active =
                await prisma.watchCatalogPublication.findUniqueOrThrow({
                  where: { id: pending.id },
                })
              const old = await prisma.watchSearchCandidateGeneration.findMany({
                where: {
                  id: {
                    startsWith: GENERATION_PREFIX,
                    notIn: [
                      active.generationId ?? "",
                      buildingGenerationId ?? "",
                    ],
                  },
                  state: { not: "RETIRED" },
                },
                orderBy: { createdAt: "desc" },
                skip: RETAIN_INACTIVE_GENERATIONS,
              })
              for (const generation of old) {
                if (
                  generation.updatedAt.getTime() >
                  Date.now() - RETIRE_DRAIN_MS
                )
                  continue
                await retireTypesenseWatchSearchCandidate({
                  generationId: generation.id,
                  typesense,
                  generations,
                  assertDrained: async () => {
                    await assertLock()
                  },
                })
              }
            } catch (error) {
              console.warn(
                JSON.stringify({
                  event: "watch_catalog.cleanup_failed",
                  error: error instanceof Error ? error.name : "UnknownError",
                }),
              )
            }
          }
          const transcript =
            await resolveCurrentWatchSearchTranscriptProjectionWithFallback({
              prisma,
              typesense,
            })
          const { resolveWatchSearchServingProfile } =
            await import("./typesense-watch-search-serving-profile")
          const base = await resolveWatchSearchServingProfile({
            selector: env.WATCH_SEARCH_TYPESENSE_PROFILE,
            indexContractRevision: candidateWatchSearchIndexContractRevision(),
            rankingRevision: candidateWatchSearchRankingRevision(),
            transcriptProjection: transcript,
            qrelsRevision: env.WATCH_SEARCH_SERVING_QRELS_REVISION ?? null,
            typesense,
            generations,
          })
          if (base.kind !== "CANDIDATE" || !base.generationId)
            throw new Error(
              "Automatic catalog publication requires a qualified Candidate baseline",
            )
          const snapshot =
            await buildTypesenseWatchCandidateProjectionSnapshot(prisma)
          if (snapshot.counts.catalog === 0)
            throw new Error("Refusing an empty Watch catalog publication")
          const previous = pending.generationId
            ? await generations.getGeneration(pending.generationId)
            : null
          const transcriptUnchanged =
            previous?.state === "READY" &&
            previous.transcriptCollection === transcript.transcriptCollection &&
            previous.contentEmbeddingContractId ===
              transcript.contentEmbeddingContractId &&
            previous.transcriptChunkingVersion ===
              transcript.transcriptChunkingVersion &&
            previous.transcriptProjectionRevision ===
              transcript.projectionRevision
          const unchanged =
            transcriptUnchanged &&
            pending.sourceDigest === snapshot.digests.combined &&
            pending.baseGenerationId === base.generationId &&
            pending.rankingRevision === candidateWatchSearchRankingRevision()
          if (unchanged && pending.generationId) {
            // Even no-op publications recheck readiness and exact transcript identity.
            await generations.resolveGeneration({
              generationId: pending.generationId,
              indexContractRevision: base.indexContractRevision!,
              transcriptCollection: transcript.transcriptCollection,
              contentEmbeddingContractId: transcript.contentEmbeddingContractId,
              transcriptChunkingVersion: transcript.transcriptChunkingVersion,
              transcriptProjectionRevision: transcript.projectionRevision,
            })
            await prisma.watchCatalogPublication.update({
              where: { id: pending.id },
              data: { searchVersion: version, lastPublishedAt: new Date() },
            })
          } else {
            const identity = [
              version,
              base.generationId,
              snapshot.digests.combined,
              transcript.transcriptCollection,
              transcript.contentEmbeddingContractId,
              transcript.transcriptChunkingVersion,
              String(transcript.projectionRevision),
            ]
            const generationId = `${GENERATION_PREFIX}${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 32)}`
            await cleanupObsoleteCatalogs(generationId)
            await publishTypesenseWatchSearchCandidate({
              prisma,
              typesense,
              generations,
              generationId,
              indexContractRevision:
                candidateWatchSearchIndexContractRevision(),
              sourceEpoch: `core-publication:${version}`,
              transcript: {
                collection: transcript.transcriptCollection,
                contentEmbeddingContractId:
                  transcript.contentEmbeddingContractId,
                chunkingVersion: transcript.transcriptChunkingVersion,
                projectionRevision: transcript.projectionRevision,
              },
              loadSnapshot: async () => snapshot,
              publishEvaluation: false,
              batchSize: 250,
              failpoint: async () => {
                await assertLock()
              },
            })
            await assertLock()
            // The shared publication lock excludes simultaneous operator pins.
            const serving = await generations.getPointer("SERVING")
            if (serving.generationId !== base.generationId)
              throw new Error(
                "Search baseline changed during catalog publication",
              )
            await prisma.$transaction(async (tx) => {
              // Start the reader drain clock when a generation stops serving.
              if (pending.generationId && pending.generationId !== generationId)
                await tx.watchSearchCandidateGeneration.update({
                  where: { id: pending.generationId },
                  data: { updatedAt: new Date() },
                })
              await tx.watchCatalogPublication.update({
                where: { id: pending.id },
                data: {
                  generationId,
                  baseGenerationId: base.generationId,
                  rankingRevision: candidateWatchSearchRankingRevision(),
                  sourceDigest: snapshot.digests.combined,
                  searchVersion: version,
                  lastPublishedAt: new Date(),
                },
              })
            })
            console.log(
              JSON.stringify({
                event: "watch_catalog.published",
                version,
                generationId,
                baseGenerationId: base.generationId,
                counts: snapshot.counts,
              }),
            )
          }
          await cleanupObsoleteCatalogs()
        })
      }
    } catch (error) {
      searchError = error
    }
    // Web delivery is independently retryable even if Typesense is unavailable.
    let webError: unknown
    if (pending.webVersion < version) {
      try {
        await deliverWatchManifests(prisma)
        await assertLock()
        await prisma.watchCatalogPublication.update({
          where: { id: pending.id },
          data: { webVersion: version },
        })
      } catch (error) {
        webError = error
      }
    }
    if (searchError) throw searchError
    if (webError) throw webError
    await prisma.watchCatalogPublication.update({
      where: { id: pending.id },
      data: { attempts: 0, lastError: null, retryAt: new Date() },
    })
  } catch (error) {
    const attempts = pending.attempts + 1
    const message =
      error instanceof Error
        ? error.message.slice(0, 1000)
        : "Watch publication failed"
    await prisma.watchCatalogPublication.update({
      where: { id: pending.id },
      data: {
        attempts,
        lastError: message,
        retryAt: new Date(
          Date.now() +
            Math.min(15 * 60_000, 30_000 * 2 ** Math.min(attempts - 1, 5)),
        ),
      },
    })
    console.error(
      JSON.stringify({
        event: "watch_catalog.retry",
        version,
        attempts,
        error: message,
      }),
    )
  } finally {
    clearInterval(heartbeat)
    await releaseSyncLock(prisma, holder)
  }
}

type WorkerGlobal = typeof globalThis & { __watchCatalogWorker?: boolean }
export function ensureWatchCatalogPublicationWorkerStarted(
  prisma: PrismaClient,
): void {
  if (!resolveWatchCatalogPublicationEnabled()) return
  const state = globalThis as WorkerGlobal
  if (state.__watchCatalogWorker) return
  state.__watchCatalogWorker = true
  const tick = async () => {
    try {
      const pending = await prisma.watchCatalogPublication.findUnique({
        where: { id: WATCH_CATALOG_PUBLICATION_ID },
      })
      if (
        !pending ||
        pending.lastRequestedAt.getTime() < Date.now() - RECONCILE_MS
      )
        await requestWatchCatalogPublication(prisma)
      await publishPendingWatchCatalog(prisma)
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "watch_catalog.worker_failed",
          error: error instanceof Error ? error.name : "UnknownError",
        }),
      )
    }
    const timer = setTimeout(() => {
      void tick()
    }, POLL_MS)
    timer.unref?.()
  }
  void tick()
}
