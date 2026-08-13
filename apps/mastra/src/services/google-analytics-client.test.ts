import { describe, expect, it, vi } from "vitest"

import { getSeoConfig } from "../config/seo"
import { queryGoogleAnalytics } from "./google-analytics-client"

const config = getSeoConfig({
  SEO_GA4_PROPERTY_IDS: "1234",
  SEO_MAX_PROVIDER_ATTEMPTS: "1",
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
