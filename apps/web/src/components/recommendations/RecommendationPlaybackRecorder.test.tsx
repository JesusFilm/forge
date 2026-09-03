/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import type { Root } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"

import { RecommendationPlaybackRecorder } from "./RecommendationPlaybackRecorder"
import {
  RECOMMENDATION_TAB_CORRELATION_KEY,
  type RecommendationPlaybackEvent,
} from "@/lib/recommendation-contracts"
import {
  deferred,
  makePlayer,
  response,
  type RecorderFetchMock,
  usePlaybackRecorderHarness,
} from "./RecommendationPlaybackRecorder.test-fixtures"

describe("RecommendationPlaybackRecorder", () => {
  let root: Root
  let fetchMock: RecorderFetchMock

  usePlaybackRecorderHarness((harness) => {
    root = harness.root
    fetchMock = harness.fetchMock
  })

  it("records a media error after an attempt even before playback starts", async () => {
    fetchMock.mockResolvedValue(
      response({
        episode: {
          episodeId: "episode-1",
          capability: "episode-capability-secret",
          activeUntil: "2026-08-19T07:00:00.000Z",
          hardUntil: "2026-08-19T09:00:00.000Z",
        },
        receipts: [],
      }),
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
    await act(async () => {
      player.dispatch("play")
      player.dispatch("error")
      await Promise.resolve()
      await Promise.resolve()
    })

    const events = fetchMock.mock.calls.slice(1).flatMap(
      ([, init]) =>
        (
          JSON.parse(String((init as RequestInit).body)) as {
            events?: Array<{ kind: string }>
          }
        ).events ?? [],
    )
    expect(events.map((event) => event.kind)).toEqual([
      "playback_attempt",
      "playback_error",
    ])
    expect(events.map((event) => event.kind)).not.toContain("playback_start")
  })

  it("ignores preview playback and flushes one attempt/start when playing wins the claim race", async () => {
    const claim = deferred<Response>()
    fetchMock.mockReturnValueOnce(claim.promise)
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    const player = makePlayer()

    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={player}
          initiation={null}
          mediaId="media-1"
          durationSeconds={120}
        />,
      )
    })
    player.muted = true
    player.paused = false
    await act(async () => player.dispatch("playing"))

    player.currentTime = 2
    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={player}
          initiation="manual"
          mediaId="media-1"
          durationSeconds={120}
        />,
      )
    })
    player.muted = false
    await act(async () => {
      player.dispatch("playing")
      player.dispatch("playing")
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValue(response({ receipts: [] }))
    await act(async () => {
      claim.resolve(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
            activeUntil: "2026-08-19T07:00:00.000Z",
            hardUntil: "2026-08-19T09:00:00.000Z",
          },
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    const factBodies = fetchMock.mock.calls
      .slice(1)
      .map(([, init]) => JSON.parse(init.body as string))
    const events = factBodies.flatMap((body) => body.events)
    expect(events.filter((event) => event.kind === "playback_attempt")).toEqual(
      [expect.objectContaining({ payload: { initiation: "manual" } })],
    )
    expect(events.filter((event) => event.kind === "playback_start")).toEqual([
      expect.objectContaining({ payload: { positionSeconds: 2 } }),
    ])
    expect(JSON.stringify(factBodies)).toContain("episode-capability-secret")
    expect(document.documentElement.innerHTML).not.toContain(
      "episode-capability-secret",
    )
    expect(localStorage.length).toBe(0)
  })

  it("records bounded progress, seeks, complete active time, and one ended terminal", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
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
    player.currentTime = 1
    await act(async () => player.dispatch("playing"))
    vi.advanceTimersByTime(12_000)
    player.currentTime = 13
    await act(async () => player.dispatch("timeupdate"))
    player.currentTime = 50
    await act(async () => {
      player.dispatch("seeking")
      player.currentTime = 70
      player.dispatch("seeked")
    })
    vi.advanceTimersByTime(4_000)
    player.currentTime = 120
    await act(async () => {
      player.dispatch("ended")
      player.dispatch("ended")
      await Promise.resolve()
    })

    const events = fetchMock.mock.calls
      .slice(1)
      .flatMap(([, init]) => JSON.parse(init.body as string).events)
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "playback_progress",
        payload: expect.objectContaining({
          positionSeconds: 13,
          durationSeconds: 120,
          wallElapsedMilliseconds: 12_000,
        }),
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "playback_seek",
        payload: { fromSeconds: 50, toSeconds: 70 },
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "playback_active_visible_playing",
        payload: expect.objectContaining({
          activeMilliseconds: 16_000,
          coverage: "complete",
        }),
      }),
    )
    expect(events.filter((event) => event.kind === "playback_end")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          reason: "ended",
          completed: true,
          positionSeconds: 120,
        }),
      }),
    ])
    for (const [, init] of fetchMock.mock.calls.slice(1)) {
      const body = init.body as string
      expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
        8192,
      )
      expect(JSON.parse(body).events.length).toBeLessThanOrEqual(16)
    }
  })

  it("flushes pagehide promptly and exposes bounded pre-claim overflow without retrying", async () => {
    const claim = deferred<Response>()
    fetchMock.mockReturnValueOnce(claim.promise)
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    const player = makePlayer()
    const overflow = vi.fn()
    window.addEventListener("forge:recommendation-playback-overflow", overflow)

    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={player}
          initiation="manual"
          mediaId="media-1"
          durationSeconds={120}
        />,
      )
    })
    player.paused = false
    await act(async () => player.dispatch("playing"))
    for (let index = 0; index < 24; index += 1) {
      player.currentTime = index
      player.dispatch("seeking")
      player.currentTime = index + 1
      player.dispatch("seeked")
    }
    await act(async () => window.dispatchEvent(new Event("pagehide")))

    expect(overflow).toHaveBeenCalled()
    fetchMock.mockResolvedValue(response({ receipts: [] }))
    await act(async () => {
      claim.resolve(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
            activeUntil: "2026-08-19T07:00:00.000Z",
            hardUntil: "2026-08-19T09:00:00.000Z",
          },
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    const factCalls = fetchMock.mock.calls.slice(1)
    const events = factCalls.flatMap(
      ([, init]) => JSON.parse(init.body as string).events,
    )
    expect(events.length).toBeLessThanOrEqual(16)
    expect(
      events.filter((event) => event.kind === "playback_end"),
    ).toHaveLength(1)
    expect(
      events.find((event) => event.kind === "playback_end")?.payload.reason,
    ).toBe("pagehide")
    expect(factCalls.every(([, init]) => init.keepalive === true)).toBe(true)
    window.removeEventListener(
      "forge:recommendation-playback-overflow",
      overflow,
    )
  })

  it("pauses active measurement across BFCache and resumes without ending the episode", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
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
    await act(async () => player.dispatch("playing"))
    await act(async () => vi.advanceTimersByTimeAsync(5_000))
    const pagehide = new Event("pagehide")
    Object.defineProperty(pagehide, "persisted", { value: true })
    await act(async () => window.dispatchEvent(pagehide))
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    const pageshow = new Event("pageshow")
    Object.defineProperty(pageshow, "persisted", { value: true })
    await act(async () => window.dispatchEvent(pageshow))
    await act(async () => vi.advanceTimersByTimeAsync(7_000))
    await act(async () => player.dispatch("pause"))

    const events = fetchMock.mock.calls.slice(1).flatMap(
      ([, init]) =>
        (
          JSON.parse(init.body as string) as {
            events?: RecommendationPlaybackEvent[]
          }
        ).events ?? [],
    )
    expect(
      events
        .filter((event) => event.kind === "playback_active_visible_playing")
        .reduce((total, event) => total + event.payload.activeMilliseconds, 0),
    ).toBe(12_000)
    expect(events.some((event) => event.kind === "playback_end")).toBe(false)
  })

  it("keeps automatic initiation separate and marks unavailable player-state coverage partial", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
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
    Object.defineProperty(player, "paused", {
      configurable: true,
      value: undefined,
    })

    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={player}
          initiation="automatic"
          mediaId="media-1"
          durationSeconds={120}
        />,
      )
      await Promise.resolve()
    })
    await act(async () => player.dispatch("playing"))
    vi.advanceTimersByTime(1_000)
    await act(async () => window.dispatchEvent(new Event("pagehide")))
    await act(async () => await Promise.resolve())

    const events = fetchMock.mock.calls
      .slice(1)
      .flatMap(([, init]) => JSON.parse(init.body as string).events)
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "playback_attempt",
        payload: { initiation: "automatic" },
      }),
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "playback_active_visible_playing",
        payload: {
          activeMilliseconds: 1_000,
          coverage: "partial",
          missingReason: "player_state_unavailable",
        },
      }),
    )
  })

  it("serializes fact batches so server sequence cannot invert chronology", async () => {
    const firstFacts = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
            activeUntil: "2026-08-19T07:00:00.000Z",
            hardUntil: "2026-08-19T09:00:00.000Z",
          },
        }),
      )
      .mockReturnValueOnce(firstFacts.promise)
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
    await act(async () => {
      player.dispatch("playing")
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    for (let index = 0; index < 20; index += 1) {
      player.currentTime = index
      player.dispatch("seeking")
      player.currentTime = index + 1
      player.dispatch("seeked")
    }
    await act(async () => await Promise.resolve())
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      firstFacts.resolve(response({ receipts: [] }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2)
  })

  it("does not count paused time when player-state coverage is partial", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
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
    Object.defineProperty(player, "paused", {
      configurable: true,
      value: undefined,
    })

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
    await act(async () => player.dispatch("playing"))
    vi.advanceTimersByTime(1_000)
    await act(async () => player.dispatch("pause"))
    vi.advanceTimersByTime(5_000)
    await act(async () => player.dispatch("playing"))
    vi.advanceTimersByTime(1_000)
    await act(async () => window.dispatchEvent(new Event("pagehide")))
    await act(async () => await Promise.resolve())

    const activeMilliseconds = fetchMock.mock.calls
      .slice(1)
      .flatMap(([, init]) => JSON.parse(init.body as string).events)
      .filter((event) => event.kind === "playback_active_visible_playing")
      .reduce((total, event) => total + event.payload.activeMilliseconds, 0)
    expect(activeMilliseconds).toBe(2_000)
  })

  it("does not count waiting or stalled time as active playback", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
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
    await act(async () => player.dispatch("playing"))
    vi.advanceTimersByTime(1_000)
    await act(async () => player.dispatch("waiting"))
    vi.advanceTimersByTime(5_000)
    await act(async () => player.dispatch("playing"))
    vi.advanceTimersByTime(1_000)
    await act(async () => player.dispatch("stalled"))
    vi.advanceTimersByTime(5_000)
    await act(async () => player.dispatch("playing"))
    vi.advanceTimersByTime(1_000)
    await act(async () => window.dispatchEvent(new Event("pagehide")))
    await act(async () => await Promise.resolve())

    const activeMilliseconds = fetchMock.mock.calls
      .slice(1)
      .flatMap(([, init]) => JSON.parse(init.body as string).events)
      .filter((fact) => fact.kind === "playback_active_visible_playing")
      .reduce((total, fact) => total + fact.payload.activeMilliseconds, 0)
    expect(activeMilliseconds).toBe(3_000)
  })

  it("excludes hidden time and resumes the same episode when visible again", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
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
    let visibility: DocumentVisibilityState = "visible"
    const visibilitySpy = vi
      .spyOn(document, "visibilityState", "get")
      .mockImplementation(() => visibility)

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
    await act(async () => player.dispatch("playing"))
    vi.advanceTimersByTime(2_000)
    visibility = "hidden"
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    vi.advanceTimersByTime(20_000)
    visibility = "visible"
    await act(async () => document.dispatchEvent(new Event("visibilitychange")))
    vi.advanceTimersByTime(3_000)
    await act(async () => window.dispatchEvent(new Event("pagehide")))
    await act(async () => await Promise.resolve())
    visibilitySpy.mockRestore()

    const events = fetchMock.mock.calls
      .slice(1)
      .flatMap(([, init]) => JSON.parse(init.body as string).events)
    const activeMilliseconds = events
      .filter((fact) => fact.kind === "playback_active_visible_playing")
      .reduce((total, fact) => total + fact.payload.activeMilliseconds, 0)
    expect(activeMilliseconds).toBe(5_000)
    expect(events.filter((fact) => fact.kind === "playback_end")).toHaveLength(
      1,
    )
  })

  it("timestamps bounded active chunks as adjacent intervals", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
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
          durationSeconds={180}
        />,
      )
      await Promise.resolve()
    })
    player.paused = false
    await act(async () => player.dispatch("playing"))
    vi.advanceTimersByTime(125_000)
    await act(async () => player.dispatch("pause"))
    await act(async () => await Promise.resolve())

    const activeFacts = fetchMock.mock.calls
      .slice(1)
      .flatMap(([, init]) => JSON.parse(init.body as string).events)
      .filter((fact) => fact.kind === "playback_active_visible_playing")
    expect(
      activeFacts.map((fact) => ({
        activeMilliseconds: fact.payload.activeMilliseconds,
        occurredAt: fact.occurredAt,
      })),
    ).toEqual([
      {
        activeMilliseconds: 60_000,
        occurredAt: "2026-08-19T03:01:00.000Z",
      },
      {
        activeMilliseconds: 60_000,
        occurredAt: "2026-08-19T03:02:00.000Z",
      },
      {
        activeMilliseconds: 5_000,
        occurredAt: "2026-08-19T03:02:05.000Z",
      },
    ])
  })

  it("caps progress facts at the server per-kind budget", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
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
          durationSeconds={7_200}
        />,
      )
      await Promise.resolve()
    })
    player.paused = false
    await act(async () => player.dispatch("playing"))
    await act(async () => {
      for (let index = 1; index <= 70; index += 1) {
        vi.advanceTimersByTime(10_000)
        player.currentTime = index * 10
        player.dispatch("timeupdate")
      }
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => window.dispatchEvent(new Event("pagehide")))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const events = fetchMock.mock.calls
      .slice(1)
      .flatMap(([, init]) => JSON.parse(init.body as string).events)
    expect(
      events.filter((fact) => fact.kind === "playback_progress"),
    ).toHaveLength(64)
  })

  it("starts a keepalive terminal send even when an earlier batch is stalled", async () => {
    const firstFacts = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
            activeUntil: "2026-08-19T07:00:00.000Z",
            hardUntil: "2026-08-19T09:00:00.000Z",
          },
        }),
      )
      .mockReturnValueOnce(firstFacts.promise)
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
    await act(async () => {
      player.dispatch("playing")
      await Promise.resolve()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => window.dispatchEvent(new Event("pagehide")))
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const terminal = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)
    expect(terminal.events).toEqual([
      expect.objectContaining({
        kind: "playback_end",
        payload: expect.objectContaining({ reason: "pagehide" }),
      }),
    ])
    expect(fetchMock.mock.calls[2]?.[1]?.keepalive).toBe(true)

    firstFacts.resolve(response({ receipts: [] }))
  })

  it("retains and retries terminal truth when the earlier serialized drain fails", async () => {
    const firstFacts = deferred<Response>()
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
            activeUntil: "2026-08-19T07:00:00.000Z",
            hardUntil: "2026-08-19T09:00:00.000Z",
          },
        }),
      )
      .mockReturnValueOnce(firstFacts.promise)
      .mockResolvedValueOnce(response({ receipts: [] }))
      .mockResolvedValueOnce(response({ error: "still unavailable" }, false))
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
    await act(async () => {
      player.dispatch("playing")
      await Promise.resolve()
    })
    const originalBatch = JSON.parse(
      fetchMock.mock.calls[1]?.[1]?.body as string,
    ).events

    await act(async () => window.dispatchEvent(new Event("pagehide")))
    const directTerminal = JSON.parse(
      fetchMock.mock.calls[2]?.[1]?.body as string,
    ).events[0]

    await act(async () => {
      firstFacts.reject(new Error("network failed"))
      await vi.advanceTimersByTimeAsync(100)
      await Promise.resolve()
      await Promise.resolve()
    })

    const retriedEvents = JSON.parse(
      fetchMock.mock.calls.at(-1)?.[1]?.body as string,
    ).events
    expect(retriedEvents).toEqual(
      expect.arrayContaining([
        ...originalBatch,
        expect.objectContaining({
          eventId: directTerminal.eventId,
          kind: "playback_end",
        }),
      ]),
    )
  })

  it("retries a rejected fact batch with the exact same event payloads", async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          episode: {
            episodeId: "episode-1",
            capability: "episode-capability-secret",
            activeUntil: "2026-08-19T07:00:00.000Z",
            hardUntil: "2026-08-19T09:00:00.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(response({ error: "temporary" }, false))
      .mockResolvedValueOnce(response({ receipts: [] }))
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
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      fetchMock.mock.calls[1]?.[1]?.body,
    )
  })
})
