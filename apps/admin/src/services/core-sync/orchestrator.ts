// Core sync orchestrator — runs all phases in canonical order.
//
// Mirrors the CMS core-sync.ts pattern but uses:
//   - Prisma instead of Strapi Document Service
//   - DB-backed lock (SyncLock) instead of in-memory flag
//   - Per-phase watermark (SyncState) with capture-before-fetch semantics
//   - Post-phase ANALYZE for query planner stats
//
// Phase order: languages → countries → keywords → video-origins → videos → video-images → video-editions → video-subtitles → video-dubs → video-dub-downloads
// Later phases resolve coreId → id maps from earlier ones.

import type { PrismaClient } from "@prisma/client"
import {
  PHASE_ORDER,
  type SyncPhase,
  type SyncStats,
  type ProgressReporter,
  type PhaseRunner,
  type SyncPhaseProgress,
  emptySyncStats,
} from "./types"
import { acquireSyncLock, refreshSyncLock, releaseSyncLock } from "./lock"
import {
  getWatermark,
  advanceWatermark,
  updateStatsOnly,
  getAllWatermarks,
} from "./watermark"
import { syncLanguages } from "./phases/sync-languages"
import { syncCountries } from "./phases/sync-countries"
import { syncKeywords } from "./phases/sync-keywords"
import { syncVideoOrigins } from "./phases/sync-video-origins"
import { syncVideos } from "./phases/sync-videos"
import { syncVideoImages } from "./phases/sync-video-images"
import { syncVideoEditions } from "./phases/sync-video-editions"
import { syncVideoSubtitles } from "./phases/sync-video-subtitles"
import { syncDubs } from "./phases/sync-dubs"
import { syncDubDownloads } from "./phases/sync-dub-downloads"
import { runCoverageAudit, type CoverageAudit } from "./coverage-audit"
import { refreshWatchRouteManifestAfterCoreSync } from "../watch-route-manifest-refresh.service"
import { refreshWatchSeoManifestAfterCoreSync } from "../watch-seo-manifest-refresh.service"

const PHASE_RUNNERS: Record<SyncPhase, PhaseRunner> = {
  languages: syncLanguages,
  countries: syncCountries,
  keywords: syncKeywords,
  "video-origins": syncVideoOrigins,
  videos: syncVideos,
  "video-images": syncVideoImages,
  "video-editions": syncVideoEditions,
  "video-subtitles": syncVideoSubtitles,
  "video-dubs": syncDubs,
  "video-dub-downloads": syncDubDownloads,
}

// Tables to ANALYZE after each phase completes
const PHASE_TABLES: Record<SyncPhase, string[]> = {
  languages: ["language"],
  countries: ["country", "continent", "country_language"],
  keywords: ["keyword"],
  "video-origins": ["video_origin"],
  videos: ["video", "video_locale"],
  "video-images": ["video_image"],
  "video-editions": ["video_edition"],
  "video-subtitles": ["video_subtitle"],
  "video-dubs": ["video_dub", "mux_video"],
  "video-dub-downloads": ["video_dub_download"],
}

const LOCK_HEARTBEAT_INTERVAL_MS = 60_000
const PROGRESS_REPORT_INTERVAL_MS = 30_000

export type PhaseResult = SyncStats & { phase: string; durationMs: number }

export type SyncResult = {
  skipped?: boolean
  incremental: boolean
  phases: PhaseResult[]
  durationMs: number
  coverageAudit?: CoverageAudit
}

export type SyncRunContext = {
  runId: string
  incremental: boolean
  phasesToRun: SyncPhase[]
  startedAtMs: number
}

export type SyncRunStart =
  | { skipped: true; result: SyncResult }
  | { skipped: false; run: SyncRunContext }

export type RunSyncPhaseOptions = {
  onProgress?: (progress: SyncPhaseProgress) => void
}

export type RunSyncOptions = {
  scope?: string | string[]
  incremental?: boolean
  onProgress?: (progress: SyncPhaseProgress) => void
}

export function resolveScope(input?: string | string[]): SyncPhase[] {
  if (!input) return [...PHASE_ORDER]
  const items = Array.isArray(input) ? input : [input]
  if (items.includes("all")) return [...PHASE_ORDER]
  const requested = new Set(items)
  return PHASE_ORDER.filter((p) => requested.has(p))
}

export async function getSyncStatus(prisma: PrismaClient) {
  const watermarks = await getAllWatermarks(prisma)
  const coverageAudit = await runCoverageAudit(prisma).catch(() => undefined)
  return { watermarks, coverageAudit }
}

export async function startSyncRun(
  prisma: PrismaClient,
  options?: { scope?: string | string[]; incremental?: boolean },
): Promise<SyncRunStart> {
  const incremental = options?.incremental ?? true
  const phasesToRun = resolveScope(options?.scope)

  if (phasesToRun.length === 0) {
    return {
      skipped: true,
      result: { skipped: true, incremental, phases: [], durationMs: 0 },
    }
  }

  const runId = `sync-${Date.now()}`
  const locked = await acquireSyncLock(prisma, runId)
  if (!locked) {
    console.log(
      JSON.stringify({
        event: "core-sync.skipped",
        reason: "lock_held",
        service: "forge-admin",
      }),
    )
    return {
      skipped: true,
      result: { skipped: true, incremental, phases: [], durationMs: 0 },
    }
  }

  return {
    skipped: false,
    run: {
      runId,
      incremental,
      phasesToRun,
      startedAtMs: Date.now(),
    },
  }
}

