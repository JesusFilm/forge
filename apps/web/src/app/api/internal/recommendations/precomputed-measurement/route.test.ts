import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { readHours, key } = vi.hoisted(() => ({
  readHours: vi.fn(),
  key: "watch-measurement-test-key-0123456789abcdef",
}))
vi.mock("@/env", () => ({
  env: { WATCH_RECOMMENDATION_MEASUREMENT_API_KEY: key },
}))
vi.mock("@/lib/recommendation-public-observation", () => ({
  readWatchPublicObservationHours: readHours,
  watchPublicObservationHour: (at: Date) =>
    at.toISOString().slice(0, 13).replace(/[-T]/g, ""),
}))

const { GET } = await import("./route")
const base =
  "https://watch.example/watch/api/internal/recommendations/precomputed-measurement"
const range =
  "?startHour=2026-10-05T00%3A00%3A00.000Z&endHourExclusive=2026-10-05T02%3A00%3A00.000Z"

function request(url = base + range, authorization = `Bearer ${key}`) {
  return new Request(url, { headers: { authorization } })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-10-07T20:30:00.000Z"))
  readHours.mockReset()
})
afterEach(() => vi.useRealTimers())

describe("internal public Watch aggregate read", () => {
  it("requires the dedicated bearer before reading Redis", async () => {
    const response = await GET(request(base + range, "Bearer wrong"))
    expect(response.status).toBe(401)
    expect(readHours).not.toHaveBeenCalled()
    expect(response.headers.get("cache-control")).toContain("no-store")
  })

  it("returns exact hourly counts and missing buckets without inventing zeroes", async () => {
    readHours.mockResolvedValueOnce([
      {
        hour: "2026100500",
        counters: { delivery_attempt: 2, delivery_qualified: 1 },
      },
      { hour: "2026100501", counters: null },
    ])
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      contractVersion: "watch-public-measurement-v1",
      observedAt: "2026-10-07T20:30:00.000Z",
      startHour: "2026-10-05T00:00:00.000Z",
      endHourExclusive: "2026-10-05T02:00:00.000Z",
      requestedHours: 2,
      coveredHours: 1,
      missingHours: ["2026100501"],
      hours: [
        {
          hour: "2026100500",
          counters: { delivery_attempt: 2, delivery_qualified: 1 },
        },
        { hour: "2026100501", counters: null },
      ],
    })
    expect(readHours).toHaveBeenCalledWith(["2026100500", "2026100501"])
  })

  it("rejects partial/future hours and >35-day reads", async () => {
    for (const query of [
      "?startHour=2026-10-07T20:00:00.000Z&endHourExclusive=2026-10-07T21:00:00.000Z",
      "?startHour=2026-09-01T00:00:00.000Z&endHourExclusive=2026-10-07T00:00:00.000Z",
      "?startHour=2026-10-05T01:30:00.000Z&endHourExclusive=2026-10-05T02:00:00.000Z",
      "?startHour=2026-10-05T00:00:00.000Z&endHourExclusive=2026-10-05T00:00:00.000Z",
    ]) {
      expect((await GET(request(base + query))).status).toBe(400)
    }
    expect(readHours).not.toHaveBeenCalled()
  })

  it("reports Redis unavailability separately from a zero-count observation", async () => {
    readHours.mockResolvedValueOnce(null)
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ reason: "observation_unavailable" })
  })
})
