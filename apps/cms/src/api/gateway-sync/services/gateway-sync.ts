import type { Core } from "@strapi/strapi"
import { type SyncStats, formatError } from "./strapi-helpers"
import { syncLanguages } from "./sync-languages"
import { syncCountries } from "./sync-countries"
import { syncVideos, syncVideoVariants } from "./sync-videos"

export type SyncPhase = "languages" | "countries" | "videos" | "video-variants"

/** Canonical execution order — phases always run in this sequence */
const PHASE_ORDER: SyncPhase[] = [
  "languages",
  "countries",
  "videos",
  "video-variants",
]

type PhaseResult = SyncStats & { phase: string }

type SyncResult = {
  skipped?: boolean
  phases?: PhaseResult[]
  scope?: SyncPhase[]
  duration?: number
  error?: string
}

const PHASE_RUNNERS: Record<
  SyncPhase,
  (strapi: Core.Strapi) => Promise<SyncStats>
> = {
  languages: syncLanguages,
  countries: syncCountries,
  videos: syncVideos,
  "video-variants": syncVideoVariants,
}

let syncInProgress = false
let lastRun: Date | null = null
let lastResult: SyncResult | null = null

export function getSyncStatus() {
  return {
    inProgress: syncInProgress,
    lastRun: lastRun?.toISOString() ?? null,
    lastResult,
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
    `[gateway-sync] ${phase.phase}: ${phase.created}c/${phase.updated}u/${phase.softDeleted}d/${phase.errors}e`,
  )
}

export async function runSync(
  strapi: Core.Strapi,
  scope?: string | string[],
): Promise<SyncResult> {
  if (syncInProgress) {
    strapi.log.warn("[gateway-sync] Sync already in progress, skipping")
    return { skipped: true }
  }

  const phasesToRun = resolveScope(scope)

  if (phasesToRun.length === 0) {
    strapi.log.warn("[gateway-sync] No valid phases in scope, skipping")
    return { skipped: true }
  }

  syncInProgress = true
  const startTime = Date.now()

  try {
    strapi.log.info(
      `[gateway-sync] ========== Starting sync (${phasesToRun.join(", ")}) ==========`,
    )

    const phases: PhaseResult[] = []

    for (const phase of phasesToRun) {
      const runner = PHASE_RUNNERS[phase]
      const stats = await runner(strapi)
      phases.push({ phase, ...stats })
    }

    const duration = Date.now() - startTime
    const result: SyncResult = { scope: phasesToRun, duration, phases }

    lastRun = new Date()
    lastResult = result

    strapi.log.info(
      `[gateway-sync] ========== Sync complete in ${(duration / 1000).toFixed(1)}s ==========`,
    )
    for (const phase of phases) logPhase(strapi, phase)

    return result
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = formatError(error)

    strapi.log.error(
      `[gateway-sync] Sync failed after ${(duration / 1000).toFixed(1)}s: ${errorMessage}`,
    )

    const result: SyncResult = {
      scope: phasesToRun,
      duration,
      error: errorMessage,
    }
    lastRun = new Date()
    lastResult = result
    return result
  } finally {
    syncInProgress = false
  }
}

export async function runFullSync(strapi: Core.Strapi): Promise<SyncResult> {
  return runSync(strapi, "all")
}

export default {
  runFullSync: ({ strapi }: { strapi: Core.Strapi }) => runFullSync(strapi),
  runSync: ({ strapi }: { strapi: Core.Strapi }, scope?: string | string[]) =>
    runSync(strapi, scope),
  getSyncStatus,
}
