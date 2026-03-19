import type { Core } from "@strapi/strapi"
import { syncLanguages } from "./sync-languages"
import { syncCountries } from "./sync-countries"
import { syncVideos } from "./sync-videos"

type SyncResult = {
  skipped?: boolean
  duration?: number
  languages?: {
    created: number
    updated: number
    softDeleted: number
    errors: number
  }
  countries?: {
    created: number
    updated: number
    softDeleted: number
    errors: number
  }
  videos?: {
    created: number
    updated: number
    softDeleted: number
    errors: number
  }
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

export async function runFullSync(strapi: Core.Strapi): Promise<SyncResult> {
  if (syncInProgress) {
    strapi.log.warn("[gateway-sync] Sync already in progress, skipping")
    return { skipped: true }
  }

  syncInProgress = true
  const startTime = Date.now()

  try {
    strapi.log.info("[gateway-sync] ========== Starting full sync ==========")

    // Phase 1: Languages (must run first for i18n locales)
    const languageStats = await syncLanguages(strapi)

    // Phase 2: Countries (depends on languages)
    const countryStats = await syncCountries(strapi)

    // Phase 3: Videos (depends on languages)
    const videoStats = await syncVideos(strapi)

    const duration = Date.now() - startTime
    const result: SyncResult = {
      duration,
      languages: languageStats,
      countries: countryStats,
      videos: videoStats,
    }

    lastRun = new Date()
    lastResult = result

    strapi.log.info(
      `[gateway-sync] ========== Full sync complete in ${(duration / 1000).toFixed(1)}s ==========`,
    )
    strapi.log.info(
      `[gateway-sync] Languages: ${languageStats.created}c/${languageStats.updated}u/${languageStats.softDeleted}d/${languageStats.errors}e`,
    )
    strapi.log.info(
      `[gateway-sync] Countries: ${countryStats.created}c/${countryStats.updated}u/${countryStats.softDeleted}d/${countryStats.errors}e`,
    )
    strapi.log.info(
      `[gateway-sync] Videos: ${videoStats.created}c/${videoStats.updated}u/${videoStats.softDeleted}d/${videoStats.errors}e`,
    )

    return result
  } catch (error) {
    const duration = Date.now() - startTime
    const errorMessage = error instanceof Error ? error.message : String(error)

    strapi.log.error(
      `[gateway-sync] Full sync failed after ${(duration / 1000).toFixed(1)}s: ${errorMessage}`,
    )

    const result: SyncResult = { duration, error: errorMessage }
    lastRun = new Date()
    lastResult = result
    return result
  } finally {
    syncInProgress = false
  }
}

export default {
  runFullSync: ({ strapi }: { strapi: Core.Strapi }) => runFullSync(strapi),
  getSyncStatus,
}
