import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const envMock = vi.hoisted(() => ({
  env: {
    SEARCH_TRACE_RAW_RETENTION_DAYS: 29,
    NODE_ENV: "test" as "test" | "development" | "production" | undefined,
  },
}))

vi.mock("@/config/env", () => envMock)
vi.mock("@/db/client", () => ({ prisma: {} }))

import {
  __resetSearchTraceHealthForTest,
  getSearchTraceHealthCounters,
} from "./search-trace-health"
import {
  classifyLatencyBucket,
  recordSearchTraceSafely,
  sampleSearchTraces,
  writeSearchTrace,
  type RecordSearchTraceInput,
} from "./search-trace.service"

function buildPrisma() {
  return {
    searchTrace: {
      create: vi.fn(async (args) => ({ id: "trace-1", ...args.data })),
      findMany: vi.fn(async (): Promise<unknown[]> => []),
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
  query: "Jesus film",
  locale: "en",
  routeSource: "rest",
  requestedMode: "hybrid",
  searchMode: "hybrid",
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
        queryText: "Jesus film",
        locale: "en",
        routeSource: "REST",
        requestedMode: "hybrid",
        searchMode: "hybrid",
        resultCount: 3,
        latencyBucket: "LT_250_MS",
        outcome: "SUCCESS",
        traceClass: "none",
        queryQualityLabel: "normal",
        sensitiveQueryLabel: "none",
        abuseLabel: "none",
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

  it("does not throw or log raw query text when persistence fails", async () => {
    const prisma = buildPrisma()
    prisma.searchTraceAggregate.upsert.mockRejectedValueOnce(
      new Error("database unavailable"),
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

  it("samples only unexpired, eligible rows inside the clamped window", async () => {
    const prisma = buildPrisma()
    prisma.searchTrace.findMany.mockResolvedValueOnce([
      {
        id: "trace-1",
        queryText: "Jesus film",
        locale: "en",
        routeSource: "REST",
        requestedMode: "hybrid",
        searchMode: "hybrid",
        resultCount: 3,
        latencyBucket: "LT_250_MS",
        outcome: "SUCCESS",
        traceClass: "none",
        queryQualityLabel: "normal",
        sensitiveQueryLabel: "none",
        abuseLabel: "none",
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
          searchMode: "hybrid",
          since: new Date("2026-05-01T00:00:00.000Z"),
          until: now,
          limit: 500,
        },
        now,
      ),
    ).resolves.toEqual([
      {
        id: "trace-1",
        queryText: "Jesus film",
        locale: "en",
        routeSource: "rest",
        requestedMode: "hybrid",
        searchMode: "hybrid",
        resultCount: 3,
        latencyBucket: "lt_250ms",
        outcome: "success",
        traceClass: "none",
        queryQualityLabel: "normal",
        sensitiveQueryLabel: "none",
        abuseLabel: "none",
        createdAt: "2026-05-25T12:00:00.000Z",
      },
    ])

    expect(prisma.searchTrace.findMany).toHaveBeenCalledWith({
      where: {
        sampleEligible: true,
        rawExpiresAt: { gt: now },
        createdAt: {
          gte: new Date("2026-05-25T12:00:00.000Z"),
          lte: now,
        },
        locale: "en",
        routeSource: "REST",
        searchMode: "hybrid",
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: expect.any(Object),
    })
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
    expect(rawModel).toContain("sampleEligible")
    expect(rawModel).not.toMatch(
      /bearer|cookie|ipAddress|ip_|userId|keyId|vector|score/i,
    )
    expect(aggregateModel).not.toMatch(/queryText|query_text/i)
  })
})
