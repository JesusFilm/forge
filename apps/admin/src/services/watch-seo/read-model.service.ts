// Bounded per-page read model for the admin-only Watch SEO tab (feat-712).
//
// It only reads what Admin already retains: the Video/VideoLocale rows, the
// SEO ledger (proposals, versions, decisions, materializations, experiments,
// evaluations), retained GSC selection decisions inside completed SeoRun
// reports, stored crawler observations, the Watch SEO manifest snapshot, and
// the Watch route-alert ledger. It never calls a provider. Every query is
// bounded by an indexed key, a 29-day window, or a LIMIT; JSON is filtered
// inside Postgres so no report body is ever scanned in the Node process. The
// raw JSON reads also run under a transaction-local `statement_timeout`, so a
// section that exceeds its budget is cancelled in Postgres rather than only
// abandoned by the JS race in `guarded`.
//
// A measurement that has no durable per-page source is returned as an explicit
// `not_connected`/`unavailable` section. It is never zero, never fabricated.

import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { buildCanonicalWatchVideoPath } from "@forge/watch-url-policy/routes"
import { env } from "@/config/env"
import { WATCH_SEO_MANIFEST_SNAPSHOT_KEY } from "@/services/watch-seo-manifest-store"
import {
  WATCH_SEO_ALERT_MONITOR_STALE_AFTER_MS,
  WATCH_SEO_DETAIL_WINDOW_DAYS,
  WATCH_SEO_DETAIL_WINDOW_MS,
  WATCH_SEO_MANIFEST_STALE_AFTER_MS,
  WATCH_SEO_READ_MODEL_VERSION,
  WATCH_SEO_STALE_AFTER_MS,
  type WatchSeoCrawlObservation,
  type WatchSeoEvaluation,
  type WatchSeoExperiment,
  type WatchSeoHreflang,
  type WatchSeoIdentity,
  type WatchSeoPageMetadata,
  type WatchSeoProposal,
  type WatchSeoProposalChange,
  type WatchSeoProposals,
  type WatchSeoProviderCoverage,
  type WatchSeoReadModel,
  type WatchSeoRouteAlerts,
  type WatchSeoSearch,
  type WatchSeoSearchQuery,
  type WatchSeoSection,
  type WatchSeoSectionReason,
  type WatchSeoSource,
} from "./contract"

const SECTION_BUDGET_MS = 4_000
// The DB-side bound for each raw read. Pool wait + statement must finish
// inside the JS section budget, and Prisma's transaction timeout stays
// strictly above the statement timeout so Postgres' 57014 cancel wins the
// race (a P2028 alone would not stop the running statement).
const RAW_READ_STATEMENT_TIMEOUT_MS = 2_500
const RAW_READ_TRANSACTION_TIMEOUT_MS = 3_000
const RAW_READ_MAX_WAIT_MS = 800
const RAW_READ_STATEMENT_TIMEOUT_SQL = `SET LOCAL statement_timeout = '${RAW_READ_STATEMENT_TIMEOUT_MS}ms'`
const MAX_SEARCH_RUNS = 8
const MAX_SEARCH_QUERIES = 50
const MAX_PROPOSALS = 10
const MAX_EVALUATIONS = 5
const MAX_ALTERNATES = 200
const MAX_ROUTE_ALERTS = 5
const MAX_TEXT = 600
const MAX_CAVEATS = 10
const MAX_CHANGES = 10

type ReadModelDb = Pick<
  PrismaClient,
  | "video"
  | "seoRun"
  | "seoProposal"
  | "watchRouteAlert"
  | "watchRouteAlertPropertyProgress"
  | "$transaction"
>

export type WatchSeoPageRef = {
  videoSlug: string
  languageSlug: string
  contextualParentSlug: string | null
}

export class WatchSeoPageNotFoundError extends Error {
  constructor() {
    super("Watch SEO page not found")
    this.name = "WatchSeoPageNotFoundError"
  }
}

// ---------------------------------------------------------------------------
// Section helpers
// ---------------------------------------------------------------------------

