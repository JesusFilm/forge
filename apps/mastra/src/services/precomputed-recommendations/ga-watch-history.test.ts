import { describe, expect, it, vi } from "vitest"

import {
  createGaWatchHistoryReader,
  inspectGaWatchCoverage,
  readGaWatchStartAggregatePage,
} from "./ga-watch-history"
import { readHistoricalDefinition } from "./historical-analytics"

const monthly = [
  ["202209", "videostarts", "7"],
  ["202210", "videostarts", "5"],
  ["202210", "page_view", "20"],
] as const
const identified = [["2022", "8"]] as const
const starts = [
  ["/watch/film-one", "media-1", "4"],
  ["/watch/film-two", "(not set)", "3"],
] as const

function report(
  dimensions: readonly string[],
  values: readonly (readonly string[])[],
  offset: number,
  limit: number,
  truncated = false,
) {
  return {
    dimensionHeaders: dimensions.map((name) => ({ name })),
    metricHeaders: [{ name: "eventCount", type: "TYPE_INTEGER" }],
    rowCount: values.length,
    rows: values.slice(offset, offset + limit).map((row) => ({
      dimensionValues: row.slice(0, -1).map((value) => ({ value })),
      metricValues: [{ value: row.at(-1) }],
    })),
    metadata: {
      timeZone: "America/New_York",
      ...(truncated
        ? {
            dataTruncationReasons: [
              {
                dataTruncationType: "DATA_TRUNCATION_TYPE_PROPERTY",
                dataTruncationDate: "2022-08-05",
                dataTruncationMessage: "Data is complete only after 2022-08-05",
                dataTruncationDateRanges: [
                  { startDate: "2022-06-21", endDate: "2022-08-04" },
                ],
              },
            ],
          }
        : {}),
    },
  }
}

function provider(
  options: { truncated?: boolean; shortPage?: boolean; timeZone?: string } = {},
) {
  const requests: unknown[] = []
  const fetchImpl = vi.fn(
    async (_url: URL | RequestInfo, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        dimensions: { name: string }[]
        dimensionFilter: unknown
        offset: string
        limit: string
        dateRanges: { startDate: string; endDate: string }[]
      }
      requests.push(body)
      const dimensions = body.dimensions.map(({ name }) => name)
      const isMonthly = dimensions[0] === "yearMonth"
      const values = isMonthly
        ? monthly
        : dimensions[0] === "year"
          ? identified
          : starts
      const offset = Number(body.offset)
      const limit = Number(body.limit)
      const response = report(
        dimensions,
        values,
        offset,
        options.shortPage && isMonthly && offset === 0 ? 1 : limit,
        options.truncated && !isMonthly,
      )
      if (options.timeZone) response.metadata.timeZone = options.timeZone
      return new Response(JSON.stringify(response), { status: 200 })
    },
  )
  return { fetchImpl: fetchImpl as typeof fetch, requests }
}

