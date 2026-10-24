import type { PrismaClient } from "@prisma/client"
import { emitRevalidateWebhook } from "./revalidate-webhook"
import {
  WatchRouteManifestService,
  summarizeWatchRouteManifest,
  type WatchRouteManifestCounts,
} from "./watch-route-manifest.service"
import { WatchRouteManifestStore } from "./watch-route-manifest-store"

const ROUTE_RELEVANT_CORE_SYNC_PHASES = new Set([
  "languages",
  "videos",
  "video-dubs",
])

const WATCH_RENDER_RELEVANT_CORE_SYNC_PHASES = new Set([
  "languages",
  "videos",
  "video-images",
  "video-editions",
  "video-subtitles",
  "video-dubs",
  "video-dub-downloads",
])

export type WatchRouteManifestRefreshReason =
  | "core-sync"
  | "experience.archive"
  | "experience.publish"
  | "experience.update"
  | "operator-script"

export type WatchRouteManifestRefreshOutcome =
  | {
      status: "refreshed"
      reason: WatchRouteManifestRefreshReason
      version: string
      generatedAt: string
      payloadSizeBytes: number
      counts: WatchRouteManifestCounts
      durationMs: number
    }
  | {
      status: "skipped"
      reason: "no-route-relevant-core-sync-phases"
    }
  | {
      status: "failed"
      reason: WatchRouteManifestRefreshReason
      detail: string
      durationMs: number
    }

type CoreSyncPhaseSummary = {
  phase: string
  created?: number
  updated?: number
  softDeleted?: number
}

export function shouldRefreshWatchRouteManifestAfterCoreSync(
  phases: readonly CoreSyncPhaseSummary[],
): boolean {
  return phases.some((phase) =>
    ROUTE_RELEVANT_CORE_SYNC_PHASES.has(phase.phase),
  )
}

export function shouldInvalidateWatchRenderDataAfterCoreSync(
  phases: readonly CoreSyncPhaseSummary[],
): boolean {
  return phases.some(
    (phase) =>
      WATCH_RENDER_RELEVANT_CORE_SYNC_PHASES.has(phase.phase) &&
      ((phase.created ?? 0) > 0 ||
        (phase.updated ?? 0) > 0 ||
        (phase.softDeleted ?? 0) > 0),
  )
}

async function emitWatchRenderDataRevalidationAfterCoreSync({
  phases,
  emitWebhook,
}: {
  phases: readonly CoreSyncPhaseSummary[]
  emitWebhook: typeof emitRevalidateWebhook
}): Promise<void> {
  if (!shouldInvalidateWatchRenderDataAfterCoreSync(phases)) return
  try {
    await emitWebhook({
      model: "video",
      slug: null,
      locale: null,
    })
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "watch_render_data.revalidate.failed",
        detail:
          error instanceof Error ? error.message.slice(0, 500) : String(error),
      }),
    )
  }
}

export async function refreshWatchRouteManifest({
  prisma,
  reason,
  emitWebhook = emitRevalidateWebhook,
}: {
  prisma: PrismaClient
  reason: WatchRouteManifestRefreshReason
  emitWebhook?: typeof emitRevalidateWebhook
}): Promise<WatchRouteManifestRefreshOutcome> {
  const startedAt = Date.now()
  try {
    const service = new WatchRouteManifestService(prisma)
    const store = new WatchRouteManifestStore(prisma)
    const manifest = await service.generate()
    const snapshot = await store.upsertLatest(manifest)
    const counts = summarizeWatchRouteManifest(snapshot.payload)

    await emitWebhook({
      model: "watch-route-manifest",
      slug: null,
      locale: null,
    })

    const outcome: WatchRouteManifestRefreshOutcome = {
      status: "refreshed",
      reason,
      version: snapshot.version,
      generatedAt: snapshot.payload.generatedAt,
      payloadSizeBytes: snapshot.payloadSizeBytes,
      counts,
      durationMs: Date.now() - startedAt,
    }
    console.log(
      JSON.stringify({
        event: "watch_route_manifest.refresh.refreshed",
        reason,
        version: snapshot.version,
        ...counts,
        durationMs: outcome.durationMs,
      }),
    )
    return outcome
  } catch (error) {
    const outcome: WatchRouteManifestRefreshOutcome = {
      status: "failed",
      reason,
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }
    console.warn(
      JSON.stringify({
        event: "watch_route_manifest.refresh.failed",
        reason,
        detail: outcome.detail.slice(0, 500),
        durationMs: outcome.durationMs,
      }),
    )
    return outcome
  }
}

export async function refreshWatchRouteManifestAfterCoreSync({
  prisma,
  phases,
  emitWebhook = emitRevalidateWebhook,
}: {
  prisma: PrismaClient
  phases: readonly CoreSyncPhaseSummary[]
  emitWebhook?: typeof emitRevalidateWebhook
}): Promise<WatchRouteManifestRefreshOutcome> {
  const outcome = shouldRefreshWatchRouteManifestAfterCoreSync(phases)
    ? await refreshWatchRouteManifest({
        prisma,
        reason: "core-sync",
        emitWebhook,
      })
    : ({
        status: "skipped",
        reason: "no-route-relevant-core-sync-phases",
      } satisfies WatchRouteManifestRefreshOutcome)

  await emitWatchRenderDataRevalidationAfterCoreSync({ phases, emitWebhook })
  return outcome
}
