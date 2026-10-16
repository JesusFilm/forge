import type { Prisma } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Only `Prisma.sql` is used at runtime; the tagged-template stand-in keeps the
// same `strings`/`values` shape so SQL-shape assertions match production, and
// the suite does not depend on a generated Prisma client.
vi.mock("@prisma/client", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: [...strings],
      values,
    }),
  },
}))

vi.mock("@/config/env", () => ({
  env: { WEB_CANONICAL_ORIGIN: "https://www.jesusfilm.org" },
}))

const { WatchSeoReadModelService, WatchSeoPageNotFoundError } =
  await import("./read-model.service")
type WatchSeoPageRef = import("./read-model.service").WatchSeoPageRef
const {
  WATCH_SEO_DETAIL_WINDOW_MS,
  WATCH_SEO_SECTION_KEYS,
  WATCH_SEO_STALE_AFTER_MS,
} = await import("./contract")

const NOW = new Date("2026-10-16T12:00:00.000Z")
const DAY = 24 * 60 * 60 * 1000
const WINDOW_START = new Date(NOW.getTime() - WATCH_SEO_DETAIL_WINDOW_MS)
const LOCALE_ID = "vl-1"

type RawHandler = (sql: Prisma.Sql) => unknown

function sqlText(sql: Prisma.Sql): string {
  return sql.strings.join("?")
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    observationId: "obs-1",
    targetId: LOCALE_ID,
    locale: "en",
    canonicalUrl: "https://www.jesusfilm.org/watch/jesus.html/english.html",
    query: "jesus film",
    clicks: 12,
    impressions: 480,
    ctr: 0.025,
    position: 8.4,
    score: 1,
    selectionOutcome: "selected",
    reason: "selected",
    ...overrides,
  }
}

function searchRun(
  completedAt: Date,
  decisions: unknown[],
  extra: Record<string, unknown> = {},
) {
  return {
    completedAt,
    status: "completed",
    providerCoverage: { gsc: "available", ga4: "unavailable" },
    decisions,
    ...extra,
  }
}

type Overrides = {
  video?: unknown
  searchRuns?: unknown[]
  crawlRows?: unknown[]
  manifestRows?: unknown[]
  agedRun?: unknown
  coverageRun?: unknown
  alerts?: unknown[]
  progress?: unknown
  proposals?: unknown[]
  raw?: RawHandler
}

function makeDb(overrides: Overrides = {}) {
  const videoRow =
    "video" in overrides
      ? overrides.video
      : {
          slug: "jesus",
          noIndex: false,
          locales: [
            {
              id: LOCALE_ID,
              locale: "en",
              languageSlug: "english",
              status: "PUBLISHED",
              title: "Jesus",
              description: "The story of Jesus",
              searchTitle: null,
              searchDescription: null,
              socialImageAssetId: "asset-1",
              updatedAt: new Date("2026-10-01T00:00:00.000Z"),
            },
          ],
        }
  const queryRaw = vi.fn(async (sql: Prisma.Sql) => {
    if (overrides.raw) return overrides.raw(sql)
    const text = sqlText(sql)
    if (text.includes("watch_seo_manifest_snapshot")) {
      return overrides.manifestRows ?? []
    }
    if (text.includes('FROM "seo_run"')) return overrides.searchRuns ?? []
    if (text.includes("seo_evidence_observation")) {
      return overrides.crawlRows ?? []
    }
    throw new Error(`unexpected raw query: ${text}`)
  })
  const db = {
    video: { findFirst: vi.fn(async () => videoRow) },
    seoRun: {
      findFirst: vi.fn(async (args: { select: Record<string, boolean> }) =>
        args.select.id
          ? (overrides.agedRun ?? null)
          : (overrides.coverageRun ?? null),
      ),
    },
    seoProposal: {
      findMany: vi.fn(async (_args?: unknown) => overrides.proposals ?? []),
    },
    watchRouteAlert: {
      findMany: vi.fn(async (_args?: unknown) => overrides.alerts ?? []),
    },
    watchRouteAlertPropertyProgress: {
      findFirst: vi.fn(async () => overrides.progress ?? null),
    },
  }
  // Each transaction records its own ordered statements so a test can prove
  // the timeout was set inside the SAME transaction as the read it bounds.
  const txLog: Array<Array<{ kind: "exec" | "query"; text: string }>> = []
  const executeRawUnsafe = vi.fn(async (_sql: string) => 0)
  const transaction = vi.fn(
    async (
      fn: (tx: unknown) => Promise<unknown>,
      _options?: { maxWait?: number; timeout?: number },
    ) => {
      const log: Array<{ kind: "exec" | "query"; text: string }> = []
      txLog.push(log)
      return fn({
        $executeRawUnsafe: async (text: string) => {
          log.push({ kind: "exec", text })
          return executeRawUnsafe(text)
        },
        $queryRaw: async (sql: Prisma.Sql) => {
          log.push({ kind: "query", text: sqlText(sql) })
          return queryRaw(sql)
        },
      })
    },
  )
  Object.assign(db, { $transaction: transaction })
  return {
    db: db as unknown as ConstructorParameters<
      typeof WatchSeoReadModelService
    >[0],
    raw: db,
    queryRaw,
    executeRawUnsafe,
    transaction,
    txLog,
  }
}