describe("GA Watch history coverage preflight", () => {
  it("paginates scoped reports and exposes aggregate gaps without claiming transitions or mappings", async () => {
    const fake = provider()
    const result = await inspectGaWatchCoverage({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-06-21",
      rangeEnd: "2022-10-31",
      pageSize: 2,
      tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
      fetchImpl: fake.fetchImpl,
    })

    expect(result).toMatchObject({
      status: "blocked",
      reason: "missing_session_identity",
      rangeStart: "2022-06-21",
      rangeEnd: "2022-10-31",
      watchScope: {
        hosts: ["jesusfilm.org", "www.jesusfilm.org"],
        pathRegex: "^/watch(/.*)?$",
      },
      totals: { videostarts: 12, page_view: 20 },
      mediaComponentIdCoverage: {
        sourceDimension: "customEvent:mediacomponentid",
        inScopeEvents: 12,
        withMediaComponentIdEvents: 8,
        canonicalVideoMappedEvents: null,
      },
      pagination: { complete: true, monthlyRows: 3, identifiedRows: 1 },
    })
    expect(fake.requests).toHaveLength(3)
    expect(fake.requests[1]).toMatchObject({ offset: "2", limit: "2" })
    for (const request of fake.requests) {
      expect(request).toMatchObject({
        dateRanges: [{ startDate: "2022-06-21", endDate: "2022-10-31" }],
      })
      expect(JSON.stringify(request)).toContain("^/watch(/.*)?$")
      expect(JSON.stringify(request)).toContain("jesusfilm.org")
    }
  })

  it("treats GA source truncation as incomplete despite complete row pagination", async () => {
    const fake = provider({ truncated: true })
    const result = await inspectGaWatchCoverage({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-06-21",
      rangeEnd: "2022-10-31",
      tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
      fetchImpl: fake.fetchImpl,
    })
    expect(result).toMatchObject({
      status: "incomplete",
      reason: "source_truncation",
      sourceAvailableAfter: "2022-08-05",
      truncatedDateRanges: [{ startDate: "2022-06-21", endDate: "2022-08-04" }],
      pagination: { complete: true },
    })
  })

  it("rejects a short page instead of presenting it as complete coverage", async () => {
    const fake = provider({ shortPage: true })
    await expect(
      inspectGaWatchCoverage({
        propertyId: "320198532",
        serviceAccountEmail:
          "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
        rangeStart: "2022-06-21",
        rangeEnd: "2022-10-31",
        pageSize: 2,
        tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
        fetchImpl: fake.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "analytics_incomplete" })
  })

  it("reads one bounded content aggregate page without guessing canonical Video IDs", async () => {
    const fake = provider()
    const reader = createGaWatchHistoryReader({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-06-21",
      rangeEnd: "2022-10-31",
      tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
      fetchImpl: fake.fetchImpl,
    })
    const page = await reader.readWatchStartsPage({ offset: 0, limit: 1 })
    expect(page).toMatchObject({
      provider: "ga_data_api",
      status: "unqualified",
      rows: [
        { pagePath: "/watch/film-one", mediaComponentId: "media-1", starts: 4 },
      ],
      rowCount: 2,
      nextOffset: 1,
      canonicalMapping: "unverified",
      orderedTransitions: "unavailable",
    })
    expect(fake.requests).toHaveLength(1)
    expect(fake.requests[0]).toMatchObject({
      dimensions: [
        { name: "pagePath" },
        { name: "customEvent:mediacomponentid" },
      ],
      limit: "1",
      offset: "0",
    })
  })

  it("accepts GA's actual empty-report wire shape as zero without inventing rows", async () => {
    const fetchImpl = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          dimensions: { name: string }[]
        }
        return new Response(
          JSON.stringify({
            dimensionHeaders: body.dimensions,
            metricHeaders: [{ name: "eventCount", type: "TYPE_INTEGER" }],
            metadata: { currencyCode: "USD", timeZone: "America/New_York" },
          }),
          { status: 200 },
        )
      },
    )
    const result = await inspectGaWatchCoverage({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-06-21",
      rangeEnd: "2022-06-21",
      tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(result).toMatchObject({
      totals: { videostarts: 0, page_view: 0 },
      mediaComponentIdCoverage: {
        inScopeEvents: 0,
        withMediaComponentIdEvents: 0,
      },
      pagination: { monthlyRows: 0, identifiedRows: 0, requestCount: 2 },
    })
    await expect(
      readGaWatchStartAggregatePage({
        propertyId: "320198532",
        serviceAccountEmail:
          "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
        rangeStart: "2022-06-21",
        rangeEnd: "2022-06-21",
        offset: 1,
        limit: 1,
        tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "analytics_incomplete" })
  })

  it("rejects source dimensions outside the approved requested dates", async () => {
    const fake = provider()
    await expect(
      inspectGaWatchCoverage({
        propertyId: "320198532",
        serviceAccountEmail:
          "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
        rangeStart: "2023-01-01",
        rangeEnd: "2023-12-31",
        tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
        fetchImpl: fake.fetchImpl,
      }),
    ).rejects.toMatchObject({ code: "analytics_incomplete" })
  })

  it("prevents history-backed generation after a real GA coverage preflight", async () => {
    const fake = provider({ truncated: true })
    const reader = createGaWatchHistoryReader({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-06-21",
      rangeEnd: "2022-10-31",
      tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
      fetchImpl: fake.fetchImpl,
    })
    await expect(
      readHistoricalDefinition(reader, "2022-11-01T00:00:00.000Z"),
    ).rejects.toMatchObject({ code: "analytics_incomplete" })
    expect(fake.requests).toHaveLength(2)
  })

  it("labels source limits on a content aggregate page", async () => {
    const fake = provider({ truncated: true })
    const page = await readGaWatchStartAggregatePage({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-06-21",
      rangeEnd: "2022-10-31",
      offset: 0,
      limit: 1,
      tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
      fetchImpl: fake.fetchImpl,
    })
    expect(page).toMatchObject({
      status: "incomplete",
      reportLimitations: ["source_truncation"],
      sourceAvailableAfter: "2022-08-05",
      truncatedDateRanges: [{ startDate: "2022-06-21", endDate: "2022-08-04" }],
      nextOffset: 1,
    })
  })

  it("bounds token acquisition before making any report request", async () => {
    vi.useFakeTimers()
    try {
      const fetchImpl = vi.fn()
      const pending = inspectGaWatchCoverage({
        propertyId: "320198532",
        serviceAccountEmail:
          "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
        rangeStart: "2022-06-21",
        rangeEnd: "2022-10-31",
        tokenProvider: async () => new Promise<never>(() => undefined),
        fetchImpl: fetchImpl as typeof fetch,
      })
      const assertion = expect(pending).rejects.toMatchObject({
        code: "analytics_unavailable",
      })
      await vi.advanceTimersByTimeAsync(15_000)
      await assertion
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("fails closed if the verified property's reported timezone changes", async () => {
    const fake = provider({ timeZone: "UTC" })
    const source = {
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-06-21",
      rangeEnd: "2022-10-31",
      tokenProvider: async () => ({
        ok: true as const,
        accessToken: "test-token",
      }),
      fetchImpl: fake.fetchImpl,
    }
    await expect(inspectGaWatchCoverage(source)).rejects.toMatchObject({
      code: "analytics_incomplete",
    })
    await expect(
      readGaWatchStartAggregatePage({ ...source, offset: 0, limit: 1 }),
    ).rejects.toMatchObject({ code: "analytics_incomplete" })
  })
})
