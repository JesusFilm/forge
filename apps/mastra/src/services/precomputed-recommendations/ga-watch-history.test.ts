import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createGaWatchHistoryReader,
  inspectGaWatchCoverage,
  readGaWatchReferrerAggregatePage,
  readGaWatchStartAggregatePage,
} from "./ga-watch-history"
import { readHistoricalDefinition } from "./historical-analytics"

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

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
const referrerStarts = [
  [
    "https://www.jesusfilm.org/watch/jesus.html/english.html?campaign=1#part",
    "/watch/jesus.html/the-beginning/english.html",
    "1_jf6101-0-0",
    "12",
  ],
  [
    "https://jesusfilm.org/watch",
    "/watch/jesus.html/english.html",
    "1_jf-0-0",
    "9",
  ],
  [
    "https://jesusfilm.org/watch/jesus.html/english.html",
    "/watch/jesus.html/english.html",
    "1_jf-0-0",
    "7",
  ],
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
          : dimensions[0] === "pageReferrer"
            ? referrerStarts
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
  it("gives detailed Watch snapshot reports a longer bounded timeout than coverage probes", async () => {
    const fake = provider()
    const timeoutMs: number[] = []
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation((ms) => {
        timeoutMs.push(ms)
        return new AbortController().signal
      })
    const input = {
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
    try {
      await inspectGaWatchCoverage(input)
      await readGaWatchStartAggregatePage({ ...input, offset: 0, limit: 1 })
      await readGaWatchReferrerAggregatePage({ ...input, offset: 0, limit: 1 })
      expect(timeoutMs).toEqual([50_000, 50_000, 120_000, 120_000])
    } finally {
      timeout.mockRestore()
    }
  })

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

  it("rejects history when the separately queried usable interval remains truncated", async () => {
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
    expect(fake.requests.length).toBeGreaterThan(2)
    expect(JSON.stringify(fake.requests)).toContain("2022-08-06")
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
      await vi.advanceTimersByTimeAsync(45_000)
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

  it("reads bounded referrer aggregates as navigation candidates and removes URL query data", async () => {
    const fake = provider()
    const page = await readGaWatchReferrerAggregatePage({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-08-06",
      rangeEnd: "2026-10-03",
      offset: 0,
      limit: 3,
      tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
      fetchImpl: fake.fetchImpl,
    })
    expect(page).toMatchObject({
      provider: "ga_data_api",
      rowCount: 3,
      nextOffset: null,
      rows: [
        {
          sourcePath: "/watch/jesus.html/english.html",
          targetPath: "/watch/jesus.html/the-beginning/english.html",
          mediaComponentId: "1_jf6101-0-0",
          starts: 12,
          status: "candidate",
        },
        { starts: 9, status: "homepage" },
        { starts: 7, status: "self" },
      ],
      pageCoverage: { candidateEvents: 12, homepageEvents: 9, selfEvents: 7 },
      outsideReportEvents: "unknown",
      orderedTransitions: "unavailable",
    })
    expect(fake.requests).toHaveLength(1)
    expect(JSON.stringify(fake.requests[0])).toContain("pageReferrer")
    expect(JSON.stringify(fake.requests[0])).toContain("^/watch(/.*)?$")
    expect(fake.requests[0]).toMatchObject({
      dateRanges: [{ startDate: "2022-08-06", endDate: "2026-10-03" }],
      dimensions: [
        { name: "pageReferrer" },
        { name: "pagePath" },
        { name: "customEvent:mediacomponentid" },
      ],
    })
  })

  it("can bound a navigation query to vetted source Watch paths", async () => {
    const fake = provider()
    await readGaWatchReferrerAggregatePage({
      propertyId: "320198532",
      serviceAccountEmail:
        "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
      rangeStart: "2022-08-06",
      rangeEnd: "2026-10-03",
      offset: 0,
      limit: 3,
      sourcePathnames: ["/watch/jesus.html/english.html"],
      targetPathnames: ["/watch/jesus.html/the-beginning/english.html"],
      tokenProvider: async () => ({ ok: true, accessToken: "test-token" }),
      fetchImpl: fake.fetchImpl,
    })
    expect(JSON.stringify(fake.requests[0])).toContain(
      "jesus\\\\.html/english\\\\.html",
    )
    expect(JSON.stringify(fake.requests[0])).not.toContain("campaign=1")
    expect(JSON.stringify(fake.requests[0])).toContain(
      '"values":["/watch/jesus.html/the-beginning/english.html"]',
    )
  })
})

describe("GA report retry admission", () => {
  const input = {
    propertyId: "320198532",
    serviceAccountEmail:
      "watch-ga4-readonly@jesusfilm-org-1738781064783.iam.gserviceaccount.com",
    rangeStart: "2022-08-07",
    rangeEnd: "2026-10-05",
    offset: 0,
    limit: 1,
    tokenProvider: async () => ({
      ok: true as const,
      accessToken: "test-token",
    }),
  }

  it("retries the identical 502 report after 30 and 60 seconds and accepts only a complete response", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"))
    const attempts: { at: number; body: string }[] = []
    const fetchImpl = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        attempts.push({ at: Date.now(), body: String(init?.body) })
        return attempts.length < 3
          ? new Response("upstream gateway", { status: 502 })
          : new Response(
              JSON.stringify(
                report(
                  ["pagePath", "customEvent:mediacomponentid"],
                  starts,
                  0,
                  1,
                ),
              ),
              { status: 200 },
            )
      },
    ) as typeof fetch

    const pending = readGaWatchStartAggregatePage({ ...input, fetchImpl })
    const assertion = expect(pending).resolves.toMatchObject({
      status: "unqualified",
      rowCount: 2,
      requestCount: 3,
      rows: [{ starts: 4 }],
    })
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
    expect(attempts.map(({ at }) => at)).toEqual([
      Date.parse("2026-10-07T00:00:00.000Z"),
      Date.parse("2026-10-07T00:00:30.000Z"),
      Date.parse("2026-10-07T00:01:30.000Z"),
    ])
    expect(new Set(attempts.map(({ body }) => body)).size).toBe(1)
  })

  it("stops after a third 502 without treating the report as complete", async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(
      async () => new Response("bad gateway", { status: 502 }),
    ) as typeof fetch
    const pending = readGaWatchStartAggregatePage({ ...input, fetchImpl })
    const assertion = expect(pending).rejects.toMatchObject({
      code: "analytics_unavailable",
    })
    await vi.advanceTimersByTimeAsync(90_000)
    await assertion
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it.each([500, 504])(
    "retries HTTP %i once after the first cooldown",
    async (status) => {
      vi.useFakeTimers()
      let calls = 0
      const fetchImpl = vi.fn(async () => {
        calls += 1
        return calls === 1
          ? new Response("server error", { status })
          : new Response(
              JSON.stringify(
                report(
                  ["pagePath", "customEvent:mediacomponentid"],
                  starts,
                  0,
                  1,
                ),
              ),
              { status: 200 },
            )
      }) as typeof fetch
      const pending = readGaWatchStartAggregatePage({ ...input, fetchImpl })
      const assertion = expect(pending).resolves.toMatchObject({
        requestCount: 2,
      })
      await vi.advanceTimersByTimeAsync(30_000)
      await assertion
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    },
  )

  it.each([
    ["seconds", "45"],
    ["HTTP date", "Wed, 07 Oct 2026 00:00:45 GMT"],
  ])(
    "honors valid Retry-After %s without shortening the scheduled delay",
    async (_kind, retryAfter) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"))
      const times: number[] = []
      const fetchImpl = vi.fn(async (_url: URL | RequestInfo) => {
        times.push(Date.now())
        return times.length === 1
          ? new Response("unavailable", {
              status: 503,
              headers: { "retry-after": retryAfter },
            })
          : new Response(
              JSON.stringify(
                report(
                  ["pagePath", "customEvent:mediacomponentid"],
                  starts,
                  0,
                  1,
                ),
              ),
              { status: 200 },
            )
      }) as typeof fetch
      const pending = readGaWatchStartAggregatePage({ ...input, fetchImpl })
      await vi.advanceTimersByTimeAsync(45_000)
      await expect(pending).resolves.toMatchObject({ requestCount: 2 })
      expect(times).toEqual([
        Date.parse("2026-10-07T00:00:00.000Z"),
        Date.parse("2026-10-07T00:00:45.000Z"),
      ])
    },
  )

  it.each([
    ["invalid", "soon"],
    ["over-cap", "61"],
    ["over-cap date", "Wed, 07 Oct 2026 00:01:01 GMT"],
  ])("stops on a %s Retry-After value", async (_case, retryAfter) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"))
    const fetchImpl = vi.fn(
      async () =>
        new Response("unavailable", {
          status: 502,
          headers: { "retry-after": retryAfter },
        }),
    ) as typeof fetch
    await expect(
      readGaWatchStartAggregatePage({ ...input, fetchImpl }),
    ).rejects.toMatchObject({ code: "analytics_unavailable" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it.each([429, 401, 403, 404, 501])(
    "does not retry HTTP %i",
    async (status) => {
      const fetchImpl = vi.fn(
        async () => new Response("error", { status }),
      ) as typeof fetch
      await expect(
        readGaWatchStartAggregatePage({ ...input, fetchImpl }),
      ).rejects.toMatchObject({ code: "analytics_unavailable" })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    },
  )

  it("does not retry a malformed successful report or a thrown admission error", async () => {
    const malformed = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as typeof fetch
    await expect(
      readGaWatchStartAggregatePage({ ...input, fetchImpl: malformed }),
    ).rejects.toMatchObject({ code: "analytics_incomplete" })
    expect(malformed).toHaveBeenCalledTimes(1)

    const pause = new Error("operator_pause_at_call_boundary")
    const blocked = vi.fn(async () => {
      throw pause
    }) as typeof fetch
    await expect(
      readGaWatchStartAggregatePage({ ...input, fetchImpl: blocked }),
    ).rejects.toBe(pause)
    expect(blocked).toHaveBeenCalledTimes(1)
  })

  it("does not retry a physical fetch exception without a safe wrapper classification", async () => {
    const disconnect = new TypeError("network disconnected")
    const fetchImpl = vi.fn(async () => {
      throw disconnect
    }) as typeof fetch
    await expect(
      readGaWatchStartAggregatePage({ ...input, fetchImpl }),
    ).rejects.toBe(disconnect)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
