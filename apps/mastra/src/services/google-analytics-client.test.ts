import { describe, expect, it, vi } from "vitest"
import { WATCH_NOT_FOUND_METADATA_TITLES } from "@forge/watch-url-policy/not-found-titles"

import { getSeoConfig } from "../config/seo"
import {
  queryGoogleAnalytics,
  queryWatchMeasurementReconciliation,
  queryWatchRouteNotFoundLane,
  reconcileWatchMeasurementRows,
  type Ga4Row,
} from "./google-analytics-client"

const config = getSeoConfig({
  SEO_GA4_PROPERTY_IDS: "1234",
  SEO_MAX_PROVIDER_ATTEMPTS: "1",
})

describe("queryWatchRouteNotFoundLane", () => {
  it("requests the exact page_not_found event under /watch/", async () => {
    let request: Record<string, unknown> = {}
    const result = await queryWatchRouteNotFoundLane({
      propertyId: "1234",
      lane: "explicit_event",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      config,
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl: vi.fn(async (_url, init) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json({ rows: [], rowCount: 0 })
      }) as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    expect(request).toMatchObject({
      dimensions: [{ name: "date" }, { name: "pagePathPlusQueryString" }],
      metrics: [{ name: "eventCount" }, { name: "activeUsers" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "pagePathPlusQueryString",
                stringFilter: {
                  matchType: "BEGINS_WITH",
                  value: "/watch/",
                  caseSensitive: true,
                },
              },
            },
            {
              filter: {
                fieldName: "eventName",
                stringFilter: {
                  matchType: "EXACT",
                  value: "page_not_found",
                  caseSensitive: true,
                },
              },
            },
          ],
        },
      },
    })
  })

  it("queries the generated title catalog in bounded chunks and merges rows", async () => {
    const requests: Record<string, unknown>[] = []
    const result = await queryWatchRouteNotFoundLane({
      propertyId: "1234",
      lane: "localized_title",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      config,
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl: vi.fn(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >
        requests.push(request)
        const title = ((
          request.dimensionFilter as {
            andGroup: {
              expressions: Array<{
                filter?: { inListFilter?: { values?: string[] } }
              }>
            }
          }
        ).andGroup.expressions[1]?.filter?.inListFilter?.values ?? [])[0]
        return Response.json({
          rows: [
            {
              dimensionValues: [
                { value: "20260903" },
                { value: `/watch/example-${requests.length}.html` },
                { value: title },
              ],
              metricValues: [{ value: "1" }, { value: "1" }],
            },
          ],
          rowCount: 1,
          metadata: { timeZone: "America/Los_Angeles" },
        })
      }) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      ok: true,
      complete: true,
      propertyTimezone: "America/Los_Angeles",
    })
    if (!result.ok) throw new Error("expected title-lane success")
    expect(result.rows).toHaveLength(requests.length)
    const chunks = requests.map(
      (request) =>
        (
          request.dimensionFilter as {
            andGroup: {
              expressions: Array<{
                filter?: {
                  fieldName?: string
                  inListFilter?: {
                    values?: string[]
                    caseSensitive?: boolean
                  }
                }
              }>
            }
          }
        ).andGroup.expressions[1]?.filter?.inListFilter?.values ?? [],
    )
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 50)).toBe(true)
    expect(chunks.flat()).toEqual(WATCH_NOT_FOUND_METADATA_TITLES)
    expect(chunks.flat()).toContain("Page not found")
  })

  it("keeps successful title chunks but marks the lane partial when one fails", async () => {
    let requestNumber = 0
    const result = await queryWatchRouteNotFoundLane({
      propertyId: "1234",
      lane: "localized_title",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      config,
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl: vi.fn(async () => {
        requestNumber += 1
        if (requestNumber === 2) return new Response(null, { status: 503 })
        return Response.json({ rows: [], rowCount: 0 })
      }) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({ ok: true, complete: false })
    if (!result.ok) throw new Error("expected partial title-lane result")
    expect(result.caveats).toContain("1 GA4 title-filter chunk(s) failed.")
  })

  it("stops pagination at the shared request budget and marks the lane partial", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as {
        limit: string
        offset: string
      }
      const limit = Number(request.limit)
      const offset = Number(request.offset)
      return Response.json({
        rows: Array.from({ length: limit }, (_, index) => ({
          dimensionValues: [
            { value: "20260903" },
            { value: `/watch/example-${offset + index}.html` },
          ],
          metricValues: [{ value: "1" }, { value: "1" }],
        })),
        rowCount: limit + 1,
      })
    }) as unknown as typeof fetch

    const result = await queryWatchRouteNotFoundLane({
      propertyId: "1234",
      lane: "explicit_event",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
      config,
      requestBudget: { remaining: 1 },
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, complete: false })
    if (!result.ok) throw new Error("expected budget-capped lane result")
    expect(result.caveats).toContain(
      "The bounded GA4 request budget was exhausted.",
    )
  })
})