function section<T>(
  source: WatchSeoSource,
  patch: Partial<WatchSeoSection<T>> & Pick<WatchSeoSection<T>, "state">,
): WatchSeoSection<T> {
  return {
    reason: null,
    retrievedAt: null,
    window: null,
    data: null,
    caveats: [],
    ...patch,
    source,
  }
}

const NOT_CONNECTED_SOURCE: WatchSeoSource = {
  kind: "not_connected",
  provider: null,
}

function notConnected(
  reason: WatchSeoSectionReason,
  caveat: string,
): WatchSeoSection<never> {
  return section<never>(NOT_CONNECTED_SOURCE, {
    state: "not_connected",
    reason,
    caveats: [caveat],
  })
}

function failed<T>(source: WatchSeoSource): WatchSeoSection<T> {
  return section<T>(source, { state: "unavailable", reason: "read_failed" })
}

async function guarded<T>(
  name: string,
  source: WatchSeoSource,
  load: () => Promise<WatchSeoSection<T>>,
): Promise<WatchSeoSection<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("section_timeout")),
          SECTION_BUDGET_MS,
        )
      }),
    ])
  } catch (error) {
    // Plain-string key=value; the section name is a closed literal and the
    // error class carries no evidence text.
    console.warn(
      `[watch-seo] event=section_failed section=${name} error=${error instanceof Error ? error.name : "UnknownError"}`,
    )
    return failed<T>(source)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function clip(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === "string" ? value.slice(0, max) : null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class WatchSeoReadModelService {
  constructor(
    private readonly db: ReadModelDb,
    private readonly options: { now?: () => Date; origin?: string } = {},
  ) {}

  private now(): Date {
    return this.options.now ? this.options.now() : new Date()
  }

  /**
   * Runs one raw read inside a short transaction whose first statement sets a
   * transaction-local statement timeout, so Postgres itself cancels a read
   * that outlives its budget. `SET LOCAL` dies with the transaction and never
   * leaks onto the pooled connection.
   */
  private boundedRaw<T>(query: Prisma.Sql): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(RAW_READ_STATEMENT_TIMEOUT_SQL)
        return tx.$queryRaw<T>(query)
      },
      {
        maxWait: RAW_READ_MAX_WAIT_MS,
        timeout: RAW_READ_TRANSACTION_TIMEOUT_MS,
      },
    )
  }

  async read(ref: WatchSeoPageRef): Promise<WatchSeoReadModel> {
    const now = this.now()
    const windowStart = new Date(now.getTime() - WATCH_SEO_DETAIL_WINDOW_MS)
    const target = await this.resolveTarget(ref)
    const { identity } = target

    const [
      pageMetadata,
      hreflang,
      search,
      crawl,
      providerCoverage,
      routeAlerts,
      proposals,
    ] = await Promise.all([
      Promise.resolve(this.pageMetadata(target)),
      guarded("hreflang", MANIFEST_SOURCE, () => this.hreflang(ref, now)),
      guarded("search", GSC_SOURCE, () =>
        this.search(identity, now, windowStart),
      ),
      guarded("crawl", OBSERVATION_SOURCE, () =>
        this.crawl(identity, now, windowStart),
      ),
      guarded("providerCoverage", LEDGER_SOURCE, () =>
        this.providerCoverage(windowStart),
      ),
      guarded("routeAlerts", ALERT_SOURCE, () =>
        this.routeAlerts(identity, now),
      ),
      guarded("proposals", LEDGER_SOURCE, () => this.proposals(identity, now)),
    ])

    return {
      version: WATCH_SEO_READ_MODEL_VERSION,
      generatedAt: now.toISOString(),
      detailWindowDays: WATCH_SEO_DETAIL_WINDOW_DAYS,
      identity,
      sections: {
        pageMetadata,
        hreflang,
        search,
        crawl,
        providerCoverage,
        // No durable per-page source yet for the families below. They are
        // explicit, never numeric zero, so a consumer cannot misread absence.
        ga4PageAndCta: notConnected(
          "no_per_page_projection",
          "GA4 observations are stored as property-level landing-page aggregates and are not projected per Watch page yet.",
        ),
        watchDepth: notConnected(
          "no_watch_depth_source",
          "Broad watch-depth milestones are not persisted per page; no value is shown rather than a guess.",
        ),
        aiReferrals: notConnected(
          "no_ai_referral_source",
          "AI-assistant referral traffic is not connected to a durable per-page source.",
        ),
        botVisits: notConnected(
          "no_bot_log_source",
          "No crawler/bot visit log is retained; absence of data is not evidence of no visits.",
        ),
        cacheHistory: notConnected(
          "no_cache_history_source",
          "Page cache history is not retained; the crawl section reports only a fetcher's own cache state.",
        ),
        routeAlerts,
        proposals,
      },
    }
  }

  // -------------------------------------------------------------------------
  // Identity: one bounded row lookup, then derived canonical strings.
  // -------------------------------------------------------------------------

  private async resolveTarget(ref: WatchSeoPageRef) {
    const video = await this.db.video.findFirst({
      where: { slug: ref.videoSlug, deletedAt: null },
      select: {
        slug: true,
        noIndex: true,
        locales: {
          where: { languageSlug: ref.languageSlug, deletedAt: null },
          take: 1,
          orderBy: { id: "asc" },
          select: {
            id: true,
            locale: true,
            languageSlug: true,
            status: true,
            title: true,
            description: true,
            searchTitle: true,
            searchDescription: true,
            socialImageAssetId: true,
            updatedAt: true,
          },
        },
      },
    })
    const locale = video?.locales[0]
    if (!video || !locale) throw new WatchSeoPageNotFoundError()

    const origin = this.options.origin ?? env.WEB_CANONICAL_ORIGIN
    const canonicalPath = `/watch${buildCanonicalWatchVideoPath(video.slug, ref.languageSlug)}`
    const identity: WatchSeoIdentity = {
      videoSlug: video.slug,
      languageSlug: ref.languageSlug,
      locale: locale.locale,
      videoLocaleId: locale.id,
      canonicalUrl: `${origin}${canonicalPath}`,
      canonicalPath,
      contextualParentSlug: ref.contextualParentSlug,
      noIndex: video.noIndex,
    }
    return { identity, locale }
  }

  private pageMetadata(target: {
    locale: {
      status: string
      title: string | null
      description: string | null
      searchTitle: string | null
      searchDescription: string | null
      socialImageAssetId: string | null
      updatedAt: Date
    }
  }): WatchSeoSection<WatchSeoPageMetadata> {
    const { locale } = target
    return section(DATABASE_SOURCE, {
      state: "available",
      retrievedAt: locale.updatedAt.toISOString(),
      data: {
        status: locale.status,
        title: clip(locale.title, 500),
        description: clip(locale.description, 1000),
        searchTitle: clip(locale.searchTitle, 500),
        searchDescription: clip(locale.searchDescription, 1000),
        hasSocialImage: locale.socialImageAssetId != null,
        updatedAt: locale.updatedAt.toISOString(),
      },
    })
  }

  // -------------------------------------------------------------------------
  // hreflang: one jsonb path lookup against the single manifest snapshot row.
  // -------------------------------------------------------------------------

  private async hreflang(
    ref: WatchSeoPageRef,
    now: Date,
  ): Promise<WatchSeoSection<WatchSeoHreflang>> {
    const rows = await this.boundedRaw<
      Array<{
        version: string
        generatedAt: Date
        videoGroup: unknown
        episodeGroup: unknown
      }>
    >(Prisma.sql`
      SELECT
        "version",
        "generated_at" AS "generatedAt",
        jsonb_path_query_first(
          "payload" -> 'videoRouteGroups',
          '$[*] ? (@.contentSlug == $slug)',
          jsonb_build_object('slug', ${ref.videoSlug}::text),
          true
        ) AS "videoGroup",
        jsonb_path_query_first(
          "payload" -> 'episodeRouteGroups',
          '$[*] ? (@.parentSlug == $parent && @.childSlug == $child)',
          jsonb_build_object(
            'parent', ${ref.contextualParentSlug ?? ""}::text,
            'child', ${ref.videoSlug}::text
          ),
          true
        ) AS "episodeGroup"
      FROM "watch_seo_manifest_snapshot"
      WHERE "key" = ${WATCH_SEO_MANIFEST_SNAPSHOT_KEY}
      LIMIT 1
    `)
    const row = rows[0]
    if (!row) {
      return section(MANIFEST_SOURCE, {
        state: "unavailable",
        reason: "no_manifest_snapshot",
      })
    }
    // The standalone video group is the search-canonical alternates set; an
    // episode group only describes the contextual route.
    const group = record(
      ref.contextualParentSlug ? row.episodeGroup : row.videoGroup,
    )
    const alternatesRaw = Array.isArray(group.alternates)
      ? group.alternates
      : []
    const alternates = alternatesRaw
      .map((entry) => record(entry))
      .filter(
        (entry) =>
          typeof entry.hreflang === "string" &&
          typeof entry.languageSlug === "string",
      )
      .slice(0, MAX_ALTERNATES)
      .map((entry) => ({
        hreflang: String(entry.hreflang).slice(0, 35),
        languageSlug: String(entry.languageSlug).slice(0, 100),
      }))
    const stale =
      now.getTime() - new Date(row.generatedAt).getTime() >
      WATCH_SEO_MANIFEST_STALE_AFTER_MS
    return section(MANIFEST_SOURCE, {
      state: stale ? "stale" : "available",
      retrievedAt: new Date(row.generatedAt).toISOString(),
      data: {
        inManifest: Object.keys(group).length > 0,
        manifestVersion: String(row.version).slice(0, 191),
        alternates,
        omittedAlternateCount: Math.max(
          0,
          alternatesRaw.length - alternates.length,
        ),
      },
    })
  }

  // -------------------------------------------------------------------------
  // Search: retained GSC selection decisions, filtered inside Postgres.
  // Native enum literals (not `status::text`) keep the predicate sargable on
  // `seo_run_status_completed_at_idx (status, completed_at)`, so the window
  // bound and ORDER BY ... LIMIT read only in-window terminal runs.
  // -------------------------------------------------------------------------

  private async search(
    identity: WatchSeoIdentity,
    now: Date,
    windowStart: Date,
  ): Promise<WatchSeoSection<WatchSeoSearch>> {
    const runs = await this.boundedRaw<
      Array<{
        completedAt: Date
        status: string
        providerCoverage: unknown
        decisions: unknown
      }>
    >(Prisma.sql`
      SELECT
        r."completed_at" AS "completedAt",
        r."status"::text AS "status",
        r."provider_coverage" AS "providerCoverage",
        COALESCE(
          jsonb_path_query_array(
            r."report" -> 'queryDecisions',
            '$[*] ? (@.targetId == $targetId)',
            jsonb_build_object('targetId', ${identity.videoLocaleId}::text),
            true
          ),
          '[]'::jsonb
        ) AS "decisions"
      FROM "seo_run" r
      WHERE r."status" IN (
          'completed'::"SeoRunStatus",
          'partial'::"SeoRunStatus"
        )
        AND r."completed_at" > ${windowStart}
        AND r."report" ->> 'schemaVersion' = '1'
        AND r."report" ->> 'detailState' = 'available'
      ORDER BY r."completed_at" DESC
      LIMIT ${MAX_SEARCH_RUNS}
    `)

    // Defence in depth for the 29-day boundary: a row completed exactly 29
    // days ago is already expired, whatever the SQL clock said.
    const inWindow = runs.filter(
      (run) => new Date(run.completedAt).getTime() > windowStart.getTime(),
    )

    if (inWindow.length === 0) {
      const aged = await this.db.seoRun.findFirst({
        where: {
          status: { in: ["COMPLETED", "PARTIAL"] },
          completedAt: { lte: windowStart },
        },
        select: { id: true },
      })
      return aged
        ? section(GSC_SOURCE, {
            state: "compacted",
            reason: "detail_window_elapsed",
            caveats: [
              `Query-level detail is retained for ${WATCH_SEO_DETAIL_WINDOW_DAYS} days and has been compacted.`,
            ],
          })
        : section(GSC_SOURCE, { state: "unavailable", reason: "no_recent_run" })
    }

    const byQuery = new Map<string, WatchSeoSearchQuery>()
    let dropped = 0
    let contributingRuns = 0
    let anyPartial = false
    let latestRowAt: Date | null = null
    for (const run of inWindow) {
      const parsed = z.array(z.unknown()).max(100).safeParse(run.decisions)
      const decisions = parsed.success ? parsed.data : []
      let contributed = false
      for (const raw of decisions) {
        const row = SearchDecisionRow.safeParse(raw)
        if (!row.success) {
          dropped += 1
          continue
        }
        contributed = true
        // Runs are newest-first, so the first sighting of a query is latest.
        if (!byQuery.has(row.data.query)) {
          byQuery.set(row.data.query, {
            query: row.data.query,
            clicks: row.data.clicks,
            impressions: row.data.impressions,
            ctr: row.data.ctr,
            position: row.data.position,
            observedAt: new Date(run.completedAt).toISOString(),
          })
        }
      }
      if (contributed) {
        contributingRuns += 1
        const completedAt = new Date(run.completedAt)
        if (!latestRowAt || completedAt > latestRowAt) latestRowAt = completedAt
        if (
          run.status === "partial" ||
          sanitizeCoverage(run.providerCoverage).gsc !== "available"
        ) {
          anyPartial = true
        }
      }
    }

    const caveat =
      "Retained selection decisions only: queries below the selection thresholds are not listed, and absence from this list is unknown, not zero."
    const window = {
      start: windowStart.toISOString(),
      end: now.toISOString(),
    }
    if (byQuery.size === 0) {
      return section(GSC_SOURCE, {
        state: "unavailable",
        reason: "no_retained_rows_for_page",
        window,
        caveats: [caveat],
      })
    }

    const sorted = [...byQuery.values()].sort(
      (left, right) => right.impressions - left.impressions,
    )
    const queries = sorted.slice(0, MAX_SEARCH_QUERIES)
    const stale =
      latestRowAt != null &&
      now.getTime() - latestRowAt.getTime() > WATCH_SEO_STALE_AFTER_MS
    return section(GSC_SOURCE, {
      state: stale
        ? "stale"
        : anyPartial || dropped > 0
          ? "partial"
          : "available",
      retrievedAt: iso(latestRowAt),
      window,
      caveats: [
        caveat,
        "A smaller position number is a better search ranking.",
      ],
      data: {
        kind: "retained_selection_decisions",
        queries,
        omittedQueryCount: sorted.length - queries.length,
        droppedMalformedRowCount: dropped,
        runCount: contributingRuns,
      },
    })
  }

  // -------------------------------------------------------------------------
  // Crawl: latest stored page-state observation scoped to this canonical URL.
  // -------------------------------------------------------------------------

  private async crawl(
    identity: WatchSeoIdentity,
    now: Date,
    windowStart: Date,
  ): Promise<WatchSeoSection<WatchSeoCrawlObservation>> {
    const rows = await this.boundedRaw<
      Array<{
        provider: string
        retrievedAt: Date
        quality: unknown
        title: unknown
        description: unknown
        statusCode: unknown
        contentType: unknown
        cacheState: unknown
        cachedAt: unknown
        renderingMode: unknown
      }>
    >(Prisma.sql`
      SELECT
        "provider"::text AS "provider",
        "retrieved_at" AS "retrievedAt",
        "quality",
        "payload" ->> 'title' AS "title",
        "payload" ->> 'description' AS "description",
        "payload" ->> 'statusCode' AS "statusCode",
        "payload" ->> 'contentType' AS "contentType",
        "payload" ->> 'cacheState' AS "cacheState",
        "payload" ->> 'cachedAt' AS "cachedAt",
        "payload" ->> 'renderingMode' AS "renderingMode"
      FROM "seo_evidence_observation"
      WHERE "provider" IN (
          'firecrawl'::"SeoEvidenceProvider",
          'direct_page'::"SeoEvidenceProvider"
        )
        AND "retrieved_at" > ${windowStart}
        AND "expires_at" > ${now}
        AND "scope" ->> 'canonicalUrl' = ${identity.canonicalUrl}
      ORDER BY "retrieved_at" DESC
      LIMIT 1
    `)
    const row = rows[0]
    if (!row || new Date(row.retrievedAt).getTime() <= windowStart.getTime()) {
      return section(OBSERVATION_SOURCE, {
        state: "unavailable",
        reason: "no_recent_observation",
      })
    }
    const quality = record(row.quality)
    const complete = quality.complete === true && quality.truncated !== true
    const status = Number(row.statusCode)
    const retrievedAt = new Date(row.retrievedAt)
    const stale =
      now.getTime() - retrievedAt.getTime() > WATCH_SEO_STALE_AFTER_MS
    const provider =
      row.provider === "direct_page" ? "direct_page" : "firecrawl"
    return section(
      { kind: "stored_observation", provider },
      {
        state: stale ? "stale" : complete ? "available" : "partial",
        retrievedAt: retrievedAt.toISOString(),
        window: { start: windowStart.toISOString(), end: now.toISOString() },
        caveats: [
          "A fetched page state does not prove Google indexed or ranked the page, and is not a bot visit log.",
        ],
        data: {
          kind: "page_state_fetch",
          provider,
          renderingMode:
            row.renderingMode === "direct_http" ||
            row.renderingMode === "rendered"
              ? row.renderingMode
              : null,
          httpStatus:
            Number.isInteger(status) && status >= 100 && status <= 599
              ? status
              : null,
          contentType: clip(row.contentType, 191),
          title: clip(row.title, 500),
          description: clip(row.description, 1000),
          fetcherCacheState: clip(row.cacheState, 100),
          fetcherCachedAt: clip(row.cachedAt, 64),
          complete,
        },
      },
    )
  }

  // -------------------------------------------------------------------------
  // Provider coverage: the latest in-window terminal run's declared coverage.
  // -------------------------------------------------------------------------

  private async providerCoverage(
    windowStart: Date,
  ): Promise<WatchSeoSection<WatchSeoProviderCoverage>> {
    const run = await this.db.seoRun.findFirst({
      where: {
        status: { in: ["COMPLETED", "PARTIAL"] },
        completedAt: { gt: windowStart },
      },
      orderBy: { completedAt: "desc" },
      select: { completedAt: true, status: true, providerCoverage: true },
    })
    if (!run?.completedAt) {
      return section(LEDGER_SOURCE, {
        state: "unavailable",
        reason: "no_recent_run",
      })
    }
    return section(LEDGER_SOURCE, {
      state: run.status === "PARTIAL" ? "partial" : "available",
      retrievedAt: run.completedAt.toISOString(),
      data: {
        latestRunAt: run.completedAt.toISOString(),
        latestRunStatus: run.status === "PARTIAL" ? "partial" : "completed",
        providers: sanitizeCoverage(run.providerCoverage),
      },
    })
  }

  // -------------------------------------------------------------------------
  // Watch route alerts: indexed path lookup + monitor-progress coverage.
  // -------------------------------------------------------------------------

  private async routeAlerts(
    identity: WatchSeoIdentity,
    now: Date,
  ): Promise<WatchSeoSection<WatchSeoRouteAlerts>> {
    const [alerts, progress] = await Promise.all([
      this.db.watchRouteAlert.findMany({
        where: { normalizedPath: identity.canonicalPath },
        orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
        take: MAX_ROUTE_ALERTS,
        select: {
          lifecycle: true,
          verdict: true,
          severity: true,
          latestCount: true,
          countKind: true,
          activeUsers: true,
          firstSeenAt: true,
          lastSeenAt: true,
          lastProbedAt: true,
          lastHttpStatus: true,
          lastProbeKind: true,
          recoveredAt: true,
        },
      }),
      this.db.watchRouteAlertPropertyProgress.findFirst({
        orderBy: { lastCompleteWindowEnd: "desc" },
        select: { lastCompleteWindowEnd: true },
      }),
    ])
    const monitoredThrough = progress?.lastCompleteWindowEnd ?? null
    // "No alert" only means something when the monitor has actually run.
    if (!monitoredThrough && alerts.length === 0) {
      return section(ALERT_SOURCE, {
        state: "unavailable",
        reason: "monitor_not_run",
      })
    }
    const stale =
      !monitoredThrough ||
      now.getTime() - monitoredThrough.getTime() >
        WATCH_SEO_ALERT_MONITOR_STALE_AFTER_MS
    return section(ALERT_SOURCE, {
      state: stale ? "stale" : "available",
      retrievedAt: iso(monitoredThrough),
      data: {
        monitoredThrough: iso(monitoredThrough),
        alerts: alerts.map((alert) => ({
          lifecycle: String(alert.lifecycle),
          verdict: String(alert.verdict),
          severity: String(alert.severity),
          latestCount: alert.latestCount,
          countKind: String(alert.countKind),
          activeUsers: alert.activeUsers,
          firstSeenAt: alert.firstSeenAt.toISOString(),
          lastSeenAt: alert.lastSeenAt.toISOString(),
          lastProbedAt: iso(alert.lastProbedAt),
          lastHttpStatus: alert.lastHttpStatus,
          lastProbeKind: clip(alert.lastProbeKind, 32),
          recoveredAt: iso(alert.recoveredAt),
        })),
      },
    })
  }

  // -------------------------------------------------------------------------
  // Proposals + experiments: ledger rows bound to this exact page identity.
  // -------------------------------------------------------------------------

  private async proposals(
    identity: WatchSeoIdentity,
    now: Date,
  ): Promise<WatchSeoSection<WatchSeoProposals>> {
    const rows = await this.db.seoProposal.findMany({
      where: {
        OR: [
          { targetType: "VideoLocale", targetId: identity.videoLocaleId },
          { canonicalUrl: identity.canonicalUrl },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: MAX_PROPOSALS,
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          include: {
            run: { select: { createdAt: true } },
            decision: true,
            materialization: true,
            ticketOutbox: { select: { id: true } },
            experiment: {
              include: {
                evaluations: {
                  orderBy: { observedAt: "desc" },
                  take: MAX_EVALUATIONS,
                },
              },
            },
          },
        },
      },
    })

    const proposals: WatchSeoProposal[] = []
    for (const row of rows) {
      const version = row.versions[0]
      if (!version) continue
      // Detail reads must enforce retention even before background compaction.
      // Keep immutable proposal identity and outcomes, but never carry old
      // query-bearing prose/diffs through this read surface. The ledger and
      // Admin decision flow remain unchanged.
      const cutoff = now.getTime() - WATCH_SEO_DETAIL_WINDOW_MS
      const detailAvailable =
        version.createdAt.getTime() > cutoff &&
        version.run.createdAt.getTime() > cutoff
      proposals.push({
        id: row.id,
        version: version.version,
        payloadDigest: version.payloadDigest,
        status: row.status,
        decisionState: decisionState(row.status, row.expiresAt, now),
        lane: row.lane,
        intent: detailAvailable
          ? version.intent.slice(0, MAX_TEXT)
          : "Proposal detail expired",
        expectedOutcome: detailAvailable
          ? version.expectedOutcome.slice(0, MAX_TEXT)
          : "Unavailable",
        risk: detailAvailable ? version.risk.slice(0, MAX_TEXT) : "Unavailable",
        verificationPlan: detailAvailable
          ? version.verificationPlan.slice(0, MAX_TEXT)
          : "Unavailable",
        rollbackPlan: detailAvailable
          ? version.rollbackPlan.slice(0, MAX_TEXT)
          : "Unavailable",
        affectedFields: detailAvailable
          ? version.affectedFields.slice(0, 20)
          : [],
        changes: detailAvailable ? editorialChanges(version.editorialDiff) : [],
        caveats: detailAvailable
          ? version.caveats.slice(0, MAX_CAVEATS).map((c) => c.slice(0, 500))
          : [
              "Detailed proposal evidence is outside its 29-day retention window.",
            ],
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        decision: version.decision
          ? {
              action: version.decision.action,
              decidedAt: version.decision.decidedAt.toISOString(),
            }
          : null,
        materialization: version.materialization
          ? {
              status: version.materialization.status,
              hasDraft: version.materialization.contentRevisionId != null,
              hasTicket: version.ticketOutbox != null,
            }
          : null,
        experiment: version.experiment
          ? experimentRecord(version.experiment)
          : null,
      })
    }

    // The ledger is Admin's own authoritative store, so an empty list is a
    // measured "no proposals", not an unknown.
    return section(LEDGER_SOURCE, {
      state: "available",
      data: { proposals },
    })
  }
}

