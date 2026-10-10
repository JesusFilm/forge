import { createStep, createWorkflow } from "@mastra/core/workflows"
import {
  classifyPublicWatchPathname,
  DEFAULT_WATCH_LANGUAGE_SLUG,
  PUBLIC_WATCH_LANGUAGE_SLUGS,
  type PublicWatchPageShape,
} from "@forge/watch-url-policy/routes"
import { z } from "zod"

import { getSeoConfig, type SeoConfig } from "../../config/seo"
import { mapWithConcurrency } from "../../services/concurrency"
import { createCachedSeoHostResolver } from "../../services/seo-http"
import {
  claimWatchRouteAlertRun,
  completeWatchRouteAlertRun,
  type WatchRouteAlertObservation,
  type WatchRouteManifest,
} from "../../services/admin-watch-route-alert-client"
import {
  queryWatchRouteNotFoundLane,
  type Ga4RequestBudget,
  type WatchRouteNotFoundLane,
  type WatchRouteNotFoundResult,
} from "../../services/google-analytics-client"
import { probeWatchRoute } from "../../services/watch-route-probe"

export const WatchRouteAlertsInputSchema = z
  .object({
    scheduledFor: z.string().datetime().optional(),
    runKey: z.string().min(1).max(500).optional(),
  })
  .strict()

export const WatchRouteAlertsOutputSchema = z
  .object({
    ok: z.boolean(),
    mode: z.enum(["off", "dry_run", "live"]),
    reason: z.enum(["off", "completed", "partial", "failed", "in_progress"]),
    properties: z.array(
      z
        .object({
          propertyId: z.string(),
          adminRunId: z.string().nullable(),
          actionableCount: z.number().int().nonnegative(),
          noiseCount: z.number().int().nonnegative(),
          status: z.enum(["completed", "partial", "failed", "in_progress"]),
        })
        .strict(),
    ),
  })
  .strict()

type LaneReport = {
  source: "EXPLICIT_EVENT" | "LOCALIZED_TITLE"
  status: "COMPLETE" | "PARTIAL" | "FAILED"
  countKind: "EVENT_COUNT" | "PAGE_VIEWS"
  rowCount: number
  windowStart: string
  windowEnd: string
  caveats: string[]
}

type Dependencies = {
  config?: SeoConfig
  now?: () => Date
  claim?: typeof claimWatchRouteAlertRun
  complete?: typeof completeWatchRouteAlertRun
  queryLane?: typeof queryWatchRouteNotFoundLane
  probe?: typeof probeWatchRoute
}

const WATCH_ROUTE_GA4_ROW_LIMIT = 20_000
const WATCH_ROUTE_GA4_REQUEST_LIMIT = 12
const WATCH_ROUTE_PROBE_TIMEOUT_MS = 15_000
const WATCH_ROUTE_MANIFEST_MAX_AGE_MS = 72 * 60 * 60 * 1_000
const WATCH_ROUTE_MANIFEST_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function minusDays(value: Date, days: number) {
  return new Date(value.getTime() - days * 86_400_000)
}

function latestSettledGa4Anchor(value: Date) {
  const anchor = new Date(value)
  anchor.setUTCHours(12, 15, 0, 0)
  return anchor > value ? minusDays(anchor, 1) : anchor
}