describe("queryGoogleAnalytics", () => {
  it("retains zero metrics, strips query strings, and exposes threshold/timezone metadata", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        dimensionHeaders: [
          { name: "date" },
          { name: "landingPagePlusQueryString" },
        ],
        metricHeaders: [
          { name: "sessions" },
          { name: "engagedSessions" },
          { name: "keyEvents" },
        ],
        rows: [
          {
            dimensionValues: [
              { value: "20260720" },
              { value: "/watch?a=signed" },
            ],
            metricValues: [{ value: "0" }, { value: "0" }, { value: "0" }],
          },
        ],
        rowCount: 1,
        metadata: {
          subjectToThresholding: true,
          timeZone: "America/Los_Angeles",
        },
        propertyQuota: { tokensPerDay: { remaining: 12 } },
      }),
    ) as unknown as typeof fetch
    const result = await queryGoogleAnalytics({
      propertyId: "1234",
      startDate: "2026-07-01",
      endDate: "2026-07-28",
      config,
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl,
      observationId: "ga4-test",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(result.rows).toEqual([
      {
        dimensions: { date: "20260720", landingPagePlusQueryString: "/watch" },
        metrics: { sessions: 0, engagedSessions: 0, keyEvents: 0 },
      },
    ])
    expect(result.propertyTimezone).toBe("America/Los_Angeles")
    expect(result.observation.status).toBe("partial")
    expect(result.observation.data.propertyQuota).toEqual({
      tokensPerDay: { remaining: 12 },
    })
  })

  it("uses an exact landing-page filter when a canonical is supplied", async () => {
    let request: Record<string, unknown> = {}
    const result = await queryGoogleAnalytics({
      propertyId: "1234",
      startDate: "2026-07-01",
      endDate: "2026-07-28",
      landingPage: "https://www.jesusfilm.org/watch/jesus.html?ignored=1",
      config,
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl: vi.fn(async (_url, init) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json({ rows: [] })
      }) as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    expect(request.dimensionFilter).toEqual({
      filter: {
        fieldName: "landingPagePlusQueryString",
        stringFilter: {
          matchType: "EXACT",
          value: "/watch/jesus.html",
          caseSensitive: true,
        },
      },
    })
  })

  it("shrinks oversized pages and preserves offsets and the total cap", async () => {
    const requests: Array<Record<string, unknown>> = []
    let call = 0
    const result = await queryGoogleAnalytics({
      propertyId: "1234",
      startDate: "2026-07-01",
      endDate: "2026-07-28",
      config: getSeoConfig({
        SEO_GA4_PROPERTY_IDS: "1234",
        SEO_MAX_GA4_ROWS: "7",
        SEO_MAX_RESPONSE_BYTES: "16384",
        SEO_MAX_PROVIDER_ATTEMPTS: "1",
      }),
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl: vi.fn(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >
        requests.push(request)
        call += 1
        if (call === 1) {
          return Response.json({
            rows: [
              {
                dimensionValues: [
                  { value: "20260720" },
                  { value: `/${"x".repeat(20_000)}` },
                ],
                metricValues: [{ value: "1" }, { value: "1" }, { value: "1" }],
              },
            ],
          })
        }
        const offset = Number(request.offset)
        const limit = Number(request.limit)
        return Response.json({
          rows: Array.from(
            { length: Math.min(limit, 7 - offset) },
            (_, index) => ({
              dimensionValues: [
                { value: "20260720" },
                { value: `/page-${offset + index}` },
              ],
              metricValues: [{ value: "1" }, { value: "1" }, { value: "1" }],
            }),
          ),
          rowCount: 8,
        })
      }) as unknown as typeof fetch,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected success")
    expect(requests.map(({ limit }) => limit)).toEqual(["7", "3", "3", "1"])
    expect(requests.map(({ offset }) => offset)).toEqual(["0", "0", "3", "6"])
    expect(result.rows).toHaveLength(7)
    expect(result.observation.quality.truncated).toBe(true)
  })

  it("fails closed after an oversized one-row page", async () => {
    const requests: Array<Record<string, unknown>> = []
    let call = 0
    const result = await queryGoogleAnalytics({
      propertyId: "1234",
      startDate: "2026-07-01",
      endDate: "2026-07-28",
      config: getSeoConfig({
        SEO_GA4_PROPERTY_IDS: "1234",
        SEO_MAX_GA4_ROWS: "7",
        SEO_MAX_RESPONSE_BYTES: "16384",
        SEO_MAX_PROVIDER_ATTEMPTS: "1",
      }),
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl: vi.fn(async (_url, init) => {
        const request = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >
        requests.push(request)
        call += 1
        if (call === 1 || call === 4) {
          return Response.json({
            rows: [
              {
                dimensionValues: [
                  { value: "20260720" },
                  { value: `/${"x".repeat(20_000)}` },
                ],
                metricValues: [{ value: "1" }, { value: "1" }, { value: "1" }],
              },
            ],
          })
        }
        const offset = Number(request.offset)
        const limit = Number(request.limit)
        return Response.json({
          rows: Array.from({ length: limit }, (_, index) => ({
            dimensionValues: [
              { value: "20260720" },
              { value: `/page-${offset + index}` },
            ],
            metricValues: [{ value: "1" }, { value: "1" }, { value: "1" }],
          })),
          rowCount: 8,
        })
      }) as unknown as typeof fetch,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
    expect(requests.map(({ limit }) => limit)).toEqual(["7", "3", "3", "1"])
    expect(requests.map(({ offset }) => offset)).toEqual(["0", "0", "3", "6"])
  })

  it("rejects a provider page that exceeds the requested row count", async () => {
    const result = await queryGoogleAnalytics({
      propertyId: "1234",
      startDate: "2026-07-01",
      endDate: "2026-07-28",
      config: getSeoConfig({
        SEO_GA4_PROPERTY_IDS: "1234",
        SEO_MAX_GA4_ROWS: "1",
        SEO_MAX_PROVIDER_ATTEMPTS: "1",
      }),
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl: vi.fn(async () =>
        Response.json({
          rows: [
            {
              dimensionValues: [{ value: "20260720" }, { value: "/one" }],
              metricValues: [{ value: "1" }, { value: "1" }, { value: "1" }],
            },
            {
              dimensionValues: [{ value: "20260720" }, { value: "/two" }],
              metricValues: [{ value: "1" }, { value: "1" }, { value: "1" }],
            },
          ],
          rowCount: 2,
        }),
      ) as unknown as typeof fetch,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })

  it("rejects a short page while GA4 still declares unseen rows", async () => {
    const result = await queryGoogleAnalytics({
      propertyId: "1234",
      startDate: "2026-07-01",
      endDate: "2026-07-28",
      config,
      tokenProvider: async () => ({ ok: true, accessToken: "access" }),
      fetchImpl: vi.fn(async () =>
        Response.json({
          rows: [
            {
              dimensionValues: [{ value: "20260720" }, { value: "/one" }],
              metricValues: [{ value: "1" }, { value: "1" }, { value: "1" }],
            },
          ],
          rowCount: 3,
        }),
      ) as unknown as typeof fetch,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })
})

describe("queryWatchMeasurementReconciliation (FGE-115 U6)", () => {
  const tokenProvider = async () => ({
    ok: true as const,
    accessToken: "access",
  })

  function row(
    values: string[],
    eventCount: number,
  ): {
    dimensionValues: Array<{ value: string }>
    metricValues: Array<{ value: string }>
  } {
    return {
      dimensionValues: values.map((value) => ({ value })),
      metricValues: [{ value: String(eventCount) }],
    }
  }

  it("requests only date, event, and canonical page path for allowlisted Watch events", async () => {
    let request: Record<string, unknown> = {}
    const result = await queryWatchMeasurementReconciliation({
      propertyId: "1234",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      eventNames: ["page_view", "videostarts"],
      pagePaths: ["/watch/jesus.html"],
      config,
      tokenProvider,
      fetchImpl: vi.fn(async (_url, init) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json({ rows: [], rowCount: 0 })
      }) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      ok: true,
      grain: "standard",
      complete: true,
    })
    expect(request).toMatchObject({
      dimensions: [
        { name: "date" },
        { name: "eventName" },
        { name: "pagePath" },
      ],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: {
        andGroup: {
          expressions: [
            {
              filter: {
                fieldName: "pagePath",
                inListFilter: {
                  values: ["/watch/jesus.html"],
                  caseSensitive: true,
                },
              },
            },
            {
              filter: {
                fieldName: "eventName",
                inListFilter: {
                  values: ["page_view", "videostarts"],
                  caseSensitive: true,
                },
              },
            },
          ],
        },
      },
      returnPropertyQuota: true,
    })
  })

  it("adds the registered route-variant and contract-version dimensions only at contract grain", async () => {
    let request: Record<string, unknown> = {}
    await queryWatchMeasurementReconciliation({
      propertyId: "1234",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      grain: "contract",
      config,
      tokenProvider,
      fetchImpl: vi.fn(async (_url, init) => {
        request = JSON.parse(String(init?.body)) as Record<string, unknown>
        return Response.json({ rows: [], rowCount: 0 })
      }) as unknown as typeof fetch,
    })

    expect(request.dimensions).toEqual([
      { name: "date" },
      { name: "eventName" },
      { name: "pagePath" },
      { name: "customEvent:watch_route_variant" },
      { name: "customEvent:event_contract_version" },
    ])
    // No page-path list: the whole /watch/ prefix, never an unbounded scan.
    expect(
      (
        request.dimensionFilter as {
          andGroup: { expressions: Array<{ filter: unknown }> }
        }
      ).andGroup.expressions[0],
    ).toEqual({
      filter: {
        fieldName: "pagePath",
        stringFilter: {
          matchType: "BEGINS_WITH",
          value: "/watch/",
          caseSensitive: true,
        },
      },
    })
  })

  it("rejects arbitrary property fields, event names, and page paths before calling GA4", async () => {
    const fetchImpl = vi.fn()
    const base = {
      propertyId: "1234",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      config,
      tokenProvider,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }

    for (const overrides of [
      { propertyId: "9999" },
      { eventNames: ["purchase"] },
      { eventNames: [] },
      { pagePaths: ["/account/reset-password"] },
      { pagePaths: ["/watch/jesus.html?q=viewer@example.test"] },
      { pagePaths: ["/watch/../admin"] },
      { pagePaths: ["/watch//jesus.html"] },
      {
        pagePaths: Array.from({ length: 21 }, (_, i) => `/watch/v${i}.html`),
      },
      { grain: "raw" as never },
      { startDate: "2026-09-29" },
    ]) {
      const result = await queryWatchMeasurementReconciliation({
        ...base,
        ...overrides,
      })
      expect(result.ok).toBe(false)
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("reconciles canonical and compatibility rows to one canonical total while retaining variant totals (AE7)", async () => {
    const result = await queryWatchMeasurementReconciliation({
      propertyId: "1234",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      grain: "contract",
      eventNames: ["page_view"],
      pagePaths: ["/watch/jesus.html"],
      config,
      tokenProvider,
      fetchImpl: vi.fn(async () =>
        Response.json({
          rows: [
            row(
              ["20260901", "page_view", "/watch/jesus.html", "canonical", "2"],
              300,
            ),
            row(
              [
                "20260901",
                "page_view",
                "/watch/jesus.html",
                "explicit_language_compatibility",
                "2",
              ],
              200,
            ),
            row(
              ["20260902", "page_view", "/watch/jesus.html", "canonical", "2"],
              100,
            ),
          ],
          rowCount: 3,
          metadata: { timeZone: "America/Los_Angeles" },
        }),
      ) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({
      ok: true,
      complete: true,
      propertyTimezone: "America/Los_Angeles",
    })
    if (!result.ok) throw new Error("expected success")
    expect(result.reconciliation).toEqual([
      {
        pagePath: "/watch/jesus.html",
        eventName: "page_view",
        total: 600,
        byRouteVariant: {
          canonical: 400,
          explicit_language_compatibility: 200,
        },
        unattributedShare: 0,
      },
    ])
  })

  it("marks thresholded, other-row, and unattributed results partial", async () => {
    const result = await queryWatchMeasurementReconciliation({
      propertyId: "1234",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      grain: "contract",
      config,
      tokenProvider,
      fetchImpl: vi.fn(async () =>
        Response.json({
          rows: [
            row(
              [
                "20260901",
                "page_view",
                "/watch/jesus.html",
                "(not set)",
                "(not set)",
              ],
              50,
            ),
            row(
              ["20260901", "page_view", "/watch/jesus.html", "canonical", "2"],
              150,
            ),
          ],
          rowCount: 2,
          metadata: {
            subjectToThresholding: true,
            dataLossFromOtherRow: true,
          },
        }),
      ) as unknown as typeof fetch,
    })

    expect(result).toMatchObject({ ok: true, complete: false })
    if (!result.ok) throw new Error("expected success")
    expect(result.reconciliation[0]?.unattributedShare).toBe(0.25)
    expect(result.caveats).toEqual(
      expect.arrayContaining([
        "GA4 reports this result as subject to thresholding.",
        "GA4 reports data loss from an aggregated other row.",
        expect.stringContaining("no route variant"),
      ]),
    )
  })

  it("keeps zero rows and capped pagination explicit", async () => {
    const empty = await queryWatchMeasurementReconciliation({
      propertyId: "1234",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      config,
      tokenProvider,
      fetchImpl: vi.fn(async () =>
        Response.json({ rows: [], rowCount: 0 }),
      ) as unknown as typeof fetch,
    })
    expect(empty).toMatchObject({
      ok: true,
      rows: [],
      reconciliation: [],
      complete: true,
    })

    const capped = await queryWatchMeasurementReconciliation({
      propertyId: "1234",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      config,
      tokenProvider,
      requestBudget: { remaining: 1 },
      fetchImpl: vi.fn(async (_url, init) => {
        const body = JSON.parse(String(init?.body)) as { limit: string }
        return Response.json({
          rows: Array.from({ length: Number(body.limit) }, (_, i) =>
            row(["20260901", "page_view", `/watch/v${i}.html`], 1),
          ),
          rowCount: Number(body.limit) + 5,
        })
      }) as unknown as typeof fetch,
    })
    expect(capped).toMatchObject({ ok: true, complete: false })
    if (!capped.ok) throw new Error("expected success")
    expect(capped.caveats).toEqual(
      expect.arrayContaining([
        "Configured GA4 row cap was reached.",
        "The bounded GA4 request budget was exhausted.",
      ]),
    )
  })

  it("fails closed when GA4 returns a row outside the requested scope", async () => {
    const result = await queryWatchMeasurementReconciliation({
      propertyId: "1234",
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      pagePaths: ["/watch/jesus.html"],
      config,
      tokenProvider,
      fetchImpl: vi.fn(async () =>
        Response.json({
          rows: [row(["20260901", "page_view", "/account/settings"], 1)],
          rowCount: 1,
        }),
      ) as unknown as typeof fetch,
    })

    expect(result).toEqual({
      ok: false,
      reason: "parse_error",
      retryable: true,
    })
  })
})

describe("reconcileWatchMeasurementRows", () => {
  it("groups by page path and event name across dates without inventing variants", () => {
    const rows: Ga4Row[] = [
      {
        dimensions: {
          date: "20260901",
          eventName: "page_view",
          pagePath: "/watch/jesus.html",
        },
        metrics: { eventCount: 3 },
      },
      {
        dimensions: {
          date: "20260902",
          eventName: "page_view",
          pagePath: "/watch/jesus.html",
        },
        metrics: { eventCount: 4 },
      },
      {
        dimensions: {
          date: "20260901",
          eventName: "videostarts",
          pagePath: "/watch/jesus.html",
        },
        metrics: { eventCount: 2 },
      },
    ]

    expect(reconcileWatchMeasurementRows(rows)).toEqual([
      {
        pagePath: "/watch/jesus.html",
        eventName: "page_view",
        total: 7,
        byRouteVariant: {},
        unattributedShare: null,
      },
      {
        pagePath: "/watch/jesus.html",
        eventName: "videostarts",
        total: 2,
        byRouteVariant: {},
        unattributedShare: null,
      },
    ])
  })
})