// ---------------------------------------------------------------------------
// Pure projections
// ---------------------------------------------------------------------------

const SearchDecisionRow = z.object({
  query: z.string().max(500),
  clicks: z.number().finite().nonnegative(),
  impressions: z.number().finite().nonnegative(),
  ctr: z.number().finite().nonnegative(),
  position: z.number().finite().nonnegative(),
})

function sanitizeCoverage(
  value: unknown,
): Record<string, "available" | "partial" | "unavailable"> {
  return Object.fromEntries(
    Object.entries(record(value))
      .slice(0, 20)
      .map(([provider, status]) => [
        provider.slice(0, 100),
        status === "available" || status === "partial"
          ? status
          : ("unavailable" as const),
      ]),
  )
}

function decisionState(
  status: string,
  expiresAt: Date,
  now: Date,
): WatchSeoProposal["decisionState"] {
  if (status === "STALE") return "stale"
  if (status === "MATERIALIZED") return "materialized"
  if (status === "APPROVED" || status === "REJECTED") return "decided"
  if (status === "EXPIRED" || expiresAt.getTime() <= now.getTime()) {
    return "expired"
  }
  return "current"
}

function editorialChanges(diff: unknown): WatchSeoProposalChange[] {
  return Object.entries(record(diff))
    .slice(0, MAX_CHANGES)
    .map(([field, value]) => {
      const exact = record(value)
      const hasPair = "before" in exact || "after" in exact
      return {
        field: field.slice(0, 100),
        before: hasPair ? scalarText(exact.before) : null,
        after: hasPair ? scalarText(exact.after) : scalarText(value),
      }
    })
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") return value.slice(0, 300)
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return null
}

