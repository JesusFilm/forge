import { createClient } from "redis"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  closeWatchPublicObservationRedisForTests,
  recordWatchPublicObservation,
  watchPublicObservationHour,
} from "@/lib/recommendation-public-observation"

const key = "watch-measurement-native-test-key-0123456789abcdef"
vi.mock("@/env", () => ({
  env: { WATCH_RECOMMENDATION_MEASUREMENT_API_KEY: key },
}))

const { GET } = await import("./route")
const run =
  process.env.RECOMMENDATION_REDIS_TEST === "1" &&
  Boolean(process.env.REDIS_URL?.trim())

describe.skipIf(!run)("native Watch-to-measurement Redis seam", () => {
  const start = new Date((Math.floor(Date.now() / 3_600_000) - 2) * 3_600_000)
  const end = new Date(start.getTime() + 2 * 3_600_000)
  const observedHour = watchPublicObservationHour(start)
  const redisKey = `recommendation:public-watch-observation:v1:${observedHour}`
  const clickOnlyHour = watchPublicObservationHour(
    new Date(start.getTime() + 3_600_000),
  )
  const clickOnlyKey = `recommendation:public-watch-observation:v1:${clickOnlyHour}`
  let cleanup: ReturnType<typeof createClient>

  beforeAll(async () => {
    cleanup = createClient({ url: process.env.REDIS_URL })
    await cleanup.connect()
    await cleanup.del([redisKey, clickOnlyKey])
  })
  afterAll(async () => {
    await cleanup.del([redisKey, clickOnlyKey])
    await cleanup.quit()
    await closeWatchPublicObservationRedisForTests()
  })

  it("atomically persists real request counts and exposes an unobserved hour as missing", async () => {
    expect(
      await recordWatchPublicObservation("delivery_attempt", observedHour),
    ).toBe(true)
    expect(
      await recordWatchPublicObservation("delivery_qualified", observedHour),
    ).toBe(true)
    expect(await cleanup.hGetAll(redisKey)).toEqual({
      delivery_attempt: "1",
      delivery_qualified: "1",
    })
    expect(await cleanup.ttl(redisKey)).toBeGreaterThan(69 * 86_400)
    const url = new URL(
      "http://localhost:3000/watch/api/internal/recommendations/precomputed-measurement",
    )
    url.searchParams.set("startHour", start.toISOString())
    url.searchParams.set("endHourExclusive", end.toISOString())
    const response = await GET(
      new Request(url, { headers: { authorization: `Bearer ${key}` } }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.coveredHours).toBe(1)
    expect(body.missingHours).toEqual([
      watchPublicObservationHour(new Date(start.getTime() + 3_600_000)),
    ])
    expect(body.hours[0].counters).toEqual({
      delivery_attempt: 1,
      delivery_qualified: 1,
    })
    expect(body.hours[1].counters).toBeNull()
  })

  it("counts a real click-only Redis hour as observed", async () => {
    expect(
      await recordWatchPublicObservation("click_attempt", clickOnlyHour),
    ).toBe(true)
    expect(await recordWatchPublicObservation("click_ack", clickOnlyHour)).toBe(
      true,
    )
    expect(await cleanup.hGetAll(clickOnlyKey)).toEqual({
      click_attempt: "1",
      click_ack: "1",
    })
    const url = new URL(
      "http://localhost:3000/watch/api/internal/recommendations/precomputed-measurement",
    )
    url.searchParams.set("startHour", start.toISOString())
    url.searchParams.set("endHourExclusive", end.toISOString())
    const response = await GET(
      new Request(url, { headers: { authorization: `Bearer ${key}` } }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.coveredHours).toBe(2)
    expect(body.missingHours).toEqual([])
    expect(body.hours[1].counters).toEqual({
      click_attempt: 1,
      click_ack: 1,
    })
  })
})
