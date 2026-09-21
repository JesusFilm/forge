import { afterEach, describe, expect, it, vi } from "vitest"
import {
  consumeDeliveryCapabilitySubmissions,
  consumeEpisodeCapabilitySubmissions,
} from "./submission-budget"

const input = {
  requestId: "private-request",
  capabilityJti: "private-capability",
  attempts: 1,
  expiresAt: new Date("2026-09-23T00:00:00Z"),
}

afterEach(() => vi.restoreAllMocks())

describe("submission budget timing", () => {
  it.each(["delivery", "episode"] as const)(
    "separates server work from a slow %s call without identifiers",
    async (kind) => {
      vi.spyOn(performance, "now")
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(701)
      const log = vi.spyOn(console, "info").mockImplementation(() => {})
      const queryRaw = vi
        .fn()
        .mockResolvedValue([{ attempts: 1, serverElapsedMs: 4.6 }])
      const db = { $queryRaw: queryRaw }
      if (kind === "delivery")
        await consumeDeliveryCapabilitySubmissions(db, input)
      else
        await consumeEpisodeCapabilitySubmissions(db, {
          ...input,
          episodeId: "private-episode",
        })
      expect(queryRaw).toHaveBeenCalledTimes(1)
      expect(log).toHaveBeenCalledExactlyOnceWith(
        `event=recommendation.submission_budget kind=${kind} elapsedMs=701 serverElapsedMs=5 outsideServerMs=696`,
      )
      expect(log.mock.calls.flat().join(" ")).not.toContain("private-")
    },
  )

  it("keeps fast calls quiet", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(20)
    const log = vi.spyOn(console, "info").mockImplementation(() => {})
    await consumeDeliveryCapabilitySubmissions(
      {
        $queryRaw: vi
          .fn()
          .mockResolvedValue([{ attempts: 1, serverElapsedMs: 2 }]),
      },
      input,
    )
    expect(log).not.toHaveBeenCalled()
  })

  it.each([NaN, Infinity, -1, 1_000, "private-server-value", undefined])(
    "does not emit invalid server timing %s or change acceptance",
    async (serverElapsedMs) => {
      vi.spyOn(performance, "now")
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(250)
      const log = vi.spyOn(console, "info").mockImplementation(() => {})
      await consumeDeliveryCapabilitySubmissions(
        {
          $queryRaw: vi
            .fn()
            .mockResolvedValue([{ attempts: 1, serverElapsedMs }]),
        },
        input,
      )
      expect(log).not.toHaveBeenCalled()
    },
  )

  it("keeps an exhausted budget rejected even if diagnostic logging fails", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(250)
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("logging failed")
    })
    await expect(
      consumeDeliveryCapabilitySubmissions(
        {
          $queryRaw: vi
            .fn()
            .mockResolvedValue([{ attempts: null, serverElapsedMs: 200 }]),
        },
        input,
      ),
    ).rejects.toThrow("Recommendation evidence submission budget is exhausted")
  })

  it("preserves successful consumption if diagnostic logging fails", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValueOnce(250)
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("logging failed")
    })
    await expect(
      consumeDeliveryCapabilitySubmissions(
        {
          $queryRaw: vi
            .fn()
            .mockResolvedValue([{ attempts: 1, serverElapsedMs: 200 }]),
        },
        input,
      ),
    ).resolves.toBeUndefined()
  })

  it("propagates the original database error without retrying", async () => {
    const failure = new Error("database unavailable")
    const queryRaw = vi.fn().mockRejectedValue(failure)
    await expect(
      consumeDeliveryCapabilitySubmissions({ $queryRaw: queryRaw }, input),
    ).rejects.toBe(failure)
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })
})
