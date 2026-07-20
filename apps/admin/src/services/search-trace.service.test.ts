import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const envMock = vi.hoisted(() => ({
  env: {
    SEARCH_TRACE_RAW_RETENTION_DAYS: 29,
    NODE_ENV: "test" as "test" | "development" | "production" | undefined,
  },
}))

vi.mock("@/config/env", () => envMock)
vi.mock("@/db/client", () => ({ prisma: {} }))
vi.mock("@/services/search-trace-retention.service", () => ({
  purgeExpiredSearchTraces: vi.fn(async () => ({
    purgedCount: 0,
    purgedRawTraceCount: 0,
    purgedGeneratedCandidateCount: 0,
    purgedWatchSearchEventCount: 0,
    purgedQueryEmbeddingCacheCount: 0,
    purgedBefore: "2026-05-01T00:00:00.180Z",
  })),
  readSearchTraceRetentionHealth: vi.fn(async () => ({
    healthy: true,
    reason: "recent-purge",
    latestPurgeAt: "2026-05-01T00:00:00.000Z",
    activeSchedulerRunId: null,
  })),
}))

import {
  __resetSearchTraceHealthForTest,
  getSearchTraceHealthCounters,
} from "./search-trace-health"
import {
  purgeExpiredSearchTraces,
  readSearchTraceRetentionHealth,
} from "@/services/search-trace-retention.service"
import {
  classifyLatencyBucket,
  recordSearchTraceSafely,
  recordWatchSearchTraceSafely,
  sampleSearchTraces,
  writeSearchTrace,
  type RecordSearchTraceInput,
} from "./search-trace.service"

function buildPrisma() {
  return {
    searchTrace: {
      create: vi.fn(async (args) => ({ id: "trace-1", ...args.data })),
      findMany: vi.fn(async (_args?: unknown): Promise<unknown[]> => []),
    },
    searchTraceAggregate: {
      upsert: vi.fn(async (args) => ({ id: "aggregate-1", ...args.create })),
    },
    workflowRun: {
      findFirst: vi.fn(),
    },
  }
}

const baseTraceInput: RecordSearchTraceInput = {
  query: "Jesus film for kids",
  locale: "en",
  routeSource: "rest",
  requestedMode: "hybrid",
  searchMode: "watch-search",
  resultCount: 3,
  outcome: "success",
  traceClass: "none",
  startedAt: new Date("2026-05-01T00:00:00.000Z"),
  completedAt: new Date("2026-05-01T00:00:00.180Z"),
  now: new Date("2026-05-01T00:00:00.180Z"),
}

