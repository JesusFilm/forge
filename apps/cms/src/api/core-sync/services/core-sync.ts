import type { Core } from "@strapi/strapi"
import {
  type SyncStats,
  type PhaseProgress,
  type ProgressReporter,
  formatError,
  ensureSyncStateTable,
  getLastSyncTime,
  setLastSyncTime,
  getAllSyncTimes,
  updateSyncStats,
} from "./strapi-helpers"
import { syncLanguages } from "./sync-languages"
import { syncCountries } from "./sync-countries"
import { syncKeywords } from "./sync-keywords"
import { syncVideos } from "./sync-videos"
import { syncVideoVariants } from "./sync-video-variants"
import { generateBlurhashForNewImages } from "./post-sync-blurhash"

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
 * Read persistent sync state from the database for when in-memory state is
 * empty (e.g. after server restart). Returns the most recent sync timestamp
 * and per-phase watermarks so the admin UI can show "last synced at" even
 * when the server has restarted since the last sync.
 */
export async function getPersistedSyncStatus(strapi: Core.Strapi) {
  const phaseWatermarks = await getAllSyncTimes(strapi)

  if (phaseWatermarks.length === 0) {
    return { persistedLastRun: null, phaseWatermarks: [] }
  }

  // The most recent watermark across all phases is the last sync time
  const persistedLastRun = phaseWatermarks[0].lastSyncedAt

  return { persistedLastRun, phaseWatermarks }
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
  const incremental = options?.incremental ?? true
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
      // need to be retried on the next incremental sync.
      // Always persist stats so the admin UI can show row counts after restart.
      if (stats.errors === 0) {
        await setLastSyncTime(strapi, phase, syncStartTime, stats)
      } else {
        strapi.log.warn(
          `[core-sync] ${phase}: ${stats.errors} errors — watermark NOT advanced`,
        )
        // Persist stats without advancing the watermark
        await updateSyncStats(strapi, phase, stats).catch(() => {})
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

    // Update planner statistics on tables modified by the sync.
    // Bulk delete+insert cycles leave stale stats that cause the query
    // planner to choose sequential scans over available indexes.
    await analyzeModifiedTables(strapi, phasesToRun)

    // Generate blurhash for any newly synced images missing it
    if (phasesToRun.includes("videos")) {
      await generateBlurhashForNewImages(strapi).catch((error) => {
        strapi.log.warn(
          `[core-sync] Post-sync blurhash generation failed: ${formatError(error)}`,
        )
      })
    }

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

/**
 * Run ANALYZE on tables modified by the sync to update planner statistics.
 *
 * The bulk upsert pattern (delete old link rows → insert new ones) creates
 * large dead-tuple counts that make autovacuum/autoanalyze lag behind.
 * Stale statistics cause the planner to choose sequential scans even when
 * good indexes exist. Running ANALYZE immediately after sync ensures the
 * planner has accurate row counts and value distributions.
 */
const PHASE_TABLES: Record<SyncPhase, string[]> = {
  languages: ["languages"],
  countries: ["countries", "continents", "country_languages"],
  keywords: ["keywords", "keywords_language_lnk", "videos_keywords_lnk"],
  videos: [
    "videos",
    "videos_children_lnk",
    "videos_origin_lnk",
    "videos_primary_language_lnk",
  ],
  "video-variants": [
    "video_variants",
    "video_variants_video_lnk",
    "video_variants_language_lnk",
    "video_variants_video_edition_lnk",
    "video_variants_mux_video_lnk",
    "video_variant_downloads",
    "video_variant_downloads_video_variant_lnk",
    "mux_videos",
    "video_editions",
  ],
}

async function analyzeModifiedTables(
  strapi: Core.Strapi,
  phases: SyncPhase[],
): Promise<void> {
  const tables = new Set<string>()
  for (const phase of phases) {
    for (const table of PHASE_TABLES[phase] ?? []) {
      tables.add(table)
    }
  }

  if (tables.size === 0) return

  const knex = strapi.db.connection
  const start = Date.now()

  for (const table of tables) {
    try {
      await knex.raw(`ANALYZE "${table}"`)
    } catch {
      // Table may not exist — safe to skip
    }
  }

  strapi.log.info(
    `[core-sync] ANALYZE completed on ${tables.size} tables in ${Date.now() - start}ms`,
  )
}

export default {
  runFullSync: ({ strapi }: { strapi: Core.Strapi }) => runFullSync(strapi),
  runSync: ({ strapi }: { strapi: Core.Strapi }, options?: SyncOptions) =>
    runSync(strapi, options),
  getSyncStatus,
}
