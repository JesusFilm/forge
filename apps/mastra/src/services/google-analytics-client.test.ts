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
})