describe("search trace service", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    __resetSearchTraceHealthForTest()
    envMock.env.SEARCH_TRACE_RAW_RETENTION_DAYS = 29
    envMock.env.NODE_ENV = "test"
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("classifies latency into stable buckets", () => {
    expect(classifyLatencyBucket(99)).toBe("lt_100ms")
    expect(classifyLatencyBucket(100)).toBe("lt_250ms")
    expect(classifyLatencyBucket(249)).toBe("lt_250ms")
    expect(classifyLatencyBucket(2500)).toBe("gte_2500ms")
  })

  it("stores a raw trace with 29-day expiry and a query-free aggregate", async () => {
    const prisma = buildPrisma()

    await expect(
      writeSearchTrace(
        baseTraceInput,
        prisma as unknown as Parameters<typeof writeSearchTrace>[1],
      ),
    ).resolves.toEqual({
      aggregateStored: true,
      rawStored: true,
      rawCaptureDisabled: false,
    })

    expect(prisma.searchTrace.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        queryText: "Jesus film for kids",
        locale: "en",
        routeSource: "REST",
        requestedMode: "hybrid",
        searchMode: "watch-search",
        resultCount: 3,
        latencyBucket: "LT_250_MS",
        outcome: "SUCCESS",
        traceClass: "none",
        queryQualityLabel: "valid_viewer_intent",
        sensitiveQueryLabel: "none",
        abuseLabel: "none",
        queryLabelSource: "rules",
        queryLabelVersion: "search-query-labels/v1",
        queryLabeledAt: new Date("2026-05-01T00:00:00.180Z"),
        sampleEligible: true,
        rawExpiresAt: new Date("2026-05-30T00:00:00.180Z"),
      }),
    })
    const aggregateCreate =
      prisma.searchTraceAggregate.upsert.mock.calls[0]?.[0]?.create
    expect(JSON.stringify(aggregateCreate)).not.toContain("queryText")
    expect(JSON.stringify(aggregateCreate)).not.toContain("Jesus film")
    expect(aggregateCreate).toMatchObject({
      queryCount: 1,
      resultCountSum: 3,
      routeSource: "REST",
      outcome: "SUCCESS",
      queryLabelSource: "rules",
      queryLabelVersion: "search-query-labels/v1",
    })
  })

  it("redacts sensitive query text and excludes it from sampling by default", async () => {
    const prisma = buildPrisma()
    await writeSearchTrace(
      {
        ...baseTraceInput,
        query: "viewer@example.com password=super-secret",
      },
      prisma as unknown as Parameters<typeof writeSearchTrace>[1],
    )

    const rawData = prisma.searchTrace.create.mock.calls[0]?.[0]?.data
    expect(rawData.queryText).toContain("[redacted-email]")
    expect(rawData.queryText).toContain("[redacted-credential]")
    expect(rawData.queryText).not.toContain("viewer@example.com")
    expect(rawData.queryText).not.toContain("super-secret")
    expect(rawData.sampleEligible).toBe(false)
    expect(rawData.sensitiveQueryLabel).toBe("mixed")
  })

  it("records keyword-only degradation in raw and aggregate dimensions", async () => {
    const prisma = buildPrisma()
    await writeSearchTrace(
      {
        ...baseTraceInput,
        searchMode: "keyword-only",
        outcome: "degraded",
        traceClass: "query_embedding_failure",
      },
      prisma as unknown as Parameters<typeof writeSearchTrace>[1],
    )

    expect(prisma.searchTrace.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        searchMode: "keyword-only",
        outcome: "DEGRADED",
        traceClass: "query_embedding_failure",
      }),
    })
    expect(prisma.searchTraceAggregate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          searchMode: "keyword-only",
          outcome: "DEGRADED",
          traceClass: "query_embedding_failure",
        }),
      }),
    )
  })

  it("records Watch search request metadata in Admin raw traces without adding query text to aggregates", async () => {
    const prisma = buildPrisma()

    await recordWatchSearchTraceSafely(
      {
        input: {
          query: "Should I pray to God?",
          targetLanguageSlug: "russian",
          queryNamedLanguageSlug: "russian",
          displayLanguageSlug: "english",
          routeLanguageSlug: "english",
          acceptLanguage: "en-US,en;q=0.9",
          limit: 10,
          offset: 0,
          resultTypes: ["video"],
        },
        response: {
          query: "Should I pray to God?",
          requestId: "watch_req_123456",
          searchMode: "watch-search",
          degraded: true,
          latencyMs: 123.4,
          hasMore: false,
          nextOffset: 10,
          languageInterpretation: {
            queryLanguageSlug: null,
            queryNamedLanguageSlug: "russian",
            targetLanguageSlug: "russian",
            targetLanguageSource: "explicit_target",
            displayLanguageSlug: "english",
            routeLanguageSlug: "english",
            currentWatchLanguageSlug: null,
            acceptLanguage: "en-US,en;q=0.9",
            acceptLanguageSlug: "english",
          },
          laneStatuses: [
            {
              lane: "semantic_retrieval",
              status: "degraded",
              startedOffsetMs: 0,
              elapsedMs: 42,
              resultCount: 1,
              reason: "partial_locale_failure",
              detail: null,
            },
          ],
          results: [
            {
              type: "video",
              id: "video-prayer",
              slug: "prayer",
              title: "Prayer",
              description: "This text must not enter metadata.",
              snippet: "This snippet must not enter metadata.",
              imageUrl: null,
              imageBlurDataUrl: null,
              muxThumbnailBlurDataUrl: null,
              playbackId: "playback-secret-ish",
              startSeconds: 12,
              score: 0.9,
              scoreBreakdown: {
                total: 0.9,
                sourceRelevance: 0.5,
                evidenceBoost: 0.15,
                relevance: 0.65,
                availability: 0.25,
                match: 0.15,
                sourceScore: 0.91,
              },
              label: "FEATURE_FILM",
              durationSeconds: 120,
              childCount: 0,
              languageSlug: "russian",
              languageEnglishName: "Russian",
              availability: {
                kind: "target_audio",
                languageSlug: "russian",
                languageEnglishName: "Russian",
                audio: true,
                subtitles: false,
              },
              evidence: {
                kind: "transcript_semantic",
                languageSlug: "russian",
                label: "Transcript match",
              },
              action: {
                kind: "watch",
                hrefLanguageSlug: "russian",
              },
              fallback: {
                kind: "none",
                message: null,
              },
            },
          ],
        },
        startedAt: new Date("2026-05-01T00:00:00.000Z"),
        completedAt: new Date("2026-05-01T00:00:00.123Z"),
        now: new Date("2026-05-01T00:00:00.123Z"),
      },
      prisma as unknown as Parameters<typeof recordWatchSearchTraceSafely>[1],
    )

    const rawData = prisma.searchTrace.create.mock.calls[0]?.[0]?.data
    expect(rawData).toMatchObject({
      requestId: "watch_req_123456",
      locale: "russian",
      routeSource: "GRAPHQL",
      requestedMode: "watch-search",
      searchMode: "watch-search",
      resultCount: 1,
      outcome: "DEGRADED",
      traceClass: expect.stringContaining("semantic_retrieval_degraded"),
    })
    expect(rawData.metadata).toMatchObject({
      version: "watch-search-analytics/v2",
      requestId: "watch_req_123456",
      queryLength: "Should I pray to God?".length,
      resultCount: 1,
      degraded: true,
      language: {
        targetLanguageSlug: "russian",
        queryNamedLanguageSlug: "russian",
        acceptLanguageSlug: "english",
      },
      laneStatuses: [
        {
          lane: "semantic_retrieval",
          status: "degraded",
          reason: "partial_locale_failure",
          detail: null,
        },
      ],
      results: [
        {
          id: "video-prayer",
          type: "video",
          score: 0.9,
          scoreBreakdown: {
            total: 0.9,
            sourceRelevance: 0.5,
            evidenceBoost: 0.15,
            relevance: 0.65,
            availability: 0.25,
            match: 0.15,
            sourceScore: 0.91,
          },
          availabilityKind: "target_audio",
          evidenceKind: "transcript_semantic",
        },
      ],
    })
    expect(JSON.stringify(rawData.metadata)).not.toContain(
      "This snippet must not enter metadata",
    )
    expect(JSON.stringify(rawData.metadata)).not.toContain("en-US,en;q=0.9")
    expect(JSON.stringify(rawData.metadata)).not.toContain(
      "playback-secret-ish",
    )

    const aggregateCreate =
      prisma.searchTraceAggregate.upsert.mock.calls[0]?.[0]?.create
    expect(JSON.stringify(aggregateCreate)).not.toContain("metadata")
    expect(JSON.stringify(aggregateCreate)).not.toContain(
      "Should I pray to God?",
    )
  })

  it("does not throw or log raw query text when persistence fails", async () => {
    const prisma = buildPrisma()
    prisma.searchTraceAggregate.upsert.mockRejectedValueOnce(
      new Error(
        "Invalid value for argument `queryText`: raw private query is bad",
      ),
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(
      recordSearchTraceSafely(
        { ...baseTraceInput, query: "raw private query" },
        prisma as unknown as Parameters<typeof recordSearchTraceSafely>[1],
      ),
    ).resolves.toEqual({ ok: false, timedOut: false })

    expect(getSearchTraceHealthCounters().writeFailures).toBe(1)
    expect(warn.mock.calls.flat().join(" ")).not.toContain("raw private query")
    expect(warn.mock.calls.flat().join(" ")).toContain(
      "Invalid value for argument `queryText`",
    )
  })

  it("returns after timeout and logs no raw query text", async () => {
    vi.useFakeTimers()
    const prisma = buildPrisma()
    prisma.searchTraceAggregate.upsert.mockReturnValueOnce(
      new Promise(() => {}),
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const promise = recordSearchTraceSafely(
      { ...baseTraceInput, query: "timeout private query", timeoutMs: 10 },
      prisma as unknown as Parameters<typeof recordSearchTraceSafely>[1],
    )
    await vi.advanceTimersByTimeAsync(11)

    await expect(promise).resolves.toEqual({ ok: false, timedOut: true })
    expect(getSearchTraceHealthCounters().writeTimeouts).toBe(1)
    expect(warn.mock.calls.flat().join(" ")).not.toContain(
      "timeout private query",
    )
  })

  it("keeps aggregate counters when raw capture is disabled", async () => {
    const prisma = buildPrisma()
    await writeSearchTrace(
      { ...baseTraceInput, retentionHealthy: false },
      prisma as unknown as Parameters<typeof writeSearchTrace>[1],
    )

    expect(prisma.searchTraceAggregate.upsert).toHaveBeenCalledOnce()
    expect(prisma.searchTrace.create).not.toHaveBeenCalled()
    expect(getSearchTraceHealthCounters().rawCaptureDisabled).toBe(1)
  })

  it("self-heals missing production retention health before storing raw traces", async () => {
    envMock.env.NODE_ENV = "production"
    vi.mocked(readSearchTraceRetentionHealth).mockResolvedValueOnce({
      healthy: false,
      reason: "missing",
      latestPurgeAt: null,
      activeSchedulerRunId: null,
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const prisma = buildPrisma()

    await expect(
      writeSearchTrace(
        baseTraceInput,
        prisma as unknown as Parameters<typeof writeSearchTrace>[1],
      ),
    ).resolves.toEqual({
      aggregateStored: true,
      rawStored: true,
      rawCaptureDisabled: false,
    })

    expect(purgeExpiredSearchTraces).toHaveBeenCalledWith(
      prisma,
      baseTraceInput.now,
    )
    expect(prisma.searchTrace.create).toHaveBeenCalledOnce()
    expect(getSearchTraceHealthCounters().rawCaptureDisabled).toBe(0)
    expect(warn).toHaveBeenCalledWith(
      "[search] event=trace_retention_inline_purge route=rest reason=missing",
    )
  })

  it("samples only unexpired, eligible rows inside the clamped window", async () => {
    const prisma = buildPrisma()
    prisma.searchTrace.findMany.mockResolvedValueOnce([
      {
        id: "trace-1",
        queryText: "Jesus film for kids",
        locale: "en",
        routeSource: "REST",
        requestedMode: "hybrid",
        searchMode: "watch-search",
        resultCount: 3,
        latencyBucket: "LT_250_MS",
        outcome: "SUCCESS",
        traceClass: "none",
        queryQualityLabel: "valid_viewer_intent",
        sensitiveQueryLabel: "none",
        abuseLabel: "none",
        queryLabelSource: "rules",
        queryLabelVersion: "search-query-labels/v1",
        queryLabeledAt: new Date("2026-05-25T12:00:00.000Z"),
        llmQueryQualityLabel: null,
        llmAbuseLabel: null,
        llmLabelSource: null,
        llmLabelVersion: null,
        llmLabelReason: null,
        llmLabeledAt: null,
        rawExpiresAt: new Date("2026-06-23T12:00:00.000Z"),
        createdAt: new Date("2026-05-25T12:00:00.000Z"),
      },
    ])
    const now = new Date("2026-05-26T12:00:00.000Z")

    await expect(
      sampleSearchTraces(
        prisma as unknown as Parameters<typeof sampleSearchTraces>[0],
        {
          locale: "en",
          routeSource: "rest",
          searchMode: "watch-search",
          since: new Date("2026-05-01T00:00:00.000Z"),
          until: now,
          limit: 500,
        },
        now,
      ),
    ).resolves.toEqual([
      {
        id: "trace-1",
        queryText: "Jesus film for kids",
        locale: "en",
        routeSource: "rest",
        requestedMode: "hybrid",
        searchMode: "watch-search",
        resultCount: 3,
        latencyBucket: "lt_250ms",
        outcome: "success",
        traceClass: "none",
        queryQualityLabel: "valid_viewer_intent",
        sensitiveQueryLabel: "none",
        abuseLabel: "none",
        queryLabelSource: "rules",
        queryLabelVersion: "search-query-labels/v1",
        queryLabeledAt: "2026-05-25T12:00:00.000Z",
        llmQueryQualityLabel: null,
        llmAbuseLabel: null,
        llmLabelSource: null,
        llmLabelVersion: null,
        llmLabelReason: null,
        llmLabeledAt: null,
        rawExpiresAt: "2026-06-23T12:00:00.000Z",
        createdAt: "2026-05-25T12:00:00.000Z",
      },
    ])

    expect(prisma.searchTrace.findMany).toHaveBeenCalledWith({
      where: {
        rawExpiresAt: { gt: now },
        createdAt: {
          gte: new Date("2026-05-25T12:00:00.000Z"),
          lte: now,
        },
        queryQualityLabel: { in: ["valid_viewer_intent"] },
        sensitiveQueryLabel: { in: ["none"] },
        abuseLabel: { in: ["none"] },
        sampleEligible: true,
        locale: "en",
        routeSource: "REST",
        searchMode: "watch-search",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: expect.any(Object),
    })
  })

  it("uses explicit label filters to broaden sampling without sampleEligible", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T12:00:00.000Z")

    await sampleSearchTraces(
      prisma as unknown as Parameters<typeof sampleSearchTraces>[0],
      {
        queryQualityLabels: ["catalog_lookup", "unknown_ambiguous"],
        sensitiveQueryLabels: ["none"],
        abuseLabels: ["none"],
        llmClassification: "candidates",
      },
      now,
    )

    expect(prisma.searchTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          queryQualityLabel: {
            in: ["catalog_lookup", "unknown_ambiguous"],
          },
          sensitiveQueryLabel: { in: ["none"] },
          abuseLabel: { in: ["none"] },
          llmLabelSource: null,
          OR: [
            { queryQualityLabel: "unknown_ambiguous" },
            { resultCount: { gte: 20 } },
          ],
        }),
      }),
    )
    const where = prisma.searchTrace.findMany.mock.calls[0]?.[0] as
      | { where?: Record<string, unknown> }
      | undefined
    expect(where?.where).not.toHaveProperty("sampleEligible")
  })

  it("includes ambiguous traces by default when sampling LLM candidates", async () => {
    const prisma = buildPrisma()
    const now = new Date("2026-05-26T12:00:00.000Z")

    await sampleSearchTraces(
      prisma as unknown as Parameters<typeof sampleSearchTraces>[0],
      { llmClassification: "candidates" },
      now,
    )

    expect(prisma.searchTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          queryQualityLabel: {
            in: ["valid_viewer_intent", "unknown_ambiguous"],
          },
          llmLabelSource: null,
          OR: [
            { queryQualityLabel: "unknown_ambiguous" },
            { resultCount: { gte: 20 } },
          ],
        }),
      }),
    )
  })

  it.each([
    ["classified", { not: null }],
    ["unclassified", null],
    ["any", undefined],
  ] as const)(
    "applies llmClassification=%s to the Prisma where clause",
    async (llmClassification, expectedLabelSource) => {
      const prisma = buildPrisma()
      await sampleSearchTraces(
        prisma as unknown as Parameters<typeof sampleSearchTraces>[0],
        { llmClassification },
        new Date("2026-05-26T12:00:00.000Z"),
      )

      const where = prisma.searchTrace.findMany.mock.calls[0]?.[0] as
        | { where?: Record<string, unknown> }
        | undefined
      if (expectedLabelSource === undefined) {
        expect(where?.where).not.toHaveProperty("llmLabelSource")
      } else {
        expect(where?.where).toHaveProperty(
          "llmLabelSource",
          expectedLabelSource,
        )
      }
    },
  )

  it("redacts query text when broadened sampling returns sensitive or abusive rows", async () => {
    const prisma = buildPrisma()
    prisma.searchTrace.findMany.mockResolvedValueOnce([
      {
        id: "trace-sensitive",
        queryText: "viewer@example.com [redacted-token]",
        locale: "en",
        routeSource: "REST",
        requestedMode: "hybrid",
        searchMode: "watch-search",
        resultCount: 0,
        latencyBucket: "LT_250_MS",
        outcome: "SUCCESS",
        traceClass: "none",
        queryQualityLabel: "unknown_ambiguous",
        sensitiveQueryLabel: "email",
        abuseLabel: "none",
        queryLabelSource: "rules",
        queryLabelVersion: "search-query-labels/v1",
        queryLabeledAt: new Date("2026-05-25T12:00:00.000Z"),
        llmQueryQualityLabel: null,
        llmAbuseLabel: null,
        llmLabelSource: null,
        llmLabelVersion: null,
        llmLabelReason: null,
        llmLabeledAt: null,
        rawExpiresAt: new Date("2026-06-23T12:00:00.000Z"),
        createdAt: new Date("2026-05-25T12:00:00.000Z"),
      },
    ])

    await expect(
      sampleSearchTraces(
        prisma as unknown as Parameters<typeof sampleSearchTraces>[0],
        {
          queryQualityLabels: ["unknown_ambiguous"],
          sensitiveQueryLabels: ["email"],
        },
        new Date("2026-05-26T12:00:00.000Z"),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "trace-sensitive",
        queryText: "[redacted-sample-query]",
        rawExpiresAt: "2026-06-23T12:00:00.000Z",
      }),
    ])
  })

  it("schema keeps raw trace privacy fields and aggregate rows query-free", async () => {
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const schemaPath = fileURLToPath(
      new URL("../../prisma/schema.prisma", import.meta.url),
    )
    const schema = await readFile(schemaPath, "utf8")
    const rawModel = schema.match(
      /model SearchTrace \{[\s\S]*?@@map\("search_trace"\)\n\}/,
    )?.[0]
    const aggregateModel = schema.match(
      /model SearchTraceAggregate \{[\s\S]*?@@map\("search_trace_aggregate"\)\n\}/,
    )?.[0]

    expect(rawModel).toContain("queryQualityLabel")
    expect(rawModel).toContain("sensitiveQueryLabel")
    expect(rawModel).toContain("abuseLabel")
    expect(rawModel).toContain("queryLabelSource")
    expect(rawModel).toContain("queryLabelVersion")
    expect(rawModel).toContain("queryLabeledAt")
    expect(rawModel).toContain("llmQueryQualityLabel")
    expect(rawModel).toContain("llmAbuseLabel")
    expect(rawModel).toContain("sampleEligible")
    expect(aggregateModel).toContain("queryLabelSource")
    expect(aggregateModel).toContain("queryLabelVersion")
    expect(rawModel).not.toMatch(
      /bearer|cookie|ipAddress|ip_|userId|keyId|vector|score/i,
    )
    expect(aggregateModel).not.toMatch(/queryText|query_text/i)
  })

  it("migration preserves rolling compatibility and maps label provenance", async () => {
    const { readFile } = await import("node:fs/promises")
    const { fileURLToPath } = await import("node:url")
    const migrationPath = fileURLToPath(
      new URL(
        "../../prisma/migrations/0022_search_trace_query_label_provenance/migration.sql",
        import.meta.url,
      ),
    )
    const migration = await readFile(migrationPath, "utf8")

    expect(migration).toContain('ADD COLUMN "query_label_source"')
    expect(migration).toContain('ADD COLUMN "query_label_version"')
    expect(migration).toContain('ADD COLUMN "query_labeled_at"')
    expect(migration).toContain("WHEN 'normal' THEN 'valid_viewer_intent'")
    expect(migration).toContain("WHEN 'long' THEN 'unknown_ambiguous'")
    expect(migration).toContain(
      "WHEN 'injection_probe' THEN 'prompt_injection_like'",
    )
    expect(migration).not.toContain(
      'DROP INDEX "search_trace_aggregate_bucket_dims_key"',
    )
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "search_trace_aggregate_bucket_label_dims_key"',
    )
    expect(migration).toContain(
      '"query_label_source",\n    "query_label_version"',
    )
    expect(migration).not.toMatch(
      /bearer|cookie|ipAddress|userId|keyId|vector|score/i,
    )
  })
})
