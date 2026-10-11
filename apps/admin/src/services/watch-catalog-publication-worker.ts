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
  bootstrapLiveWatchCatalog,
  applyLiveWatchCatalogChanges,
  LiveWatchSchemaExpansionError,
  cleanupRetiredLiveWatchCatalogs,
  refreshLiveWatchCurations,
} from "./watch-catalog-live-index"
import { retireTypesenseWatchSearchCandidate } from "./typesense-watch-catalog-builder"
import {
  candidateWatchSearchIndexContractRevision,
  candidateWatchSearchRankingRevision,
} from "./typesense-watch-search-candidate-identity"
import { resolveCurrentWatchSearchTranscriptProjectionWithFallback } from "./typesense-watch-search-current-transcript-projection"
import { withTypesenseWatchSearchIndexLock } from "./typesense-watch-search-publication-lock"
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
const RETIRE_DRAIN_MS = 5 * 60_000

async function hasRetirableCatalog(
  prisma: PrismaClient,
  retiredLive: unknown,
): Promise<boolean> {
  if (
    Array.isArray(retiredLive) &&
    retiredLive.some(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        "after" in entry &&
        typeof entry.after === "string" &&
        new Date(entry.after).getTime() <= Date.now(),
    )
  )
    return true
  return !!(await prisma.watchSearchCandidateGeneration.findFirst({
    where: {
      id: { startsWith: "core-catalog-" },
      state: { not: "RETIRED" },
      updatedAt: { lt: new Date(Date.now() - RETIRE_DRAIN_MS) },
    },
    select: { id: true },
  }))
}

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
    pending.webVersion >= pending.requestedVersion &&
    !pending.liveUpdating &&
    !pending.liveCurationInFlight &&
    !(await prisma.watchCatalogDirtyVideo.findFirst({
      select: { videoId: true },
    })) &&
    !(await hasRetirableCatalog(prisma, pending.retiredLive))
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
      (pending.searchVersion >= version &&
        pending.webVersion >= version &&
        !pending.liveUpdating &&
        !pending.liveCurationInFlight &&
        !(await prisma.watchCatalogDirtyVideo.findFirst({
          select: { videoId: true },
        })) &&
        !(await hasRetirableCatalog(prisma, pending.retiredLive)))
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
      if (
        pending.searchVersion < version ||
        pending.liveUpdating ||
        pending.liveCurationInFlight ||
        (await prisma.watchCatalogDirtyVideo.findFirst({
          select: { videoId: true },
        })) ||
        (await hasRetirableCatalog(prisma, pending.retiredLive))
      ) {
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
          // Fence private probes until content, curations, and the final
          // publication identity have all been acknowledged, even when this
          // request has no dirty video rows.
          await prisma.watchCatalogPublication.update({
            where: { id: pending.id },
            data: { liveUpdating: true },
          })
          const livePrefix = `core-live-${createHash("sha256")
            .update(`${base.generationId}:${base.indexContractRevision}`)
            .digest("hex")
            .slice(0, 8)}-`
          let liveId = `${livePrefix}${randomUUID().replaceAll("-", "").slice(0, 16)}`
          if (
            pending.liveCollectionId &&
            pending.baseGenerationId === base.generationId
          )
            liveId = pending.liveCollectionId
          else if (pending.buildingLiveCollectionId?.startsWith(livePrefix))
            liveId = pending.buildingLiveCollectionId
          if (
            pending.liveCollectionId !== liveId ||
            pending.baseGenerationId !== base.generationId
          ) {
            await bootstrapLiveWatchCatalog({
              prisma,
              typesense,
              liveId,
              assertLock,
            })
          }
          let changed: number
          try {
            changed = await applyLiveWatchCatalogChanges({
              prisma,
              typesense,
              liveId,
              assertLock,
            })
          } catch (error) {
            if (!(error instanceof LiveWatchSchemaExpansionError)) throw error
            const expandedId =
              pending.buildingLiveCollectionId?.startsWith(livePrefix) &&
              pending.buildingLiveCollectionId !== liveId
                ? pending.buildingLiveCollectionId
                : `${livePrefix}${randomUUID().replaceAll("-", "").slice(0, 16)}`
            await bootstrapLiveWatchCatalog({
              prisma,
              typesense,
              liveId: expandedId,
              assertLock,
            })
            liveId = expandedId
            changed = await applyLiveWatchCatalogChanges({
              prisma,
              typesense,
              liveId,
              assertLock,
            })
          }
          await refreshLiveWatchCurations({ prisma, typesense, liveId })
          await assertLock()
          const serving = await generations.getPointer("SERVING")
          if (serving.generationId !== base.generationId)
            throw new Error(
              "Search baseline changed during catalog publication",
            )
          await prisma.watchCatalogPublication.update({
            where: { id: pending.id },
            data: {
              baseGenerationId: base.generationId,
              rankingRevision: candidateWatchSearchRankingRevision(),
              searchVersion: version,
              lastPublishedAt: new Date(),
              liveUpdating: false,
            },
          })
          console.log(
            JSON.stringify({
              event: "watch_catalog.incremental_published",
              version,
              liveId,
              changed,
            }),
          )
          // Retire only automatically owned content copies after a reader
          // drain. Candidate pointer and lease guards remain authoritative.
          try {
            await cleanupRetiredLiveWatchCatalogs({
              prisma,
              typesense,
              assertLock,
            })
            const obsolete =
              await prisma.watchSearchCandidateGeneration.findMany({
                where: {
                  id: { startsWith: "core-catalog-" },
                  state: { not: "RETIRED" },
                  updatedAt: { lt: new Date(Date.now() - RETIRE_DRAIN_MS) },
                },
                select: { id: true },
              })
            for (const generation of obsolete)
              await retireTypesenseWatchSearchCandidate({
                generationId: generation.id,
                typesense,
                generations,
                assertDrained: assertLock,
              })
          } catch (error) {
            console.warn(
              JSON.stringify({
                event: "watch_catalog.cleanup_failed",
                error: error instanceof Error ? error.message : "UnknownError",
              }),
            )
          }
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
