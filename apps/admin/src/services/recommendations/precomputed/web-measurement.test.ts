import { describe, expect, it, vi } from "vitest"
import {
  loadWebExperimentMeasurement,
  loadWebWatchMeasurement,
  WEB_WATCH_MEASUREMENT_CONTRACT,
} from "./web-measurement"

const HOUR_MS = 3_600_000
const url =
  "http://127.0.0.1:3000/watch/api/internal/recommendations/precomputed-measurement"
const apiKey = "measurement-api-key-0123456789abcdef"
const now = new Date("2026-04-01T00:00:00.000Z")

function counters() {
  return { delivery_attempt: 1, delivery_inactive: 1 } as Record<string, number>
}

function page(requestUrl: string, missingIndex = -1, imbalanceIndex = -1) {
  const parsed = new URL(requestUrl)
  const startHour = parsed.searchParams.get("startHour")!
  const endHourExclusive = parsed.searchParams.get("endHourExclusive")!
  const start = new Date(startHour).getTime()
  const requestedHours =
    (new Date(endHourExclusive).getTime() - start) / HOUR_MS
  const hours = Array.from({ length: requestedHours }, (_, index) => {
    const hour = new Date(start + index * HOUR_MS)
      .toISOString()
      .slice(0, 13)
      .replaceAll("-", "")
      .replace("T", "")
    const values = counters()
    if (index === imbalanceIndex) delete values.delivery_inactive
    return { hour, counters: index === missingIndex ? null : values }
  })
  return {
    contractVersion: WEB_WATCH_MEASUREMENT_CONTRACT,
    observedAt: now.toISOString(),
    startHour,
    endHourExclusive,
    requestedHours,
    coveredHours: requestedHours - (missingIndex >= 0 ? 1 : 0),
    missingHours: hours
      .filter((item) => item.counters === null)
      .map((item) => item.hour),
    hours,
  }
}

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

describe("authenticated Web Watch measurement reader", () => {
  it("reads only the requested experiment and keeps retries distinct from durable visits", async () => {
    const transport = vi.fn(async (requestUrl: string) => {
      const base = page(requestUrl)
      return response({
        ...base,
        contractVersion: "watch-experiment-measurement-v1",
        experimentId: "trial-7",
        hours: base.hours.map((hour) => ({
          ...hour,
          counters: {
            delivery_attempt: 1,
            delivery_eligible: 1,
            click_attempt: 3,
            click_ack: 2,
            click_unavailable: 1,
          },
        })),
      })
    })
    const result = await loadWebExperimentMeasurement(
      "trial-7",
      new Date("2026-02-01T00:00:00.000Z"),
      new Date("2026-02-01T01:00:00.000Z"),
      { url, apiKey, transport, now },
    )
    expect(result).toMatchObject({
      status: "complete",
      experimentId: "trial-7",
      counters: { click_attempt: 3, click_ack: 2, click_unavailable: 1 },
    })
    expect(
      new URL(transport.mock.calls[0]![0]).searchParams.get("experimentId"),
    ).toBe("trial-7")
  })
  it("splits a cohort plus late cutoff across the 840-hour endpoint limit", async () => {
    const transport = vi.fn(async (requestUrl: string) =>
      response(page(requestUrl)),
    )
    const result = await loadWebWatchMeasurement(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2026-02-07T12:00:00.000Z"),
      { url, apiKey, transport, now },
    )
    expect(result).toMatchObject({
      status: "complete",
      requestedHours: 900,
      coveredHours: 900,
      counterUnit: "web_request_attempts_not_distinct_visits",
      missingHours: [],
      imbalancedHours: [],
    })
    expect(transport).toHaveBeenCalledTimes(2)
    expect(
      new URL(transport.mock.calls[0]![0]).searchParams.get("endHourExclusive"),
    ).toBe("2026-02-05T00:00:00.000Z")
    expect(
      new URL(transport.mock.calls[1]![0]).searchParams.get("startHour"),
    ).toBe("2026-02-05T00:00:00.000Z")
  })

  it("preserves missing buckets and detects attempt/terminal loss", async () => {
    const start = new Date("2026-02-01T00:00:00.000Z")
    const end = new Date("2026-02-01T03:00:00.000Z")
    const missing = await loadWebWatchMeasurement(start, end, {
      url,
      apiKey,
      now,
      transport: async (requestUrl) => response(page(requestUrl, 1)),
    })
    expect(missing).toMatchObject({
      status: "incomplete",
      requestedHours: 3,
      coveredHours: 2,
      missingHours: ["2026020101"],
    })
    const imbalanced = await loadWebWatchMeasurement(start, end, {
      url,
      apiKey,
      now,
      transport: async (requestUrl) => response(page(requestUrl, -1, 2)),
    })
    expect(imbalanced).toMatchObject({
      status: "incomplete",
      imbalancedHours: ["2026020102"],
    })
    const clickOnly = await loadWebWatchMeasurement(start, end, {
      url,
      apiKey,
      now,
      transport: async (requestUrl) => {
        const result = page(requestUrl)
        result.hours[0]!.counters = { click_attempt: 1, click_ack: 1 }
        return response(result)
      },
    })
    expect(clickOnly).toMatchObject({
      status: "complete",
      counters: { click_attempt: 1, click_ack: 1, delivery_attempt: 2 },
    })
  })

  it("fails closed on malformed coverage, auth failure, and non-loopback HTTP", async () => {
    const start = new Date("2026-02-01T00:00:00.000Z")
    const end = new Date("2026-02-01T01:00:00.000Z")
    const malformed = await loadWebWatchMeasurement(start, end, {
      url,
      apiKey,
      now,
      transport: async (requestUrl) =>
        response({ ...page(requestUrl), coveredHours: 0 }),
    })
    expect(malformed).toEqual({
      status: "unavailable",
      reason: "measurement_contract_invalid",
    })
    const stale = await loadWebWatchMeasurement(start, end, {
      url,
      apiKey,
      now,
      transport: async (requestUrl) =>
        response({
          ...page(requestUrl),
          observedAt: "2026-03-31T23:50:00.000Z",
        }),
    })
    expect(stale).toEqual({
      status: "unavailable",
      reason: "measurement_contract_invalid",
    })
    const failedAuth = await loadWebWatchMeasurement(start, end, {
      url,
      apiKey,
      now,
      transport: async () => response({}, 401),
    })
    expect(failedAuth).toEqual({
      status: "unavailable",
      reason: "measurement_authentication_failed",
    })
    const forbiddenUrl = await loadWebWatchMeasurement(start, end, {
      url: "http://example.com/watch/api/internal/recommendations/precomputed-measurement",
      apiKey,
      now,
      transport: async () => {
        throw new Error("must not call")
      },
    })
    expect(forbiddenUrl).toEqual({
      status: "unavailable",
      reason: "measurement_not_configured",
    })
  })
})
