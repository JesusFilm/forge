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

  it("rethrows after the third P2034 conflict", async () => {
    const error = conflict()
    const operation = vi.fn<() => Promise<never>>().mockRejectedValue(error)

    await expect(withRecommendationSerializableRetry(operation)).rejects.toBe(
      error,
    )
    expect(operation).toHaveBeenCalledTimes(3)
  })
})
