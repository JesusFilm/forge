import type { Core } from "@strapi/strapi"
import {
  type SyncStats,
  type PhaseProgress,
  type ProgressReporter,
  formatError,
  ensureSyncStateTable,
  getLastSyncTime,
  setLastSyncTime,
} from "./strapi-helpers"
import { syncLanguages } from "./sync-languages"
import { syncCountries } from "./sync-countries"
import { syncKeywords } from "./sync-keywords"
import { syncVideos } from "./sync-videos"
import { syncVideoVariants } from "./sync-video-variants"

export type SyncPhase =
  | "languages"
  | "countries"
  | "keywords"
  | "videos"
  | "video-variants"

/** Canonical execution order — phases always run in this sequence */
const PHASE_ORDER: SyncPhase[] = [
  "languages",
  "countries",
  "keywords",
  "videos",
  "video-variants",
]

type PhaseResult = SyncStats & { phase: string }

type SyncResult = {
  skipped?: boolean
  incremental?: boolean
  phases?: PhaseResult[]
  scope?: SyncPhase[]
  duration?: number
  error?: string
}

const PHASE_RUNNERS: Record<
  SyncPhase,
  (
    strapi: Core.Strapi,
    progress: ProgressReporter,
    since?: string,
  ) => Promise<SyncStats>
> = {
  languages: syncLanguages,
  countries: syncCountries,
  keywords: syncKeywords,
  videos: syncVideos,
  "video-variants": syncVideoVariants,
}

let syncInProgress = false
let lastRun: Date | null = null
let lastResult: SyncResult | null = null
let currentPhase: SyncPhase | null = null
let completedPhases: PhaseResult[] = []
let phaseProgress: PhaseProgress | null = null

export function getSyncStatus() {
  return {
    inProgress: syncInProgress,
    lastRun: lastRun?.toISOString() ?? null,
    lastResult,
    currentPhase,
    completedPhases: [...completedPhases],
    phaseProgress: phaseProgress ? { ...phaseProgress } : null,
  }
}

/**
 * Resolve the requested scope into an ordered list of phases.
 * Accepts a single phase, an array of phases, or "all".
 * Always returns phases in canonical order regardless of input order.
 */
export function resolveScope(
  input: string | string[] | undefined,
): SyncPhase[] {
  if (!input || input === "all") return [...PHASE_ORDER]

  const requested = new Set(Array.isArray(input) ? input : [input])

  // Filter to valid phases and preserve canonical order
  return PHASE_ORDER.filter((phase) => requested.has(phase))
}

function logPhase(strapi: Core.Strapi, phase: PhaseResult) {
  strapi.log.info(
    `[core-sync] ${phase.phase}: ${phase.created}c/${phase.updated}u/${phase.softDeleted}d/${phase.errors}e`,
  )
}

export type SyncOptions = {
  scope?: string | string[]
  incremental?: boolean
}

export async function runSync(
  strapi: Core.Strapi,
  options?: SyncOptions,
): Promise<SyncResult> {
  if (syncInProgress) {
    strapi.log.warn("[core-sync] Sync already in progress, skipping")
    return { skipped: true }
  }

  const scope = options?.scope
  const incremental = options?.incremental ?? false
  const phasesToRun = resolveScope(scope)

  if (phasesToRun.length === 0) {
    strapi.log.warn("[core-sync] No valid phases in scope, skipping")
    return { skipped: true }
  }

  syncInProgress = true
  currentPhase = null
  completedPhases = []
  phaseProgress = null
  const syncStartTime = new Date().toISOString()
  const startTime = Date.now()

  try {
    await ensureSyncStateTable(strapi)

    const mode = incremental ? "incremental" : "full"
    strapi.log.info(
      `[core-sync] ========== Starting ${mode} sync (${phasesToRun.join(", ")}) ==========`,
    )

    const phases: PhaseResult[] = []

    for (const phase of phasesToRun) {
      currentPhase = phase
      phaseProgress = { processed: 0, total: null }

      const reporter: ProgressReporter = {
        setTotal: (total: number) => {
          phaseProgress = { ...phaseProgress!, total }
        },
        increment: (count = 1) => {
          phaseProgress = {
            ...phaseProgress!,
            processed: phaseProgress!.processed + count,
          }
        },
      }

      // For incremental sync, look up last successful sync time for this phase
      let since: string | undefined
      if (incremental) {
        const lastSync = await getLastSyncTime(strapi, phase)
        if (lastSync) {
          since = lastSync
          strapi.log.info(`[core-sync] ${phase}: incremental since ${since}`)
        } else {
          strapi.log.info(
            `[core-sync] ${phase}: no previous sync found, running full`,
          )
        }
      }

      const runner = PHASE_RUNNERS[phase]
      const stats = await runner(strapi, reporter, since)
      completedPhases.push({ phase, ...stats })
      phases.push({ phase, ...stats })

      // Only advance the watermark if the phase had no errors — failed records
      // need to be retried on the next incremental sync
      if (stats.errors === 0) {
        await setLastSyncTime(strapi, phase, syncStartTime)
      } else {
        strapi.log.warn(
          `[core-sync] ${phase}: ${stats.errors} errors — watermark NOT advanced`,
        )
      }
    }

    const duration = Date.now() - startTime
    const result: SyncResult = {
      scope: phasesToRun,
      incremental,
      duration,
      phases,
    }

    lastRun = new Date()
    lastResult = result

    strapi.log.info(
      `[core-sync] ========== Sync complete in ${(duration / 1000).toFixed(1)}s (${incremental ? "incremental" : "full"}) ==========`,
    )
    for (const phase of phases) logPhase(strapi, phase)

    return result
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = formatError(error)

    strapi.log.error(
      `[core-sync] Sync failed after ${(duration / 1000).toFixed(1)}s: ${errorMessage}`,
    )

    const result: SyncResult = {
      scope: phasesToRun,
      incremental,
      duration,
      error: errorMessage,
    }
    lastRun = new Date()
    lastResult = result
    return result
  } finally {
    syncInProgress = false
    currentPhase = null
    phaseProgress = null
  }
}

export async function runFullSync(strapi: Core.Strapi): Promise<SyncResult> {
  return runSync(strapi, { scope: "all", incremental: false })
}

export default {
  runFullSync: ({ strapi }: { strapi: Core.Strapi }) => runFullSync(strapi),
  runSync: ({ strapi }: { strapi: Core.Strapi }, options?: SyncOptions) =>
    runSync(strapi, options),
  getSyncStatus,
}
