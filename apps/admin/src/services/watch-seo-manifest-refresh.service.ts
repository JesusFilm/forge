import type { PrismaClient } from "@prisma/client"
import { emitRevalidateWebhook } from "./revalidate-webhook"
import {
  WatchSeoManifestService,
  summarizeWatchSeoManifest,
  type WatchSeoManifestCounts,
} from "./watch-seo-manifest.service"
import { WatchSeoManifestStore } from "./watch-seo-manifest-store"

const SEO_RELEVANT_CORE_SYNC_PHASES = new Set([
  "languages",
  "videos",
  "video-dubs",
])

export type WatchSeoManifestRefreshReason = "core-sync" | "operator-script"

export type WatchSeoManifestRefreshOutcome =
  | {
      status: "refreshed"
      reason: WatchSeoManifestRefreshReason
      version: string
      generatedAt: string
      payloadSizeBytes: number
      counts: WatchSeoManifestCounts
      durationMs: number
    }
  | {
      status: "skipped"
      reason: "no-seo-relevant-core-sync-phases"
    }
  | {
      status: "failed"
      reason: WatchSeoManifestRefreshReason
      detail: string
      durationMs: number
    }

type CoreSyncPhaseSummary = {
  phase: string
  created?: number
  updated?: number
  softDeleted?: number
}

export function shouldRefreshWatchSeoManifestAfterCoreSync(
  phases: readonly CoreSyncPhaseSummary[],
): boolean {
  return phases.some((phase) => SEO_RELEVANT_CORE_SYNC_PHASES.has(phase.phase))
}

export async function refreshWatchSeoManifest({
  prisma,
  reason,
  emitWebhook = emitRevalidateWebhook,
}: {
  prisma: PrismaClient
  reason: WatchSeoManifestRefreshReason
  emitWebhook?: typeof emitRevalidateWebhook
}): Promise<WatchSeoManifestRefreshOutcome> {
  const startedAt = Date.now()
  try {
    const service = new WatchSeoManifestService(prisma)
    const store = new WatchSeoManifestStore(prisma)
    const manifest = await service.generate()
    const snapshot = await store.upsertLatest(manifest)
    const counts = summarizeWatchSeoManifest(snapshot.payload)

    await emitWebhook({
      model: "watch-seo-manifest",
      slug: null,
      locale: null,
    })

    const outcome: WatchSeoManifestRefreshOutcome = {
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
        event: "watch_seo_manifest.refresh.refreshed",
        reason,
        version: snapshot.version,
        ...counts,
        durationMs: outcome.durationMs,
      }),
    )
    return outcome
  } catch (error) {
    const outcome: WatchSeoManifestRefreshOutcome = {
      status: "failed",
      reason,
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    }
    console.warn(
      JSON.stringify({
        event: "watch_seo_manifest.refresh.failed",
        reason,
        detail: outcome.detail.slice(0, 500),
        durationMs: outcome.durationMs,
      }),
    )
    return outcome
  }
}

export async function refreshWatchSeoManifestAfterCoreSync({
  prisma,
  phases,
  emitWebhook = emitRevalidateWebhook,
}: {
  prisma: PrismaClient
  phases: readonly CoreSyncPhaseSummary[]
  emitWebhook?: typeof emitRevalidateWebhook
}): Promise<WatchSeoManifestRefreshOutcome> {
  if (!shouldRefreshWatchSeoManifestAfterCoreSync(phases)) {
    return {
      status: "skipped",
      reason: "no-seo-relevant-core-sync-phases",
    }
  }

  return refreshWatchSeoManifest({
    prisma,
    reason: "core-sync",
    emitWebhook,
  })
}
