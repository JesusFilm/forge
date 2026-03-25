import type { Core } from "@strapi/strapi"
import {
  type SyncStats,
  formatError,
  publishDrafts,
  repairVideoChildRelationLinks,
} from "./strapi-helpers"
import { syncLanguages } from "./sync-languages"
import { syncCountries } from "./sync-countries"
import { syncKeywords } from "./sync-keywords"
import { syncVideos } from "./sync-videos"
import { syncVideoVariants } from "./sync-video-variants"
import {
  resolveCollectionVideoIds,
  type ResolveCollectionVideoIdsResult,
} from "./resolve-collection-video-ids"

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
  phases?: PhaseResult[]
  scope?: SyncPhase[]
  duration?: number
  error?: string
}

/** Selection context for limited seed imports */
export type SyncSelection = {
  collectionIds: string[]
  videoIds: string[]
  resolvedVideoIds: string[]
  collectionVideoIds: Record<string, string[]>
  missingCollectionIds: string[]
  isFullSync: boolean
  dryRun: boolean
}

/** Maximum total IDs per limited import request */
const MAX_LIMITED_IDS = 500

const PHASE_RUNNERS: Record<
  SyncPhase,
  (strapi: Core.Strapi, selection: SyncSelection) => Promise<SyncStats>
> = {
  languages: (strapi) => syncLanguages(strapi),
  countries: (strapi) => syncCountries(strapi),
  keywords: (strapi) => syncKeywords(strapi),
  videos: (strapi, selection) => syncVideos(strapi, selection),
  "video-variants": (strapi, selection) => syncVideoVariants(strapi, selection),
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

export type SyncOptions = {
  scope?: string | string[]
  collectionIds?: string[]
  videoIds?: string[]
  dryRun?: boolean
}

function isLimitedImportEnabled(): boolean {
  return process.env.GATEWAY_SYNC_ENABLE_LIMITED_IMPORT === "true"
}

export async function buildSelection(
  options: SyncOptions,
): Promise<SyncSelection> {
  const collectionIds = options.collectionIds ?? []
  const videoIds = options.videoIds ?? []
  const isFullSync = collectionIds.length === 0 && videoIds.length === 0

  if (isFullSync) {
    return {
      collectionIds: [],
      videoIds: [],
      resolvedVideoIds: [],
      collectionVideoIds: {},
      missingCollectionIds: [],
      isFullSync: true,
      dryRun: false,
    }
  }

  const resolved: ResolveCollectionVideoIdsResult =
    collectionIds.length > 0
      ? await resolveCollectionVideoIds({ collectionIds })
      : {
          collectionVideoIds: {},
          resolvedVideoIds: [],
          missingCollectionIds: [],
        }

  // Union resolved collection video IDs with explicit videoIds, deduped
  const allVideoIds = new Set([...resolved.resolvedVideoIds, ...videoIds])

  return {
    collectionIds,
    videoIds,
    resolvedVideoIds: [...allVideoIds],
    collectionVideoIds: resolved.collectionVideoIds,
    missingCollectionIds: resolved.missingCollectionIds,
    isFullSync: false,
    dryRun: options.dryRun ?? false,
  }
}

export async function runSync(
  strapi: Core.Strapi,
  options: SyncOptions = {},
): Promise<SyncResult> {
  if (syncInProgress) {
    strapi.log.warn("[gateway-sync] Sync already in progress, skipping")
    return { skipped: true }
  }

  const phasesToRun = resolveScope(options.scope)

  if (phasesToRun.length === 0) {
    strapi.log.warn("[gateway-sync] No valid phases in scope, skipping")
    return { skipped: true }
  }

  // Build selection context
  const selection = await buildSelection(options)

  // Reject limited imports if env guard is not enabled
  if (!selection.isFullSync && !isLimitedImportEnabled()) {
    strapi.log.warn(
      "[gateway-sync] Limited import rejected: GATEWAY_SYNC_ENABLE_LIMITED_IMPORT is not enabled",
    )
    return {
      error:
        "Limited imports are disabled. Set GATEWAY_SYNC_ENABLE_LIMITED_IMPORT=true to enable.",
    }
  }

  // Validate total ID count for limited imports
  if (
    !selection.isFullSync &&
    selection.collectionIds.length + (options.videoIds?.length ?? 0) >
      MAX_LIMITED_IDS
  ) {
    return {
      error: `Too many IDs in limited import request. Maximum ${MAX_LIMITED_IDS} total collectionIds + videoIds allowed.`,
    }
  }

  // Dry run: return resolved selection without executing sync
  if (selection.dryRun) {
    return {
      scope: phasesToRun,
      duration: 0,
      dryRun: {
        isFullSync: false,
        requestedCollectionIds: selection.collectionIds,
        requestedVideoIds: selection.videoIds,
        collectionVideoIds: selection.collectionVideoIds,
        resolvedVideoIds: selection.resolvedVideoIds,
        missingCollectionIds: selection.missingCollectionIds,
        phases: phasesToRun,
      },
    } as SyncResult & { dryRun: unknown }
  }

  syncInProgress = true
  const startTime = Date.now()

  try {
    const mode = selection.isFullSync ? "full" : "limited"
    strapi.log.info(
      `[gateway-sync] ========== Starting ${mode} sync (${phasesToRun.join(", ")}) ==========`,
    )

    if (!selection.isFullSync) {
      strapi.log.info(
        `[gateway-sync] Limited import: ${selection.resolvedVideoIds.length} resolved video IDs from ${selection.collectionIds.length} collections + ${selection.videoIds.length} explicit videos`,
      )
      if (selection.missingCollectionIds.length > 0) {
        strapi.log.warn(
          `[gateway-sync] Missing collection IDs (not found in gateway): ${selection.missingCollectionIds.join(", ")}`,
        )
      }
    }

    const phases: PhaseResult[] = []

    for (const phase of phasesToRun) {
      const runner = PHASE_RUNNERS[phase]
      const stats = await runner(strapi, selection)
      phases.push({ phase, ...stats })
    }

    // Bulk-publish all draft gateway records created during sync.
    // upsertByGatewayId creates drafts only (Strapi v5 entity validator
    // rejects published creates with documentId relation values).
    // Updates already publish inline, so this catches new creates.
    const CONTENT_TYPES_TO_PUBLISH = [
      // Reference / lookup tables
      "api::continent.continent",
      "api::language.language",
      "api::country.country",
      "api::country-language.country-language",
      "api::keyword.keyword",
      "api::bible-book.bible-book",
      // Video content
      "api::video-origin.video-origin",
      "api::video-edition.video-edition",
      "api::mux-video.mux-video",
      "api::video.video",
      "api::video-subtitle.video-subtitle",
      "api::video-variant.video-variant",
      "api::bible-citation.bible-citation",
      "api::video-study-question.video-study-question",
    ]
    const VIDEO_UID = "api::video.video"
    for (const ct of CONTENT_TYPES_TO_PUBLISH) {
      try {
        const count = await publishDrafts(strapi, ct)
        if (count > 0) {
          strapi.log.info(
            `[gateway-sync] Published ${count} draft ${ct.split(".")[1]} records`,
          )
        }
      } catch (error) {
        strapi.log.warn(
          `[gateway-sync] Failed to publish drafts for ${ct}: ${formatError(error)}`,
        )
      }

      // After videos are published, repair child join tables so their
      // *_video_lnk rows point to the new PUBLISHED video rows. Strapi
      // stores relations by numeric row id — the child rows still reference
      // the draft video row ids, which have published_at = null, causing
      // the entity validator to reject publishing child records.
      if (ct === VIDEO_UID) {
        try {
          await repairVideoChildRelationLinks(strapi)
          strapi.log.info(
            "[gateway-sync] Repaired video child relation links (draft→published)",
          )
        } catch (error) {
          strapi.log.warn(
            `[gateway-sync] Failed to repair video child relation links: ${formatError(error)}`,
          )
        }
      }
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
  return runSync(strapi, { scope: "all" })
}

export default {
  runFullSync: ({ strapi }: { strapi: Core.Strapi }) => runFullSync(strapi),
  runSync: ({ strapi }: { strapi: Core.Strapi }, options?: SyncOptions) =>
    runSync(strapi, options),
  getSyncStatus,
}
