/** @vitest-environment jsdom */

import { act, StrictMode } from "react"
import type { Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RECOMMENDATION_TAB_CORRELATION_KEY } from "@/lib/recommendation-contracts"
import { RecommendationPlaybackRecorder } from "./RecommendationPlaybackRecorder"
import {
  acceptedFactsResponse,
  deferred,
  makePlayer,
  response,
  type RecorderFetchMock,
  usePlaybackRecorderHarness,
} from "./RecommendationPlaybackRecorder.test-fixtures"

describe("playback fact recovery bounds", () => {
  let root: Root
  let fetchMock: RecorderFetchMock
  const degraded = vi.fn()
  usePlaybackRecorderHarness((harness) => {
    root = harness.root
    fetchMock = harness.fetchMock
  })
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    degraded.mockClear()
    window.addEventListener("forge:recommendation-playback-degraded", degraded)
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    fetchMock.mockResolvedValueOnce(
      response({
        episode: {
          episodeId: "episode-1",
          capability: "synthetic-episode-capability",
          activeUntil: "2026-08-19T07:00:00.000Z",
          hardUntil: "2026-08-19T09:00:00.000Z",
        },
      }),
    )
    fetchMock.mockResolvedValue(response({ error: "unavailable" }, false, 503))
  })
  afterEach(() => {
    window.removeEventListener(
      "forge:recommendation-playback-degraded",
      degraded,
    )
    vi.restoreAllMocks()
  })

  async function start() {
    const player = makePlayer()
    await act(async () => {
      root.render(
        <StrictMode>
          <RecommendationPlaybackRecorder
            player={player}
            initiation="manual"
            mediaId="media-1"
            durationSeconds={120}
          />
        </StrictMode>,
      )
    })
    player.paused = false
    await act(async () => player.dispatch("playing"))
    return player
  }

  it.each(["transport", "invalid receipt", "missing receipt"])(
    "bounds %s failures to three paced attempts",
    async (failure) => {
      if (failure === "invalid receipt")
        fetchMock.mockResolvedValue(response({ nope: true }))
      if (failure === "missing receipt")
        fetchMock.mockResolvedValue(response({ receipts: [] }))
      await start()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await act(async () => vi.advanceTimersByTimeAsync(999))
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await act(async () => vi.advanceTimersByTimeAsync(1))
      expect(fetchMock).toHaveBeenCalledTimes(3)
      await act(async () => vi.advanceTimersByTimeAsync(7_999))
      expect(fetchMock).toHaveBeenCalledTimes(3)
      await act(async () => vi.advanceTimersByTimeAsync(1))
      expect(fetchMock).toHaveBeenCalledTimes(4)
      await act(async () => vi.advanceTimersByTimeAsync(60_000))
      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(
        new Set(fetchMock.mock.calls.slice(1).map(([, init]) => init.body))
          .size,
      ).toBe(1)
      expect(degraded).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({ disposition: "dropped" }),
        }),
      )
    },
  )

  it("queues new player facts without bypassing either retry delay", async () => {
    const player = await start()
    await act(async () => vi.advanceTimersByTimeAsync(500))
    player.currentTime = 1
    await act(async () => player.dispatch("seeking"))
    player.currentTime = 5
    await act(async () => player.dispatch("seeked"))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    await act(async () => player.dispatch("pause"))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(acceptedFactsResponse(init)),
    )
    await act(async () => vi.advanceTimersByTimeAsync(7_000))
    expect(fetchMock).toHaveBeenCalledTimes(4)
    const initial = JSON.parse(fetchMock.mock.calls[1]![1].body).events
    const recovered = JSON.parse(fetchMock.mock.calls[3]![1].body).events
    expect(recovered).toEqual(expect.arrayContaining(initial))
    expect(recovered).toContainEqual(
      expect.objectContaining({ kind: "playback_seek" }),
    )
  })

  it("adds bounded jitter to both delays", async () => {
    vi.mocked(Math.random).mockReturnValue(0.8)
    await start()
    await act(async () => vi.advanceTimersByTimeAsync(1_199))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await act(async () => vi.advanceTimersByTimeAsync(9_599))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it("expires attempted facts after a throttled timer misses the recovery window", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0)
    await start()
    now.mockReturnValue(30_000)
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(degraded).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: expect.objectContaining({
          reason: "transport_exhausted",
          disposition: "dropped",
        }),
      }),
    )
  })

  it("uses monotonic recovery age when the wall clock jumps forward", async () => {
    await start()
    vi.setSystemTime(new Date("2026-08-20T03:00:00.000Z"))
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(acceptedFactsResponse(init)),
    )
    await act(async () => vi.advanceTimersByTimeAsync(1_000))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2]![1].body).toBe(
      fetchMock.mock.calls[1]![1].body,
    )
  })

  it("cancels pending retries on unmount but preserves terminal keepalive", async () => {
    await start()
    await act(async () => root.render(null))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const last = fetchMock.mock.calls[2]![1]
    expect(last.keepalive).toBe(true)
    expect(JSON.parse(last.body).events).toEqual([
      expect.objectContaining({ kind: "playback_end" }),
    ])
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("does not create retries when a request fails after unmount", async () => {
    const pending = deferred<Response>()
    fetchMock.mockReturnValueOnce(pending.promise)
    await start()
    await act(async () => root.render(null))
    const sendsAfterDeparture = fetchMock.mock.calls.length
    await act(async () => pending.reject(new Error("late failure")))
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(fetchMock).toHaveBeenCalledTimes(sendsAfterDeparture)
  })

  it("sends pagehide terminal truth during backoff without accelerating earlier facts", async () => {
    await start()
    await act(async () => window.dispatchEvent(new Event("pagehide")))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.parse(fetchMock.mock.calls[2]![1].body).events).toEqual([
      expect.objectContaining({ kind: "playback_end" }),
    ])
    await act(async () => vi.advanceTimersByTimeAsync(999))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
