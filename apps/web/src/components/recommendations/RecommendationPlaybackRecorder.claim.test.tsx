/**
 * @vitest-environment jsdom
 */

import { act, StrictMode } from "react"
import type { Root } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

import { RecommendationPlaybackRecorder } from "./RecommendationPlaybackRecorder"
import {
  deferred,
  makePlayer,
  response,
  type RecorderFetchMock,
  usePlaybackRecorderHarness,
} from "./RecommendationPlaybackRecorder.test-fixtures"
import { RECOMMENDATION_TAB_CORRELATION_KEY } from "@/lib/recommendation-contracts"

describe("RecommendationPlaybackRecorder claim lifecycle", () => {
  let root: Root
  let fetchMock: RecorderFetchMock

  usePlaybackRecorderHarness((harness) => {
    root = harness.root
    fetchMock = harness.fetchMock
  })

  it("retains the nonce until a valid claim response and does not delay player availability", async () => {
    const claim = deferred<Response>()
    fetchMock.mockReturnValueOnce(claim.promise)
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    const player = makePlayer()

    await act(async () => {
      root.render(
        <StrictMode>
          <RecommendationPlaybackRecorder
            player={player}
            initiation={null}
            mediaId="media-1"
            durationSeconds={120}
          />
        </StrictMode>,
      )
    })

    expect(sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY)).toBe(
      "claim-nonce-1234567890",
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/recommendations\/playback$/)
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({
      action: "claim",
      claimNonce: "claim-nonce-1234567890",
      mediaId: "media-1",
    })
    expect(player.addEventListener).toHaveBeenCalled()

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
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("aborts a claim whose headers arrive but JSON body exceeds the deadline", async () => {
    let claimSignal: AbortSignal | undefined
    fetchMock.mockImplementationOnce(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        claimSignal = init?.signal ?? undefined
        return Promise.resolve({
          ok: true,
          json: () => new Promise<never>(() => undefined),
        } as unknown as Response)
      },
    )
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )

    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={makePlayer()}
          initiation={null}
          mediaId="media-1"
          durationSeconds={120}
        />,
      )
      await Promise.resolve()
    })
    expect(claimSignal?.aborted).toBe(false)

    await act(async () => vi.advanceTimersByTime(1_000))
    expect(claimSignal?.aborted).toBe(true)
    expect(sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY)).toBe(
      "claim-nonce-1234567890",
    )
  })

  it("fails open and clears the nonce after a definitive claim rejection", async () => {
    fetchMock.mockResolvedValueOnce(
      response({ error: "invalid_body" }, false, 400),
    )
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    const player = makePlayer()

    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={player}
          initiation="manual"
          mediaId="media-1"
          durationSeconds={120}
        />,
      )
      await Promise.resolve()
    })
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
      await Promise.resolve()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sessionStorage.length).toBe(0)
    expect(localStorage.length).toBe(0)
    expect(player.addEventListener).toHaveBeenCalled()
  })

  it("retries an ambiguous committed claim with the same nonce and preserves pending facts", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("response lost after commit"))
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "replayed-episode-capability",
            activeUntil: "2026-08-19T07:00:00.000Z",
            hardUntil: "2026-08-19T09:00:00.000Z",
          },
        }),
      )
      .mockResolvedValue(response({ receipts: [] }))
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    const player = makePlayer()

    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={player}
          initiation="manual"
          mediaId="media-1"
          durationSeconds={120}
        />,
      )
      await Promise.resolve()
    })
    player.paused = false
    player.currentTime = 4
    await act(async () => {
      player.dispatch("playing")
      await Promise.resolve()
    })
    expect(sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY)).toBe(
      "claim-nonce-1234567890",
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
      await Promise.resolve()
      await Promise.resolve()
    })

    const claimBodies = fetchMock.mock.calls
      .slice(0, 2)
      .map(([, init]) => JSON.parse(init.body as string))
    expect(claimBodies).toEqual([
      {
        action: "claim",
        claimNonce: "claim-nonce-1234567890",
        mediaId: "media-1",
      },
      {
        action: "claim",
        claimNonce: "claim-nonce-1234567890",
        mediaId: "media-1",
      },
    ])
    expect(
      sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY),
    ).toBeNull()
    const events = fetchMock.mock.calls.slice(2).flatMap(
      ([, init]) =>
        (
          JSON.parse(init.body as string) as {
            events?: Array<{ kind: string; payload: unknown }>
          }
        ).events ?? [],
    )
    expect(events).toEqual([
      expect.objectContaining({
        kind: "playback_attempt",
        payload: { initiation: "manual" },
      }),
      expect.objectContaining({
        kind: "playback_start",
        payload: { positionSeconds: 4 },
      }),
    ])
  })

  it("bounds ambiguous claim retries while retaining the nonce for later recovery", async () => {
    fetchMock.mockRejectedValue(new TypeError("offline"))
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    const player = makePlayer()

    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={player}
          initiation="manual"
          mediaId="media-1"
          durationSeconds={120}
        />,
      )
      await Promise.resolve()
    })
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
      await vi.advanceTimersByTimeAsync(1_000)
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(sessionStorage.getItem(RECOMMENDATION_TAB_CORRELATION_KEY)).toBe(
      "claim-nonce-1234567890",
    )
  })
})
