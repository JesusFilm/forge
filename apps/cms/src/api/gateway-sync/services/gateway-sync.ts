import type { Core } from "@strapi/strapi"
import { type SyncStats, formatError } from "./strapi-helpers"
import { syncLanguages } from "./sync-languages"
import { syncCountries } from "./sync-countries"
import { syncVideos, syncVideoVariants } from "./sync-videos"

export type SyncScope =
  | "all"
  | "languages"
  | "countries"
  | "videos"
  | "video-variants"

type PhaseResult = SyncStats & { phase: string }

type SyncResult = {
  skipped?: boolean
  scope?: SyncScope
  duration?: number
  phases?: PhaseResult[]
  error?: string
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

function logPhase(strapi: Core.Strapi, phase: PhaseResult) {
  strapi.log.info(
    `[gateway-sync] ${phase.phase}: ${phase.created}c/${phase.updated}u/${phase.softDeleted}d/${phase.errors}e`,
  )
}

export async function runSync(
  strapi: Core.Strapi,
  scope: SyncScope = "all",
): Promise<SyncResult> {
  if (syncInProgress) {
    strapi.log.warn("[gateway-sync] Sync already in progress, skipping")
    return { skipped: true }
  }

  syncInProgress = true
  const startTime = Date.now()

  try {
    strapi.log.info(
      `[gateway-sync] ========== Starting sync (scope: ${scope}) ==========`,
    )

    const phases: PhaseResult[] = []

    if (scope === "all" || scope === "languages") {
      const stats = await syncLanguages(strapi)
      phases.push({ phase: "languages", ...stats })
    }

    if (scope === "all" || scope === "countries") {
      const stats = await syncCountries(strapi)
      phases.push({ phase: "countries", ...stats })
    }

    if (scope === "all" || scope === "videos") {
      const stats = await syncVideos(strapi)
      phases.push({ phase: "videos", ...stats })
    }

    if (scope === "all" || scope === "videos" || scope === "video-variants") {
      const stats = await syncVideoVariants(strapi)
      phases.push({ phase: "video-variants", ...stats })
    }

    const duration = Date.now() - startTime
    const result: SyncResult = { scope, duration, phases }

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

    const result: SyncResult = { scope, duration, error: errorMessage }
    lastRun = new Date()
    lastResult = result
    return result
  } finally {
    syncInProgress = false
  }
}

// Backward compat: runFullSync calls runSync("all")
export async function runFullSync(strapi: Core.Strapi): Promise<SyncResult> {
  return runSync(strapi, "all")
}

export default {
  runFullSync: ({ strapi }: { strapi: Core.Strapi }) => runFullSync(strapi),
  runSync: ({ strapi }: { strapi: Core.Strapi }, scope?: SyncScope) =>
    runSync(strapi, scope),
  getSyncStatus,
}
