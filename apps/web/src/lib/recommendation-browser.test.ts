/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  recommendationFetchWithRetry,
  recommendationJsonWithRetry,
} from "./recommendation-browser"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("evidence acknowledgement retries", () => {
  it.each([400, 401, 403, 409, 410, 422])(
    "does not retry definitive HTTP %s",
    async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response("{}", { status }))
      vi.stubGlobal("fetch", fetchMock)
      const failed = vi.fn()
      await expect(
        recommendationJsonWithRetry(
          "/evidence",
          { method: "POST", body: "exact-body" },
          5_000,
          { onAttemptFailure: failed },
        ),
      ).rejects.toThrow()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(failed).toHaveBeenCalledWith({
        attempt: 1,
        reason: "rejected",
        willRetry: false,
      })
    },
  )
  it("does not retry a rejected share action", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 403 }))
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      recommendationFetchWithRetry(
        "/content-actions",
        { method: "POST", body: "exact-body" },
        700,
      ),
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("replays the exact request after an ambiguous transport failure", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response('{"receipts":[]}'))
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      recommendationJsonWithRetry(
        "/evidence",
        { method: "POST", body: "exact-body" },
        5_000,
        { backoffMs: 0 },
      ),
    ).resolves.toEqual({ receipts: [] })
    expect(fetchMock.mock.calls[1][1].body).toBe(
      fetchMock.mock.calls[0][1].body,
    )
  })
})