function numericMetrics(value: unknown): Record<string, number> {
  const metrics: Record<string, number> = {}
  for (const [key, nested] of Object.entries(record(value)).slice(0, 12)) {
    if (typeof nested === "number" && Number.isFinite(nested)) {
      metrics[key.slice(0, 64)] = nested
    }
  }
  return metrics
}

function experimentRecord(experiment: {
  status: string
  activatedAt: Date | null
  measurementStartsAt: Date | null
  interimDueAt: Date | null
  finalDueAt: Date | null
  confounders: unknown
  evaluations: Array<{
    kind: string
    outcome: string
    observedAt: Date
    metrics: unknown
  }>
}): WatchSeoExperiment {
  const evaluations: WatchSeoEvaluation[] = [...experiment.evaluations]
    .reverse()
    .map((event) => ({
      kind: event.kind,
      outcome: event.outcome.slice(0, 100),
      observedAt: event.observedAt.toISOString(),
      metrics: numericMetrics(event.metrics),
    }))
  return {
    status: experiment.status,
    activatedAt: iso(experiment.activatedAt),
    measurementStartsAt: iso(experiment.measurementStartsAt),
    interimDueAt: iso(experiment.interimDueAt),
    finalDueAt: iso(experiment.finalDueAt),
    confounderCount: Array.isArray(experiment.confounders)
      ? experiment.confounders.length
      : 0,
    evaluations,
  }
}

const DATABASE_SOURCE: WatchSeoSource = {
  kind: "admin_database",
  provider: null,
}
const LEDGER_SOURCE: WatchSeoSource = {
  kind: "retained_ledger",
  provider: null,
}
const GSC_SOURCE: WatchSeoSource = { kind: "retained_ledger", provider: "gsc" }
const OBSERVATION_SOURCE: WatchSeoSource = {
  kind: "stored_observation",
  provider: "firecrawl",
}
const MANIFEST_SOURCE: WatchSeoSource = {
  kind: "manifest_snapshot",
  provider: null,
}
const ALERT_SOURCE: WatchSeoSource = {
  kind: "route_alert_ledger",
  provider: "ga4",
}