export async function runSyncPhase(
  prisma: PrismaClient,
  run: SyncRunContext,
  phase: SyncPhase,
  options: RunSyncPhaseOptions = {},
): Promise<PhaseResult> {
  const ownsLock = await refreshSyncLock(prisma, run.runId)
  if (!ownsLock) {
    throw new Error(`Core sync lock lost before ${phase}`)
  }

  const phaseStart = Date.now()
  const heartbeat = setInterval(() => {
    void refreshSyncLock(prisma, run.runId).catch(() => {})
  }, LOCK_HEARTBEAT_INTERVAL_MS)
  heartbeat.unref?.()

  try {
    const progress = createProgressReporter({
      phase,
      phaseStart,
      onProgress: options.onProgress,
    })

    let since: string | undefined
    if (run.incremental) {
      since = (await getWatermark(prisma, phase)) ?? undefined
    }

    // Capture fetch-start time BEFORE issuing the Core query.
    // This is the watermark value — NOT the completion time.
    const fetchStartedAt = new Date().toISOString()

    let stats: SyncStats
    try {
      const runner = PHASE_RUNNERS[phase]
      stats = await runner({ prisma, progress, since })
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "core-sync.phase.error",
          phase,
          error: err instanceof Error ? err.message : String(err),
          service: "forge-admin",
        }),
      )
      stats = { ...emptySyncStats, errors: 1 }
    }

    // Advance watermark only on zero errors
    if (stats.errors === 0) {
      await advanceWatermark(prisma, phase, fetchStartedAt, stats)
    } else {
      await updateStatsOnly(prisma, phase, stats).catch(() => {})
    }

    // ANALYZE modified tables for query planner
    const tables = PHASE_TABLES[phase] ?? []
    for (const table of tables) {
      await prisma.$executeRawUnsafe(`ANALYZE "${table}"`).catch(() => {})
    }

    const result = {
      phase,
      ...stats,
      durationMs: Date.now() - phaseStart,
    }

    console.log(
      JSON.stringify({
        event: "core-sync.phase.complete",
        phase,
        ...stats,
        durationMs: result.durationMs,
        service: "forge-admin",
      }),
    )

    return result
  } finally {
    clearInterval(heartbeat)
  }
}

function createProgressReporter({
  phase,
  phaseStart,
  onProgress,
}: {
  phase: SyncPhase
  phaseStart: number
  onProgress?: (progress: SyncPhaseProgress) => void
}): ProgressReporter {
  let completed = 0
  let total = 0
  let lastReportedAt = 0
  let hasReported = false

  function report(force = false) {
    if (!onProgress) return

    const now = Date.now()
    if (
      !force &&
      hasReported &&
      now - lastReportedAt < PROGRESS_REPORT_INTERVAL_MS
    ) {
      return
    }

    hasReported = true
    lastReportedAt = now
    onProgress({
      phase,
      completed,
      total,
      elapsedMs: now - phaseStart,
    })
  }

  return {
    setTotal: (nextTotal) => {
      total = Math.max(total, nextTotal)
      report(!hasReported)
    },
    increment: (count = 1) => {
      completed += count
      report()
    },
  }
}

export async function finishSyncRun(
  prisma: PrismaClient,
  run: SyncRunContext,
  phases: PhaseResult[],
): Promise<SyncResult> {
  await releaseSyncLock(prisma, run.runId).catch(() => {})

  const coverageAudit = await runCoverageAudit(prisma).catch(() => undefined)
  await refreshWatchRouteManifestAfterCoreSync({ prisma, phases })
  await refreshWatchSeoManifestAfterCoreSync({ prisma, phases })

  return {
    incremental: run.incremental,
    phases,
    durationMs: Date.now() - run.startedAtMs,
    coverageAudit,
  }
}

export async function abortSyncRun(
  prisma: PrismaClient,
  run: SyncRunContext,
): Promise<void> {
  await releaseSyncLock(prisma, run.runId).catch(() => {})
}

export async function runSync(
  prisma: PrismaClient,
  options?: RunSyncOptions,
): Promise<SyncResult> {
  const start = await startSyncRun(prisma, options)
  if (start.skipped) return start.result

  const phases: PhaseResult[] = []
  let completed = false

  try {
    for (const phase of start.run.phasesToRun) {
      phases.push(
        await runSyncPhase(prisma, start.run, phase, {
          onProgress: options?.onProgress,
        }),
      )
    }

    const result = await finishSyncRun(prisma, start.run, phases)
    completed = true
    return result
  } finally {
    if (!completed) {
      await abortSyncRun(prisma, start.run)
    }
  }
}
