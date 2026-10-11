import { describe, expect, it, vi } from "vitest"
import {
  readWatchExperimentObservationHours,
  readWatchPublicObservationHours,
  recordWatchExperimentObservation,
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

  it("keeps a click-only hour present after its delivery hour has ended", async () => {
    const redis = {
      eval: vi.fn(async () => [["click_attempt", "2", "click_ack", "1"], []]),
    }
    expect(
      await readWatchPublicObservationHours(
        ["2026100620", "2026100621"],
        redis,
      ),
    ).toEqual([
      {
        hour: "2026100620",
        counters: { click_attempt: 2, click_ack: 1 },
      },
      { hour: "2026100621", counters: null },
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

  it("keeps experiment outcomes in a bounded separate hourly namespace", async () => {
    const redis = {
      eval: vi.fn(
        async (
          _script: string,
          _options: { keys: string[]; arguments: string[] },
        ): Promise<unknown> => 1,
      ),
    }
    expect(
      await recordWatchExperimentObservation(
        "trial-7",
        "click_unavailable",
        "2026100621",
        redis,
      ),
    ).toBe(true)
    expect(redis.eval.mock.calls[0]?.[1]).toEqual({
      keys: [
        "recommendation:experiment-watch-observation:v1:trial-7:2026100621",
      ],
      arguments: ["click_unavailable", String(70 * 86_400)],
    })
    expect(
      await recordWatchExperimentObservation(
        "../bad",
        "click_attempt",
        "2026100621",
        redis,
      ),
    ).toBe(false)
    expect(redis.eval).toHaveBeenCalledTimes(1)

    redis.eval.mockResolvedValueOnce([
      ["click_attempt", "2", "click_ack", "1"],
      [],
    ])
    expect(
      await readWatchExperimentObservationHours(
        "trial-7",
        ["2026100621", "2026100622"],
        redis,
      ),
    ).toEqual([
      { hour: "2026100621", counters: { click_attempt: 2, click_ack: 1 } },
      { hour: "2026100622", counters: null },
    ])
  })

  it("keeps a request's scoped attempt and terminal outcome in its starting UTC hour", async () => {
    const redis = {
      eval: vi.fn(
        async (
          _script: string,
          _options: { keys: string[]; arguments: string[] },
        ): Promise<unknown> => 1,
      ),
    }
    const startedAt = watchPublicObservationHour(
      new Date("2026-10-06T20:59:59.999Z"),
    )
    expect(startedAt).toBe("2026100620")
    expect(
      watchPublicObservationHour(new Date("2026-10-06T21:00:00.000Z")),
    ).toBe("2026100621")
    await recordWatchExperimentObservation(
      "trial-7",
      "delivery_attempt",
      startedAt,
      redis,
    )
    await recordWatchExperimentObservation(
      "trial-7",
      "delivery_eligible",
      startedAt,
      redis,
    )
    expect(redis.eval.mock.calls.map(([, options]) => options.keys[0])).toEqual(
      Array(2).fill(
        "recommendation:experiment-watch-observation:v1:trial-7:2026100620",
      ),
    )
  })
})
