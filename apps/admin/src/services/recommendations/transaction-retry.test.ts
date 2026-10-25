import type { Prisma } from "@prisma/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  lockRecommendationEpisode,
  withRecommendationSerializableRetry,
} from "./transaction-retry"

function conflict() {
  return Object.assign(new Error("serialization conflict"), { code: "P2034" })
}

describe("recommendation serializable transaction retry", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("releases busy transactions and retains the separate serialization retry budget", async () => {
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ locked: false }])
        .mockResolvedValue([{ locked: true }]),
    } as unknown as Prisma.TransactionClient
    const write = vi
      .fn()
      .mockRejectedValueOnce(conflict())
      .mockRejectedValueOnce(conflict())
      .mockResolvedValue("ok")
    const operation = vi.fn(async () => {
      await lockRecommendationEpisode(tx, "episode")
      return write()
    })
    await expect(withRecommendationSerializableRetry(operation)).resolves.toBe(
      "ok",
    )
    expect(operation).toHaveBeenCalledTimes(4)
    expect(write).toHaveBeenCalledTimes(3)
  })

  it("bounds lock acquisition attempts independently of serialization retries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] })
    vi.spyOn(Math, "random").mockReturnValue(0)
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]),
    } as unknown as Prisma.TransactionClient
    const result = expect(
      withRecommendationSerializableRetry(() =>
        lockRecommendationEpisode(tx, "episode"),
      ),
    ).rejects.toMatchObject({ code: "recommendation_episode_lock_exhausted" })
    await vi.runAllTimersAsync()
    await result
    expect(tx.$queryRaw).toHaveBeenCalledTimes(64)
  })

  it("also bounds the elapsed lock contention budget", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] })
    vi.spyOn(Math, "random").mockReturnValue(0.99)
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]),
    } as unknown as Prisma.TransactionClient
    const result = expect(
      withRecommendationSerializableRetry(() =>
        lockRecommendationEpisode(tx, "episode"),
      ),
    ).rejects.toMatchObject({ code: "recommendation_episode_lock_exhausted" })
    await vi.runAllTimersAsync()
    await result
    expect(performance.now()).toBe(1500)
    expect(vi.mocked(tx.$queryRaw).mock.calls.length).toBeLessThan(64)
  })

  it("does not retry unrelated errors", async () => {
    const error = new Error("database unavailable")
    const operation = vi.fn().mockRejectedValue(error)
    await expect(withRecommendationSerializableRetry(operation)).rejects.toBe(
      error,
    )
    expect(operation).toHaveBeenCalledOnce()
  })
  it("retries a bounded P2034 conflict before succeeding", async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(conflict())
      .mockResolvedValueOnce("ok")

    await expect(withRecommendationSerializableRetry(operation)).resolves.toBe(
      "ok",
    )
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it.each([
    { code: "P2034" },
    { code: "40001" },
    { code: "P2010", meta: { code: "40001" } },
    { cause: { code: "P2034" } },
    { code: "wrapper", cause: { code: "P2010", meta: { code: "40001" } } },
  ])("recovers the structured serialization conflict %j", async (error) => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok")
    await expect(withRecommendationSerializableRetry(operation)).resolves.toBe(
      "ok",
    )
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it.each([
    { code: "P2010", meta: { code: "42P01" } },
    { code: "P2010", message: "40001" },
    { code: "40001-looking" },
    { meta: { code: "40001" } },
  ])("does not retry an unrelated structured error %j", async (error) => {
    const operation = vi.fn().mockRejectedValue(error)
    await expect(withRecommendationSerializableRetry(operation)).rejects.toBe(
      error,
    )
    expect(operation).toHaveBeenCalledOnce()
  })

  it("bounds cyclic and excessively deep cause chains", async () => {
    const cycle: { cause?: unknown } = {}
    cycle.cause = cycle
    let deep: unknown = conflict()
    for (let index = 0; index < 20; index += 1) deep = { cause: deep }
    for (const error of [cycle, deep]) {
      const operation = vi.fn().mockRejectedValue(error)
      await expect(withRecommendationSerializableRetry(operation)).rejects.toBe(
        error,
      )
      expect(operation).toHaveBeenCalledOnce()
    }
  })

  it("throws a typed server failure after the third conflict", async () => {
    const error = conflict()
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error)

    await expect(
      withRecommendationSerializableRetry(operation),
    ).rejects.toMatchObject({
      name: "RecommendationInternalStateError",
      code: "recommendation_serialization_exhausted",
    })
    expect(operation).toHaveBeenCalledTimes(3)
  })
})
