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
}

export function shouldRefreshWatchRouteManifestAfterCoreSync(
  phases: readonly CoreSyncPhaseSummary[],
): boolean {
  return phases.some((phase) =>
    ROUTE_RELEVANT_CORE_SYNC_PHASES.has(phase.phase),
  )
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
}: {
  prisma: PrismaClient
  phases: readonly CoreSyncPhaseSummary[]
}): Promise<WatchRouteManifestRefreshOutcome> {
  if (!shouldRefreshWatchRouteManifestAfterCoreSync(phases)) {
    return {
      status: "skipped",
      reason: "no-route-relevant-core-sync-phases",
    }
  }
  return refreshWatchRouteManifest({ prisma, reason: "core-sync" })
}
