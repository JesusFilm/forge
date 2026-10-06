import { describe, expect, it, vi } from "vitest"
import {
  readWatchPublicObservationHours,
  recordWatchPublicObservation,
  watchPublicObservationHour,
} from "./recommendation-public-observation"

describe("bounded public Watch observation", () => {
  it("uses one UTC-hour hash, fixed field, atomic increment and TTL", async () => {
    const redis = {
      eval: vi.fn(
        async (
          _script: string,
          _options: { keys: string[]; arguments: string[] },
        ) => 1,
      ),
    }
    expect(
      await recordWatchPublicObservation(
        "delivery_attempt",
        "2026100620",
        redis,
      ),
    ).toBe(true)
    const [script, options] = redis.eval.mock.calls[0]!
    expect(script).toContain("HINCRBY")
    expect(options).toEqual({
      keys: ["recommendation:public-watch-observation:v1:2026100620"],
      arguments: ["delivery_attempt", String(70 * 86_400)],
    })
    expect(watchPublicObservationHour(new Date("2026-10-06T20:59:00Z"))).toBe(
      "2026100620",
    )
  })

  it("preserves missing buckets as null, never zero", async () => {
    const redis = {
      eval: vi.fn(
        async (
          _script: string,
          _options: { keys: string[]; arguments: string[] },
        ) => [["delivery_attempt", "2", "delivery_qualified", "1"], []],
      ),
    }
    expect(
      await readWatchPublicObservationHours(
        ["2026100620", "2026100621"],
        redis,
      ),
    ).toEqual([
      {
        hour: "2026100620",
        counters: { delivery_attempt: 2, delivery_qualified: 1 },
      },
      { hour: "2026100621", counters: null },
    ])
    expect(redis.eval.mock.calls[0]?.[1].keys).toEqual([
      "recommendation:public-watch-observation:v1:2026100620",
      "recommendation:public-watch-observation:v1:2026100621",
    ])
  })

  it("fails closed on corrupted or unavailable aggregate reads", async () => {
    const hours = ["2026100620"]
    expect(
      await readWatchPublicObservationHours(hours, {
        eval: async () => [["unexpected_field", "1"]],
      }),
    ).toBeNull()
    expect(
      await readWatchPublicObservationHours(hours, {
        eval: async () => {
          throw new Error("redis down")
        },
      }),
    ).toBeNull()
    expect(await readWatchPublicObservationHours(hours, null)).toBeNull()
  })
})