function gaDateToIso(value: string) {
  if (!/^\d{8}$/u.test(value)) return null
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`
  return Number.isNaN(Date.parse(iso)) ? null : iso
}

function languageAt(
  manifest: WatchRouteManifest,
  indexes: number[] | undefined,
) {
  return new Set(
    (indexes ?? []).flatMap(
      (index) => manifest.audioLanguageSlugs[index] ?? [],
    ),
  )
}

export function isManifestAdmitted(
  route: PublicWatchPageShape,
  manifest: WatchRouteManifest,
) {
  if (route.shape === "home" || route.shape === "utility") return true
  if (route.shape === "localized-utility") {
    return (
      PUBLIC_WATCH_LANGUAGE_SLUGS.has(route.languageSlug) ||
      manifest.homepageLocales?.includes(route.languageSlug) === true ||
      manifest.audioLanguageSlugs.includes(route.languageSlug)
    )
  }
  if (route.shape === "one-segment") {
    return (
      PUBLIC_WATCH_LANGUAGE_SLUGS.has(route.slug) ||
      manifest.oneSegmentSlugs.includes(route.slug)
    )
  }
  if (route.shape === "two-segment") {
    const contentLanguage = languageAt(
      manifest,
      manifest.audioLanguageIndexesByContent[route.firstSlug],
    ).has(route.secondSlug)
    const contextualEpisode =
      manifest.episodePairsByParent[route.firstSlug]?.includes(
        route.secondSlug,
      ) === true &&
      languageAt(
        manifest,
        manifest.audioLanguageIndexesByEpisode[route.firstSlug]?.[
          route.secondSlug
        ],
      ).has(DEFAULT_WATCH_LANGUAGE_SLUG)
    return contentLanguage || contextualEpisode
  }
  return (
    manifest.episodePairsByParent[route.parentSlug]?.includes(
      route.episodeSlug,
    ) === true &&
    languageAt(
      manifest,
      manifest.audioLanguageIndexesByEpisode[route.parentSlug]?.[
        route.episodeSlug
      ],
    ).has(route.languageSlug)
  )
}

function isPlausible(
  route: PublicWatchPageShape,
  manifest: WatchRouteManifest,
) {
  const isKnownLanguage = (slug: string) =>
    PUBLIC_WATCH_LANGUAGE_SLUGS.has(slug) ||
    manifest.homepageLocales?.includes(slug) === true ||
    manifest.audioLanguageSlugs.includes(slug)
  if (route.shape === "home" || route.shape === "utility") return false
  if (route.shape === "localized-utility") {
    return isKnownLanguage(route.languageSlug)
  }
  if (route.shape === "one-segment") {
    return manifest.contentSlugs.includes(route.slug)
  }
  if (route.shape === "two-segment") {
    return (
      (manifest.contentSlugs.includes(route.firstSlug) &&
        isKnownLanguage(route.secondSlug)) ||
      manifest.episodePairsByParent[route.firstSlug]?.includes(
        route.secondSlug,
      ) === true
    )
  }
  return (
    manifest.episodePairsByParent[route.parentSlug]?.includes(
      route.episodeSlug,
    ) === true && isKnownLanguage(route.languageSlug)
  )
}

function normalizeGaPath(value: string, origin: string) {
  if (value.includes("\\") || value.includes("%")) return null
  try {
    const url = new URL(value, `${origin}/`)
    if (url.origin !== origin) return null
    return url.pathname
  } catch {
    return null
  }
}

type Aggregated = {
  path: string
  count: number
  countKind: "event_count" | "page_views"
  activeUsers: number
  firstSeenAt: string
  lastSeenAt: string
  sources: Array<"EXPLICIT_EVENT" | "LOCALIZED_TITLE">
}

function aggregateLaneRows(
  results: Array<{
    lane: WatchRouteNotFoundLane
    result: Extract<WatchRouteNotFoundResult, { ok: true }>
  }>,
  origin: string,
) {
  const byPath = new Map<string, Aggregated>()
  let noiseCount = 0
  for (const { lane, result } of results) {
    for (const row of result.rows) {
      const path = normalizeGaPath(
        row.dimensions.pagePathPlusQueryString ?? "",
        origin,
      )
      const seenAt = gaDateToIso(row.dimensions.date ?? "")
      if (!path || !seenAt) {
        noiseCount += 1
        continue
      }
      const source =
        lane === "explicit_event" ? "EXPLICIT_EVENT" : "LOCALIZED_TITLE"
      const countKind = lane === "explicit_event" ? "event_count" : "page_views"
      const count = Math.max(
        0,
        Math.round(
          row.metrics[
            lane === "explicit_event" ? "eventCount" : "screenPageViews"
          ] ?? 0,
        ),
      )
      const activeUsers = Math.max(0, Math.round(row.metrics.activeUsers ?? 0))
      const existing = byPath.get(path)
      if (!existing) {
        byPath.set(path, {
          path,
          count,
          countKind,
          activeUsers,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          sources: [source],
        })
        continue
      }
      existing.firstSeenAt =
        existing.firstSeenAt < seenAt ? existing.firstSeenAt : seenAt
      existing.lastSeenAt =
        existing.lastSeenAt > seenAt ? existing.lastSeenAt : seenAt
      existing.activeUsers = Math.max(existing.activeUsers, activeUsers)
      if (!existing.sources.includes(source)) existing.sources.push(source)
      if (lane === "explicit_event") {
        existing.count =
          existing.countKind === "event_count" ? existing.count + count : count
        existing.countKind = "event_count"
      } else if (existing.countKind === "page_views") {
        existing.count += count
      }
    }
  }
  return { candidates: [...byPath.values()], noiseCount }
}

function laneReport(
  lane: WatchRouteNotFoundLane,
  result: WatchRouteNotFoundResult,
  windowStart: string,
  windowEnd: string,
): LaneReport {
  const source =
    lane === "explicit_event" ? "EXPLICIT_EVENT" : "LOCALIZED_TITLE"
  const countKind = lane === "explicit_event" ? "EVENT_COUNT" : "PAGE_VIEWS"
  if (!result.ok) {
    return {
      source,
      status: "FAILED",
      countKind,
      rowCount: 0,
      windowStart,
      windowEnd,
      caveats: [`GA4 lane failed: ${result.reason}.`],
    }
  }
  return {
    source,
    status: result.complete ? "COMPLETE" : "PARTIAL",
    countKind,
    rowCount: result.rows.length,
    windowStart,
    windowEnd,
    caveats: result.caveats,
  }
}

export async function runWatchRouteAlerts(
  input: z.input<typeof WatchRouteAlertsInputSchema>,
  deps: Dependencies = {},
) {
  const parsedInput = WatchRouteAlertsInputSchema.parse(input)
  const config = deps.config ?? getSeoConfig()
  const mode = config.watchRouteAlerts.mode
  if (mode === "off" || config.watchRouteAlerts.properties.length === 0) {
    return WatchRouteAlertsOutputSchema.parse({
      ok: true,
      mode,
      reason: "off",
      properties: [],
    })
  }
  const now = (deps.now ?? (() => new Date()))()
  const logicalRunAt = parsedInput.scheduledFor
    ? new Date(parsedInput.scheduledFor)
    : now
  const settledAnchor = latestSettledGa4Anchor(logicalRunAt)
  const requestedEndDate = dateOnly(minusDays(settledAnchor, 1))
  const requestedStartDate = dateOnly(minusDays(settledAnchor, 3))
  const requestedWindowStart = `${requestedStartDate}T00:00:00.000Z`
  const requestedWindowEnd = `${requestedEndDate}T23:59:59.999Z`
  const claim = deps.claim ?? claimWatchRouteAlertRun
  const complete = deps.complete ?? completeWatchRouteAlertRun
  const queryLane = deps.queryLane ?? queryWatchRouteNotFoundLane
  const probe = deps.probe ?? probeWatchRoute
  // These hard bounds keep the maximum configured provider/probe work inside
  // the 30-minute Admin fence, including provider retries and completion.
  const queryConfig = {
    ...config,
    maxGa4Rows: Math.min(config.maxGa4Rows, WATCH_ROUTE_GA4_ROW_LIMIT),
    timeoutMs: Math.min(config.timeoutMs, WATCH_ROUTE_PROBE_TIMEOUT_MS),
    maxProviderAttempts: Math.min(config.maxProviderAttempts, 2),
  }
  const completionConfig = { ...config, timeoutMs: 60_000 }
  const probeTimeoutMs = Math.min(
    config.timeoutMs,
    WATCH_ROUTE_PROBE_TIMEOUT_MS,
  )
  const properties = []

  for (const property of config.watchRouteAlerts.properties) {
    const resolveHost = createCachedSeoHostResolver()
    const gaRequestBudget: Ga4RequestBudget = {
      remaining: WATCH_ROUTE_GA4_REQUEST_LIMIT,
    }
    const started = await claim(
      {
        propertyId: property.propertyId,
        origin: property.origin,
        contractVersion: "watch-route-alerts/v1",
        mode,
        windowStart: requestedWindowStart,
        windowEnd: requestedWindowEnd,
        leaseSeconds: 1_800,
        reprobeLimit: config.watchRouteAlerts.reprobeLimit,
      },
      { config },
    )
    if (!started.ok) {
      properties.push({
        propertyId: property.propertyId,
        adminRunId: null,
        actionableCount: 0,
        noiseCount: 0,
        status: "failed" as const,
      })
      continue
    }
    if (!started.result.claim || !started.result.manifest) {
      const existingStatus = started.result.run.status
      properties.push({
        propertyId: property.propertyId,
        adminRunId: started.result.run.id,
        actionableCount: 0,
        noiseCount: 0,
        status:
          existingStatus === "running"
            ? ("in_progress" as const)
            : existingStatus,
      })
      continue
    }

    const startDate = started.result.run.windowStart.slice(0, 10)
    const endDate = started.result.run.windowEnd.slice(0, 10)

    const laneNames = ["explicit_event", "localized_title"] as const
    const manifestGeneratedAt = Date.parse(started.result.manifest.generatedAt)
    const manifestIsFresh =
      manifestGeneratedAt <=
        now.getTime() + WATCH_ROUTE_MANIFEST_MAX_FUTURE_SKEW_MS &&
      now.getTime() - manifestGeneratedAt <= WATCH_ROUTE_MANIFEST_MAX_AGE_MS
    const laneResults = manifestIsFresh
      ? await Promise.all(
          laneNames.map(async (lane) => ({
            lane,
            result: await queryLane({
              propertyId: property.propertyId,
              lane,
              startDate,
              endDate,
              config: queryConfig,
              requestBudget: gaRequestBudget,
            }),
          })),
        )
      : laneNames.map((lane) => ({
          lane,
          result: {
            ok: false as const,
            reason: "rejected" as const,
            retryable: false,
          },
        }))
    const successful = laneResults.filter(
      (
        entry,
      ): entry is {
        lane: WatchRouteNotFoundLane
        result: Extract<WatchRouteNotFoundResult, { ok: true }>
      } => entry.result.ok,
    )
    const aggregated = aggregateLaneRows(successful, property.origin)
    const pathsSeenInGaWindow = new Set(
      aggregated.candidates.map(({ path }) => path),
    )
    let noiseCount = aggregated.noiseCount
    const actionable: Array<Omit<WatchRouteAlertObservation, "probe">> = []
    for (const candidate of aggregated.candidates) {
      const route = classifyPublicWatchPathname(candidate.path)
      if (route.kind !== "page") {
        noiseCount += 1
        continue
      }
      const verdict = isManifestAdmitted(route, started.result.manifest)
        ? "supported_route_failure"
        : isPlausible(route, started.result.manifest)
          ? "plausible_missing_route"
          : null
      if (!verdict) {
        noiseCount += 1
        continue
      }
      actionable.push({
        path: candidate.path,
        verdict,
        count: candidate.count,
        countKind: candidate.countKind,
        activeUsers: candidate.activeUsers,
        firstSeenAt: candidate.firstSeenAt,
        lastSeenAt: candidate.lastSeenAt,
        evidence: { sources: candidate.sources },
      })
    }
    actionable.sort(
      (left, right) =>
        right.count - left.count || left.path.localeCompare(right.path),
    )
    const selected = actionable.slice(0, config.watchRouteAlerts.maxCandidates)
    const candidateTruncatedCount = actionable.length - selected.length
    const observations = await mapWithConcurrency(
      selected,
      10,
      async (observation) => ({
        ...observation,
        probe: await probe({
          origin: property.origin,
          path: observation.path,
          timeoutMs: probeTimeoutMs,
          resolveHost,
        }),
      }),
    )
    const reprobes = await mapWithConcurrency(
      started.result.openAlerts.filter(
        ({ path }) => !pathsSeenInGaWindow.has(path),
      ),
      10,
      async ({ path }) => ({
        path,
        probe: await probe({
          origin: property.origin,
          path,
          timeoutMs: probeTimeoutMs,
          resolveHost,
        }),
      }),
    )
    const lanes = laneResults.map(({ lane, result }) =>
      laneReport(
        lane,
        result,
        started.result.run.windowStart,
        started.result.run.windowEnd,
      ),
    )
    const failedLanes = lanes.filter(({ status }) => status === "FAILED").length
    const inconclusiveProbeCount = [...observations, ...reprobes].filter(
      ({ probe: result }) =>
        result.kind === "inconclusive" || result.kind === "redirect",
    ).length
    const validationCaveats = [
      ...(!manifestIsFresh
        ? ["The Admin Watch route manifest is stale or future-dated."]
        : []),
      ...(candidateTruncatedCount > 0
        ? [
            `${candidateTruncatedCount} actionable candidate(s) exceeded the validation cap.`,
          ]
        : []),
      ...(inconclusiveProbeCount > 0
        ? [
            `${inconclusiveProbeCount} route probe(s) were inconclusive or redirected.`,
          ]
        : []),
    ]
    const partial =
      lanes.some(({ status }) => status !== "COMPLETE") ||
      validationCaveats.length > 0
    const status =
      failedLanes === lanes.length
        ? "failed"
        : partial
          ? "partial"
          : "completed"
    const completion = await complete(
      {
        runId: started.result.run.id,
        claimGeneration: started.result.claim.generation,
        claimToken: started.result.claim.token,
        status,
        manifestVersion: started.result.manifest.version,
        report: {
          schemaVersion: 1,
          generatedAt: now.toISOString(),
          runKey:
            parsedInput.runKey ??
            `watch-route-alerts:${dateOnly(logicalRunAt)}`,
          lanes,
          validationCaveats,
          candidateTruncatedCount,
          inconclusiveProbeCount,
        },
        noiseCount,
        observations,
        reprobes: status === "completed" ? reprobes : [],
      },
      { config: completionConfig },
    )
    properties.push({
      propertyId: property.propertyId,
      adminRunId: started.result.run.id,
      actionableCount: observations.length,
      noiseCount,
      status: completion.ok ? status : ("failed" as const),
    })
  }
  const allCompleted = properties.every(({ status }) => status === "completed")
  const anyProgress = properties.some(
    ({ status }) => status === "completed" || status === "partial",
  )
  return WatchRouteAlertsOutputSchema.parse({
    ok: allCompleted,
    mode,
    reason: allCompleted ? "completed" : anyProgress ? "partial" : "failed",
    properties,
  })
}

const watchRouteAlertStep = createStep({
  id: "run-watch-route-alert-audit",
  inputSchema: WatchRouteAlertsInputSchema,
  outputSchema: WatchRouteAlertsOutputSchema,
  execute: ({ inputData }) => runWatchRouteAlerts(inputData),
})

export const watchRouteAlertsWorkflow = createWorkflow({
  id: "watch-route-alerts",
  description:
    "Reads GA4 Watch not-found signals, verifies route evidence, and reconciles the Admin alert ledger.",
  inputSchema: WatchRouteAlertsInputSchema,
  outputSchema: WatchRouteAlertsOutputSchema,
  schedule: { cron: "15 12 * * *", timezone: "UTC" },
})
  .then(watchRouteAlertStep)
  .commit()
