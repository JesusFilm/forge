// Core sync orchestrator — runs all phases in canonical order.
//
// Mirrors the CMS core-sync.ts pattern but uses:
//   - Prisma instead of Strapi Document Service
//   - DB-backed lock (SyncLock) instead of in-memory flag
//   - Per-phase watermark (SyncState) with capture-before-fetch semantics
//   - Post-phase ANALYZE for query planner stats
//
// Phase order: languages → countries → keywords → videos → video-dubs
// Later phases resolve coreId → id maps from earlier ones.

import type { PrismaClient } from "@prisma/client"
import {
  PHASE_ORDER,
  type SyncPhase,
  type SyncStats,
  type ProgressReporter,
  type PhaseRunner,
  emptySyncStats,
} from "./types"
import { acquireSyncLock, releaseSyncLock } from "./lock"
import {
  getWatermark,
  advanceWatermark,
  updateStatsOnly,
  getAllWatermarks,
} from "./watermark"
import { syncLanguages } from "./phases/sync-languages"
import { syncCountries } from "./phases/sync-countries"
import { syncKeywords } from "./phases/sync-keywords"
import { syncVideos } from "./phases/sync-videos"
import { syncDubs } from "./phases/sync-dubs"

const PHASE_RUNNERS: Record<SyncPhase, PhaseRunner> = {
  languages: syncLanguages,
  countries: syncCountries,
  keywords: syncKeywords,
  videos: syncVideos,
  "video-dubs": syncDubs,
}

// Tables to ANALYZE after each phase completes
const PHASE_TABLES: Record<SyncPhase, string[]> = {
  languages: ["language"],
  countries: ["country", "continent", "country_language"],
  keywords: ["keyword"],
  videos: [
    "video",
    "video_locale",
    "video_image",
    "video_subtitle",
    "video_edition",
  ],
  "video-dubs": ["video_dub", "video_dub_download", "mux_video"],
}

type PhaseResult = SyncStats & { phase: string; durationMs: number }

export type SyncResult = {
  skipped?: boolean
  incremental: boolean
  phases: PhaseResult[]
  durationMs: number
}

export function resolveScope(input?: string | string[]): SyncPhase[] {
  if (!input || input === "all") return [...PHASE_ORDER]
  const requested = new Set(Array.isArray(input) ? input : [input])
  return PHASE_ORDER.filter((p) => requested.has(p))
}

export async function getSyncStatus(prisma: PrismaClient) {
  const watermarks = await getAllWatermarks(prisma)
  return { watermarks }
}

export async function runSync(
  prisma: PrismaClient,
  options?: { scope?: string | string[]; incremental?: boolean },
): Promise<SyncResult> {
  const incremental = options?.incremental ?? true
  const phasesToRun = resolveScope(options?.scope)

  if (phasesToRun.length === 0) {
    return { skipped: true, incremental, phases: [], durationMs: 0 }
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
    return { skipped: true, incremental, phases: [], durationMs: 0 }
  }

  const startTime = Date.now()
  const phases: PhaseResult[] = []

  try {
    for (const phase of phasesToRun) {
      const phaseStart = Date.now()
      const progress: ProgressReporter = {
        setTotal: () => {},
        increment: () => {},
      }

      let since: string | undefined
      if (incremental) {
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

      phases.push({
        phase,
        ...stats,
        durationMs: Date.now() - phaseStart,
      })

      console.log(
        JSON.stringify({
          event: "core-sync.phase.complete",
          phase,
          ...stats,
          durationMs: Date.now() - phaseStart,
          service: "forge-admin",
        }),
      )
    }
  } finally {
    await releaseSyncLock(prisma).catch(() => {})
  }

  return { incremental, phases, durationMs: Date.now() - startTime }
}