const ref: WatchSeoPageRef = {
  videoSlug: "jesus",
  languageSlug: "english",
  contextualParentSlug: null,
}

async function read(overrides: Overrides = {}, pageRef = ref) {
  const { db, raw, queryRaw, executeRawUnsafe, transaction, txLog } =
    makeDb(overrides)
  const model = await new WatchSeoReadModelService(db, {
    now: () => NOW,
  }).read(pageRef)
  return { model, raw, queryRaw, executeRawUnsafe, transaction, txLog }
}

describe("WatchSeoReadModelService", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
  })

  describe("identity", () => {
    it("distinguishes the search canonical from the contextual route", async () => {
      const { model } = await read(
        {},
        { ...ref, videoSlug: "jesus", contextualParentSlug: "series-a" },
      )
      expect(model.version).toBe("watch-seo-read-model/v1")
      expect(model.detailWindowDays).toBe(29)
      expect(model.identity).toMatchObject({
        videoSlug: "jesus",
        languageSlug: "english",
        locale: "en",
        videoLocaleId: LOCALE_ID,
        contextualParentSlug: "series-a",
        noIndex: false,
      })
      expect(model.identity.canonicalUrl).toBe(
        `https://www.jesusfilm.org${model.identity.canonicalPath}`,
      )
      expect(model.identity.canonicalPath.startsWith("/watch/")).toBe(true)
      // The contextual parent never leaks into the standalone canonical.
      expect(model.identity.canonicalUrl).not.toContain("series-a")
    })

    it("throws a typed not-found for an unknown video or an unpublished-away locale", async () => {
      const { db } = makeDb({ video: null })
      await expect(
        new WatchSeoReadModelService(db, { now: () => NOW }).read(ref),
      ).rejects.toBeInstanceOf(WatchSeoPageNotFoundError)
      const noLocale = makeDb({
        video: { slug: "jesus", noIndex: false, locales: [] },
      })
      await expect(
        new WatchSeoReadModelService(noLocale.db, { now: () => NOW }).read(ref),
      ).rejects.toBeInstanceOf(WatchSeoPageNotFoundError)
    })

    it("looks the page up by slug and language with deleted rows excluded", async () => {
      const { raw } = await read()
      expect(raw.video.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { slug: "jesus", deletedAt: null },
          select: expect.objectContaining({
            locales: expect.objectContaining({
              where: { languageSlug: "english", deletedAt: null },
              take: 1,
            }),
          }),
        }),
      )
    })
  })

  describe("search (retained GSC decisions)", () => {
    it("returns the latest value per query, ranked by impressions, with provenance", async () => {
      const { model } = await read({
        searchRuns: [
          searchRun(new Date(NOW.getTime() - 1 * DAY), [
            decision({ query: "jesus film", impressions: 500, position: 7.1 }),
            decision({ query: "watch jesus", impressions: 900, position: 3 }),
          ]),
          searchRun(new Date(NOW.getTime() - 3 * DAY), [
            decision({ query: "jesus film", impressions: 100, position: 20 }),
            decision({ query: "old query", impressions: 50, position: 40 }),
          ]),
        ],
      })
      const search = model.sections.search
      expect(search.state).toBe("available")
      expect(search.source).toEqual({
        kind: "retained_ledger",
        provider: "gsc",
      })
      expect(search.window).toEqual({
        start: WINDOW_START.toISOString(),
        end: NOW.toISOString(),
      })
      expect(search.data?.runCount).toBe(2)
      expect(search.data?.queries.map((q) => q.query)).toEqual([
        "watch jesus",
        "jesus film",
        "old query",
      ])
      // Newest run wins for a repeated query.
      expect(
        search.data?.queries.find((q) => q.query === "jesus film"),
      ).toMatchObject({ impressions: 500, position: 7.1 })
      expect(search.caveats.join(" ")).toContain("smaller position number")
    })

    it("projects only safe scalars — raw decision fields never reach the wire", async () => {
      const { model } = await read({
        searchRuns: [
          searchRun(new Date(NOW.getTime() - DAY), [
            decision({
              raw: { providerBody: "secret" },
              observationId: "obs-9",
            }),
          ]),
        ],
      })
      const row = model.sections.search.data?.queries[0]
      expect(Object.keys(row ?? {}).sort()).toEqual([
        "clicks",
        "ctr",
        "impressions",
        "observedAt",
        "position",
        "query",
      ])
      expect(JSON.stringify(model)).not.toContain("providerBody")
      expect(JSON.stringify(model)).not.toContain("obs-9")
    })

    it("filters by the exact VideoLocale id inside Postgres and bounds runs and the window", async () => {
      const { queryRaw } = await read({ searchRuns: [] })
      const sql = queryRaw.mock.calls
        .map((call) => call[0] as Prisma.Sql)
        .find((candidate) => sqlText(candidate).includes('FROM "seo_run"'))!
      expect(sqlText(sql)).toContain("jsonb_path_query_array")
      expect(sqlText(sql)).toContain("LIMIT")
      expect(sql.values).toContain(LOCALE_ID)
      expect(sql.values).toContain(8)
      // The 29-day boundary is the strict lower bound passed to Postgres.
      const bound = sql.values.find((value) => value instanceof Date) as Date
      expect(bound.toISOString()).toBe(WINDOW_START.toISOString())
      expect(sqlText(sql)).toContain('"completed_at" >')
    })

    it("uses native enum literals and the completed_at order the composite index serves", async () => {
      const { queryRaw } = await read({ searchRuns: [] })
      const text = sqlText(
        queryRaw.mock.calls
          .map((call) => call[0] as Prisma.Sql)
          .find((candidate) => sqlText(candidate).includes('FROM "seo_run"'))!,
      ).replace(/\s+/g, " ")
      // A `status::text` predicate cannot use (status, completed_at).
      expect(text).not.toMatch(/"status"::text IN/)
      expect(text).toContain(
        `r."status" IN ( 'completed'::"SeoRunStatus", 'partial'::"SeoRunStatus" )`,
      )
      expect(text).toContain(`ORDER BY r."completed_at" DESC LIMIT`)
    })

    it("ships a migration index on exactly the predicate/order columns", async () => {
      const { readFileSync } = await import("node:fs")
      const { fileURLToPath } = await import("node:url")
      const root = fileURLToPath(new URL("../../../", import.meta.url))
      const migration = readFileSync(
        `${root}prisma/migrations/0155_watch_seo_subject_binding_and_run_completion_index/migration.sql`,
        "utf8",
      )
      expect(migration).toContain(
        'CREATE INDEX "seo_run_status_completed_at_idx" ON "seo_run"("status", "completed_at");',
      )
      const schema = readFileSync(`${root}prisma/schema.prisma`, "utf8")
      expect(schema).toContain("@@index([status, completedAt])")
    })

    it("treats a run completed exactly 29 days ago as expired but keeps 29 days minus 1ms", async () => {
      const atBoundary = searchRun(WINDOW_START, [
        decision({ query: "boundary" }),
      ])
      const justInside = searchRun(new Date(WINDOW_START.getTime() + 1), [
        decision({ query: "inside" }),
      ])
      const { model } = await read({ searchRuns: [justInside, atBoundary] })
      expect(model.sections.search.data?.queries.map((q) => q.query)).toEqual([
        "inside",
      ])
      expect(model.sections.search.data?.runCount).toBe(1)
    })

    it("reports compacted — not zero — when only runs older than 29 days exist", async () => {
      const { model } = await read({
        searchRuns: [searchRun(WINDOW_START, [decision()])],
        agedRun: { id: "run-old" },
      })
      expect(model.sections.search).toMatchObject({
        state: "compacted",
        reason: "detail_window_elapsed",
        data: null,
      })
    })

    it("reports unavailable when there is no recent run at all", async () => {
      const { model } = await read({ searchRuns: [], agedRun: null })
      expect(model.sections.search).toMatchObject({
        state: "unavailable",
        reason: "no_recent_run",
        data: null,
      })
    })

    it("treats a run with no rows for this page as unknown, never as zero impressions", async () => {
      const { model } = await read({
        searchRuns: [searchRun(new Date(NOW.getTime() - DAY), [])],
      })
      const search = model.sections.search
      expect(search.state).toBe("unavailable")
      expect(search.reason).toBe("no_retained_rows_for_page")
      expect(search.data).toBeNull()
      expect(search.caveats.join(" ")).toContain("unknown, not zero")
    })

    it("labels old evidence stale and partial coverage partial", async () => {
      const stale = await read({
        searchRuns: [
          searchRun(new Date(NOW.getTime() - WATCH_SEO_STALE_AFTER_MS - 1), [
            decision(),
          ]),
        ],
      })
      expect(stale.model.sections.search.state).toBe("stale")

      const partialRun = await read({
        searchRuns: [
          searchRun(new Date(NOW.getTime() - DAY), [decision()], {
            status: "partial",
          }),
        ],
      })
      expect(partialRun.model.sections.search.state).toBe("partial")

      const partialCoverage = await read({
        searchRuns: [
          searchRun(new Date(NOW.getTime() - DAY), [decision()], {
            providerCoverage: { gsc: "partial" },
          }),
        ],
      })
      expect(partialCoverage.model.sections.search.state).toBe("partial")
    })

    it("drops malformed rows, counts them, and downgrades to partial", async () => {
      const { model } = await read({
        searchRuns: [
          searchRun(new Date(NOW.getTime() - DAY), [
            decision(),
            { query: "no numbers" },
            decision({ clicks: -1 }),
            decision({ query: "nan", position: Number.NaN }),
          ]),
        ],
      })
      expect(model.sections.search.state).toBe("partial")
      expect(model.sections.search.data?.queries).toHaveLength(1)
      expect(model.sections.search.data?.droppedMalformedRowCount).toBe(3)
    })

    it("caps the query list and reports the omitted count", async () => {
      const decisions = Array.from({ length: 100 }, (_, index) =>
        decision({ query: `q-${index}`, impressions: index }),
      )
      const { model } = await read({
        searchRuns: [searchRun(new Date(NOW.getTime() - DAY), decisions)],
      })
      expect(model.sections.search.data?.queries).toHaveLength(50)
      expect(model.sections.search.data?.omittedQueryCount).toBe(50)
    })
  })

  describe("crawl (stored page-state observation)", () => {
    const crawlRow = (overrides: Record<string, unknown> = {}) => ({
      provider: "firecrawl",
      retrievedAt: new Date(NOW.getTime() - DAY),
      quality: { complete: true, truncated: false, status: "available" },
      title: "Jesus",
      description: "desc",
      statusCode: "200",
      contentType: "text/html",
      cacheState: "hit",
      cachedAt: "2026-10-14T00:00:00.000Z",
      ...overrides,
    })

    it("projects safe page-state fields and labels the cache as the fetcher's own", async () => {
      const { model } = await read({ crawlRows: [crawlRow()] })
      const crawl = model.sections.crawl
      expect(crawl.state).toBe("available")
      expect(crawl.data).toMatchObject({
        kind: "page_state_fetch",
        provider: "firecrawl",
        httpStatus: 200,
        fetcherCacheState: "hit",
        complete: true,
      })
      expect(crawl.caveats.join(" ")).toContain("not a bot visit log")
    })

    it("never selects the stored markdown body and scopes by the exact canonical URL", async () => {
      const { model, queryRaw } = await read({ crawlRows: [crawlRow()] })
      const sql = queryRaw.mock.calls
        .map((call) => call[0] as Prisma.Sql)
        .find((candidate) =>
          sqlText(candidate).includes("seo_evidence_observation"),
        )!
      expect(sqlText(sql)).not.toMatch(/markdown/i)
      expect(sqlText(sql)).toContain("LIMIT")
      expect(sql.values).toContain(model.identity.canonicalUrl)
    })

    it("filters provider by native enum literals so (provider, retrieved_at) applies", async () => {
      const { queryRaw } = await read({ crawlRows: [] })
      const text = sqlText(
        queryRaw.mock.calls
          .map((call) => call[0] as Prisma.Sql)
          .find((candidate) =>
            sqlText(candidate).includes("seo_evidence_observation"),
          )!,
      ).replace(/\s+/g, " ")
      expect(text).not.toMatch(/"provider"::text IN/)
      expect(text).toContain(
        `"provider" IN ( 'firecrawl'::"SeoEvidenceProvider", 'direct_page'::"SeoEvidenceProvider" )`,
      )
    })

    it("is partial when the fetch was truncated, stale when old, unavailable when absent", async () => {
      const partial = await read({
        crawlRows: [crawlRow({ quality: { complete: true, truncated: true } })],
      })
      expect(partial.model.sections.crawl.state).toBe("partial")
      const stale = await read({
        crawlRows: [
          crawlRow({
            retrievedAt: new Date(NOW.getTime() - WATCH_SEO_STALE_AFTER_MS - 1),
          }),
        ],
      })
      expect(stale.model.sections.crawl.state).toBe("stale")
      const none = await read({ crawlRows: [] })
      expect(none.model.sections.crawl).toMatchObject({
        state: "unavailable",
        reason: "no_recent_observation",
        data: null,
      })
    })

    it("rejects an observation older than the 29-day boundary", async () => {
      const { model } = await read({
        crawlRows: [crawlRow({ retrievedAt: WINDOW_START })],
      })
      expect(model.sections.crawl.state).toBe("unavailable")
    })

    it("nulls an out-of-range status code instead of coercing it", async () => {
      const { model } = await read({
        crawlRows: [crawlRow({ statusCode: "0" })],
      })
      expect(model.sections.crawl.data?.httpStatus).toBeNull()
    })
  })

  describe("unsupported families are explicit, never fabricated or zero", () => {
    it("marks bot visits, cache history, watch depth, AI referrals and GA4 outcomes not_connected with no data", async () => {
      const { model } = await read()
      for (const key of [
        "ga4PageAndCta",
        "watchDepth",
        "aiReferrals",
        "botVisits",
        "cacheHistory",
      ] as const) {
        const entry = model.sections[key]
        expect(entry.state).toBe("not_connected")
        expect(entry.data).toBeNull()
        expect(entry.reason).toMatch(/^no_/)
        expect(entry.source.kind).toBe("not_connected")
        expect(entry.caveats.length).toBeGreaterThan(0)
      }
    })

    it("exposes every declared section key", async () => {
      const { model } = await read()
      expect(Object.keys(model.sections).sort()).toEqual(
        [...WATCH_SEO_SECTION_KEYS].sort(),
      )
    })
  })

  describe("hreflang manifest", () => {
    it("is unavailable without a snapshot", async () => {
      const { model } = await read({ manifestRows: [] })
      expect(model.sections.hreflang).toMatchObject({
        state: "unavailable",
        reason: "no_manifest_snapshot",
      })
    })

    it("returns bounded alternates, and flags a page absent from the manifest", async () => {
      const present = await read({
        manifestRows: [
          {
            version: "v1",
            generatedAt: new Date(NOW.getTime() - 3_600_000),
            videoGroup: {
              contentSlug: "jesus",
              alternates: [
                { hreflang: "en", languageSlug: "english" },
                { hreflang: "es", languageSlug: "spanish" },
                { nope: true },
              ],
            },
            episodeGroup: null,
          },
        ],
      })
      expect(present.model.sections.hreflang.state).toBe("available")
      expect(present.model.sections.hreflang.data).toMatchObject({
        inManifest: true,
        manifestVersion: "v1",
        alternates: [
          { hreflang: "en", languageSlug: "english" },
          { hreflang: "es", languageSlug: "spanish" },
        ],
      })
      const absent = await read({
        manifestRows: [
          {
            version: "v1",
            generatedAt: new Date(NOW.getTime() - 3_600_000),
            videoGroup: null,
            episodeGroup: null,
          },
        ],
      })
      expect(absent.model.sections.hreflang.data).toMatchObject({
        inManifest: false,
        alternates: [],
      })
    })

    it("is stale when the snapshot is older than 48 hours", async () => {
      const { model } = await read({
        manifestRows: [
          {
            version: "v1",
            generatedAt: new Date(NOW.getTime() - 3 * DAY),
            videoGroup: { contentSlug: "jesus", alternates: [] },
            episodeGroup: null,
          },
        ],
      })
      expect(model.sections.hreflang.state).toBe("stale")
    })

    it("uses the episode group when a contextual parent is present", async () => {
      const { model } = await read(
        {
          manifestRows: [
            {
              version: "v1",
              generatedAt: new Date(NOW.getTime() - 3_600_000),
              videoGroup: {
                contentSlug: "jesus",
                alternates: [{ hreflang: "en", languageSlug: "english" }],
              },
              episodeGroup: {
                parentSlug: "series-a",
                childSlug: "jesus",
                alternates: [{ hreflang: "fr", languageSlug: "french" }],
              },
            },
          ],
        },
        { ...ref, contextualParentSlug: "series-a" },
      )
      expect(model.sections.hreflang.data?.alternates).toEqual([
        { hreflang: "fr", languageSlug: "french" },
      ])
    })
  })

  describe("provider coverage", () => {
    it("reports the latest in-window run's declared coverage and normalises unknown values", async () => {
      const { model, raw } = await read({
        coverageRun: {
          completedAt: new Date(NOW.getTime() - DAY),
          status: "PARTIAL",
          providerCoverage: {
            gsc: "available",
            ga4: "weird",
            firecrawl: "partial",
          },
        },
      })
      expect(model.sections.providerCoverage.state).toBe("partial")
      expect(model.sections.providerCoverage.data?.providers).toEqual({
        gsc: "available",
        ga4: "unavailable",
        firecrawl: "partial",
      })
      const call = raw.seoRun.findFirst.mock.calls.find(
        ([args]) => !args.select.id,
      )![0] as unknown as { where: { completedAt: { gt: Date } } }
      expect(call.where.completedAt.gt.toISOString()).toBe(
        WINDOW_START.toISOString(),
      )
    })

    it("is unavailable with no recent run", async () => {
      const { model } = await read({ coverageRun: null })
      expect(model.sections.providerCoverage).toMatchObject({
        state: "unavailable",
        reason: "no_recent_run",
        data: null,
      })
    })
  })

  describe("route alerts", () => {
    const alert = {
      lifecycle: "OPEN",
      verdict: "supported_route_failure",
      severity: "HIGH",
      latestCount: 14,
      countKind: "page_views",
      activeUsers: 9,
      firstSeenAt: new Date("2026-10-10T00:00:00.000Z"),
      lastSeenAt: new Date("2026-10-15T00:00:00.000Z"),
      lastProbedAt: null,
      lastHttpStatus: 404,
      lastProbeKind: "missing",
      recoveredAt: null,
    }

    it("queries the indexed canonical path with a hard limit", async () => {
      const { raw } = await read({
        alerts: [alert],
        progress: { lastCompleteWindowEnd: new Date(NOW.getTime() - DAY) },
      })
      const args = raw.watchRouteAlert.findMany.mock.calls[0]![0] as {
        where: { normalizedPath: string }
        take: number
      }
      expect(args.where.normalizedPath.startsWith("/watch/")).toBe(true)
      expect(args.take).toBe(5)
    })

    it("returns alerts when the monitor is fresh and stale when it has not run recently", async () => {
      const fresh = await read({
        alerts: [alert],
        progress: { lastCompleteWindowEnd: new Date(NOW.getTime() - DAY) },
      })
      expect(fresh.model.sections.routeAlerts.state).toBe("available")
      expect(fresh.model.sections.routeAlerts.data?.alerts[0]).toMatchObject({
        latestCount: 14,
        lastHttpStatus: 404,
      })
      const stale = await read({
        alerts: [alert],
        progress: { lastCompleteWindowEnd: new Date(NOW.getTime() - 10 * DAY) },
      })
      expect(stale.model.sections.routeAlerts.state).toBe("stale")
    })

    it("does not read 'no alerts' as healthy when the monitor has never run", async () => {
      const { model } = await read({ alerts: [], progress: null })
      expect(model.sections.routeAlerts).toMatchObject({
        state: "unavailable",
        reason: "monitor_not_run",
        data: null,
      })
    })

    it("reports a measured empty list when the monitor ran and found nothing", async () => {
      const { model } = await read({
        alerts: [],
        progress: { lastCompleteWindowEnd: new Date(NOW.getTime() - DAY) },
      })
      expect(model.sections.routeAlerts.state).toBe("available")
      expect(model.sections.routeAlerts.data?.alerts).toEqual([])
    })
  })

  describe("proposals and experiments", () => {
    function proposalRow(overrides: Record<string, unknown> = {}) {
      return {
        id: "prop-1",
        lane: "EDITORIAL",
        status: "PROPOSED",
        expiresAt: new Date(NOW.getTime() + 5 * DAY),
        createdAt: new Date(NOW.getTime() - 2 * DAY),
        versions: [
          {
            version: 3,
            payloadDigest: "a".repeat(64),
            intent: "Improve the search title",
            expectedOutcome: "CTR up",
            risk: "low",
            verificationPlan: "Watch GSC",
            rollbackPlan: "Revert title",
            affectedFields: ["searchTitle"],
            caveats: ["thin evidence"],
            editorialDiff: {
              searchTitle: { before: "Old", after: "New" },
              flag: true,
              nested: { before: { deep: 1 }, after: "text" },
            },
            decision: null,
            materialization: null,
            ticketOutbox: null,
            experiment: null,
          },
        ],
        ...overrides,
      }
    }

    it("projects the immutable version identity, plain-language change and no actor", async () => {
      const { model } = await read({ proposals: [proposalRow()] })
      const section = model.sections.proposals
      expect(section.state).toBe("available")
      const proposal = section.data!.proposals[0]!
      expect(proposal).toMatchObject({
        id: "prop-1",
        version: 3,
        payloadDigest: "a".repeat(64),
        decisionState: "current",
        lane: "EDITORIAL",
        intent: "Improve the search title",
      })
      expect(proposal.changes).toEqual([
        { field: "searchTitle", before: "Old", after: "New" },
        { field: "flag", before: null, after: "true" },
        // Non-scalar values are dropped, never stringified as raw JSON.
        { field: "nested", before: null, after: "text" },
      ])
      expect(JSON.stringify(model)).not.toContain("actorId")
    })

    it("explains why a proposal is not decidable", async () => {
      const rows = [
        proposalRow({
          id: "p-expired",
          expiresAt: new Date(NOW.getTime() - 1),
        }),
        proposalRow({ id: "p-stale", status: "STALE" }),
        proposalRow({ id: "p-approved", status: "APPROVED" }),
        proposalRow({ id: "p-mat", status: "MATERIALIZED" }),
      ]
      const { model } = await read({ proposals: rows })
      expect(
        model.sections.proposals.data!.proposals.map((p) => p.decisionState),
      ).toEqual(["expired", "stale", "decided", "materialized"])
    })

    it("keeps decision, materialization and experiment summaries to safe scalars", async () => {
      const version = proposalRow().versions[0]!
      const row = proposalRow({
        versions: [
          {
            ...version,
            decision: {
              action: "APPROVE",
              actorId: "admin-secret-id",
              reason: "because",
              decidedAt: new Date("2026-10-14T00:00:00.000Z"),
            },
            materialization: {
              status: "DRAFT_CREATED",
              contentRevisionId: "rev-1",
            },
            ticketOutbox: { id: "t-1" },
            experiment: {
              status: "MEASURING",
              activatedAt: new Date("2026-10-14T00:00:00.000Z"),
              measurementStartsAt: null,
              interimDueAt: null,
              finalDueAt: null,
              confounders: ["a", "b"],
              evaluations: [
                {
                  kind: "INTERIM",
                  outcome: "inconclusive",
                  observedAt: new Date("2026-10-15T00:00:00.000Z"),
                  metrics: {
                    ctrDelta: 0.01,
                    label: "x",
                    nested: { a: 1 },
                    nan: null,
                  },
                },
                {
                  kind: "ACTIVATION",
                  outcome: "ok",
                  observedAt: new Date("2026-10-14T00:00:00.000Z"),
                  metrics: {},
                },
              ],
            },
          },
        ],
      })
      const { model } = await read({ proposals: [row] })
      const proposal = model.sections.proposals.data!.proposals[0]!
      expect(proposal.decision).toEqual({
        action: "APPROVE",
        decidedAt: "2026-10-14T00:00:00.000Z",
      })
      expect(proposal.materialization).toEqual({
        status: "DRAFT_CREATED",
        hasDraft: true,
        hasTicket: true,
      })
      expect(proposal.experiment?.confounderCount).toBe(2)
      // Oldest evaluation first; only finite numeric metrics survive.
      expect(proposal.experiment?.evaluations.map((e) => e.kind)).toEqual([
        "ACTIVATION",
        "INTERIM",
      ])
      expect(proposal.experiment?.evaluations[1]?.metrics).toEqual({
        ctrDelta: 0.01,
      })
      const wire = JSON.stringify(model)
      expect(wire).not.toContain("admin-secret-id")
      expect(wire).not.toContain("because")
    })

    it("is a measured empty list when the ledger holds no proposal for the page", async () => {
      const { model, raw } = await read({ proposals: [] })
      expect(model.sections.proposals).toMatchObject({
        state: "available",
        data: { proposals: [] },
      })
      const args = raw.seoProposal.findMany.mock.calls[0]![0] as {
        take: number
        where: { OR: unknown[] }
      }
      expect(args.take).toBe(10)
      expect(args.where.OR).toEqual([
        { targetType: "VideoLocale", targetId: LOCALE_ID },
        { canonicalUrl: model.identity.canonicalUrl },
      ])
    })
  })

  describe("failure isolation", () => {
    it("degrades one failing section to unavailable/read_failed without failing the model", async () => {
      const { model } = await read({
        raw: (sql) => {
          if (sqlText(sql).includes('FROM "seo_run"')) {
            throw new Error("db exploded: SELECT secret")
          }
          return []
        },
      })
      expect(model.sections.search).toMatchObject({
        state: "unavailable",
        reason: "read_failed",
        data: null,
      })
      expect(model.sections.pageMetadata.state).toBe("available")
      const logged = (
        console.warn as unknown as ReturnType<typeof vi.fn>
      ).mock.calls
        .map((call) => String(call[0]))
        .join("\n")
      expect(logged).toContain("event=section_failed section=search")
      expect(logged).not.toContain("secret")
    })
  })

  describe("database-side bounds", () => {
    it("runs every raw read in its own transaction after SET LOCAL statement_timeout", async () => {
      const { txLog, transaction, queryRaw } = await read()
      // hreflang, search, and crawl: one transaction each, nothing raw outside.
      expect(txLog).toHaveLength(3)
      expect(queryRaw).toHaveBeenCalledTimes(3)
      for (const log of txLog) {
        expect(log.map((entry) => entry.kind)).toEqual(["exec", "query"])
        expect(log[0]!.text).toBe("SET LOCAL statement_timeout = '2500ms'")
      }
      expect(txLog.map((log) => log[1]!.text)).toEqual(
        expect.arrayContaining([
          expect.stringContaining("watch_seo_manifest_snapshot"),
          expect.stringContaining('FROM "seo_run"'),
          expect.stringContaining("seo_evidence_observation"),
        ]),
      )
      for (const call of transaction.mock.calls) {
        const options = call[1]!
        // Statement timeout < transaction timeout, and pool wait + statement
        // fits inside the 4s JS section budget.
        expect(options.timeout).toBeGreaterThan(2_500)
        expect(options.maxWait! + options.timeout!).toBeLessThan(4_000)
      }
    })

    it("maps a Postgres statement-timeout cancel to an unavailable section only", async () => {
      const { model } = await read({
        raw: (sql) => {
          if (sqlText(sql).includes('FROM "seo_run"')) {
            throw Object.assign(
              new Error("canceling statement due to statement timeout"),
              { name: "PrismaClientKnownRequestError", code: "P2010" },
            )
          }
          return []
        },
      })
      expect(model.sections.search).toMatchObject({
        state: "unavailable",
        reason: "read_failed",
      })
      expect(model.sections.pageMetadata.state).toBe("available")
      expect(model.sections.crawl.reason).toBe("no_recent_observation")
    })
  })

  describe("page metadata", () => {
    it("reports state from the locale row without exposing asset ids", async () => {
      const { model } = await read()
      expect(model.sections.pageMetadata.data).toMatchObject({
        status: "PUBLISHED",
        title: "Jesus",
        hasSocialImage: true,
      })
      expect(JSON.stringify(model.sections.pageMetadata)).not.toContain(
        "asset-1",
      )
    })
  })
})
