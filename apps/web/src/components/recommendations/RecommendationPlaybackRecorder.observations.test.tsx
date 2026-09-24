/** @vitest-environment jsdom */
import { act, StrictMode } from "react"
import type { Root } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { RecommendationPlaybackRecorder } from "./RecommendationPlaybackRecorder"
import { dispatchPlaybackNavigationIntent } from "@/lib/playback-navigation-intent"
import {
  RECOMMENDATION_TAB_CORRELATION_KEY,
  type RecommendationPlaybackEvent,
} from "@/lib/recommendation-contracts"
import {
  acceptedFactsResponse,
  makePlayer,
  response,
  usePlaybackRecorderHarness,
  type RecorderFetchMock,
} from "./RecommendationPlaybackRecorder.test-fixtures"

describe("playback observations", () => {
  let root: Root
  let fetchMock: RecorderFetchMock
  usePlaybackRecorderHarness((harness) => {
    root = harness.root
    fetchMock = harness.fetchMock
  })
  async function mount() {
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(
        JSON.parse(String(init.body)).action === "claim"
          ? response({
              episode: {
                episodeId: "episode-1",
                capability: "test-capability",
                activeUntil: "2026-08-19T07:00:00Z",
                hardUntil: "2026-08-19T09:00:00Z",
              },
            })
          : acceptedFactsResponse(init),
      ),
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
    })
    return player
  }
  function events() {
    const sent = fetchMock.mock.calls.flatMap(
      ([, init]) =>
        (JSON.parse(String(init.body)).events ??
          []) as RecommendationPlaybackEvent[],
    )
    return [...new Map(sent.map((fact) => [fact.eventId, fact])).values()]
  }
  async function pagehide(persisted = false) {
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted }))
      await Promise.resolve()
    })
  }

  it("records a pre-start departure without inventing playback or extra startup requests", async () => {
    await mount()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    await pagehide()
    expect(events().map((fact) => fact.kind)).toEqual([
      "playback_attempt",
      "playback_observation",
      "playback_end",
    ])
    expect(events().at(-1)?.payload).toMatchObject({
      reason: "pagehide",
      completed: false,
    })
    expect(
      events().find((fact) => fact.kind === "playback_observation")?.payload,
    ).toMatchObject({
      version: "playback-observations-v2",
      deviceClass: "unknown",
      networkClass: "unknown",
    })
  })

  it("does not manufacture a departure when duration or initiation props update", async () => {
    const player = await mount()
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
    })
    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={player}
          initiation="automatic"
          mediaId="media-1"
          durationSeconds={150}
        />,
      )
    })
    expect(events().filter((fact) => fact.kind === "playback_end")).toEqual([])
    await pagehide()
    expect(
      events().filter((fact) => fact.kind === "playback_end"),
    ).toHaveLength(1)
  })

  it("keeps elapsed time through a long pause and bounds duplicate buffering signals", async () => {
    const player = await mount()
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
    })
    await vi.advanceTimersByTimeAsync(2000)
    player.paused = true
    await act(async () => {
      player.dispatch("pause")
      player.dispatch("pause")
    })
    await vi.advanceTimersByTimeAsync(60_000)
    await act(async () => {
      for (let i = 0; i < 100; i++) player.dispatch("waiting")
    })
    await pagehide()
    expect(
      events().filter((fact) => fact.kind === "playback_navigation"),
    ).toHaveLength(1)
    expect(
      events().filter((fact) => fact.kind === "playback_qoe"),
    ).toHaveLength(1)
    expect(
      events().find((fact) => fact.kind === "playback_observation")?.payload,
    ).toMatchObject({
      elapsedMilliseconds: 62_000,
      playerState: "buffering",
      navigationCount: 1,
      qoeCount: 1,
    })
  })

  it("preserves bfcache and backgrounding separately from departures", async () => {
    const player = await mount()
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
    })
    await pagehide(true)
    expect(events().some((fact) => fact.kind === "playback_end")).toBe(false)
    expect(
      events()
        .filter((fact) => fact.kind === "playback_navigation")
        .at(-1)?.payload,
    ).toMatchObject({ action: "bfcache_suspend", cause: "unknown" })
    await act(async () => {
      root.render(null)
    })
    expect(events().some((fact) => fact.kind === "playback_end")).toBe(false)
  })

  it("observes pre-start bfcache suspension without turning it into a departure", async () => {
    await mount()
    await pagehide(true)
    expect(events().map((fact) => fact.kind)).toEqual([
      "playback_attempt",
      "playback_navigation",
    ])
    await act(async () => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      )
    })
    await pagehide()
    expect(
      events()
        .filter((fact) => fact.kind === "playback_navigation")
        .map((fact) => fact.payload),
    ).toEqual([
      expect.objectContaining({ action: "bfcache_suspend", cause: "unknown" }),
      expect.objectContaining({ action: "bfcache_resume", cause: "unknown" }),
    ])
  })

  it("captures backward seek from the last observed position when the browser already changed currentTime", async () => {
    const player = await mount()
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
    })
    player.currentTime = 20
    await act(async () => {
      player.dispatch("timeupdate")
    })
    player.currentTime = 0
    await act(async () => {
      player.dispatch("seeking")
      player.dispatch("seeked")
    })
    expect(
      events().find((fact) => fact.kind === "playback_seek")?.payload,
    ).toEqual({ fromSeconds: 20, toSeconds: 0 })
  })

  it("records a startup failure separately and emits no departure afterward", async () => {
    const player = await mount()
    await act(async () => {
      player.dispatch("error")
    })
    await pagehide()
    expect(events().map((fact) => fact.kind)).toEqual([
      "playback_attempt",
      "playback_qoe",
      "playback_observation",
      "playback_error",
    ])
    expect(
      events().find((fact) => fact.kind === "playback_qoe")?.payload,
    ).toMatchObject({ action: "media_error", severity: "unknown" })
  })

  it("marks exposed decode errors fatal while preserving other error severity as unknown", async () => {
    const player = await mount()
    Object.assign(player, { error: { code: 3 } })
    await act(async () => {
      player.dispatch("error")
    })
    expect(
      events().find((fact) => fact.kind === "playback_qoe")?.payload,
    ).toMatchObject({ action: "media_error", severity: "fatal" })
  })

  it("marks a delayed start as QoE timeout without ending playback", async () => {
    const player = await mount()
    await act(async () => {
      player.dispatch("play")
    })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(events().filter((fact) => fact.kind === "playback_qoe")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ action: "startup_timeout" }),
      }),
    ])
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
    })
    expect(
      events().filter((fact) => fact.kind === "playback_start"),
    ).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(
      events().filter(
        (fact) =>
          fact.kind === "playback_qoe" &&
          fact.payload.action === "startup_timeout",
      ),
    ).toHaveLength(1)
  })

  it("records startup timeout when the browser never emits play", async () => {
    await mount()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(events().map((fact) => fact.kind)).toEqual([
      "playback_attempt",
      "playback_qoe",
    ])
    await pagehide()
    expect(
      events().find((fact) => fact.kind === "playback_observation")?.payload,
    ).toMatchObject({ qoeCount: 1, startObserved: false })
  })

  it("does not charge bfcache suspension to the startup timeout", async () => {
    await mount()
    await vi.advanceTimersByTimeAsync(5_000)
    await pagehide(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(
      events().filter(
        (fact) =>
          fact.kind === "playback_qoe" &&
          fact.payload.action === "startup_timeout",
      ),
    ).toHaveLength(0)
    await act(async () => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      )
    })
    await vi.advanceTimersByTimeAsync(9_999)
    expect(
      events().filter(
        (fact) =>
          fact.kind === "playback_qoe" &&
          fact.payload.action === "startup_timeout",
      ),
    ).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(
      events().filter(
        (fact) =>
          fact.kind === "playback_qoe" &&
          fact.payload.action === "startup_timeout",
      ),
    ).toHaveLength(1)
  })

  it("does not charge a voluntary pre-start pause to startup timeout", async () => {
    const player = await mount()
    await act(async () => player.dispatch("play"))
    await vi.advanceTimersByTimeAsync(5_000)
    player.paused = true
    await act(async () => player.dispatch("pause"))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(
      events().filter(
        (fact) =>
          fact.kind === "playback_qoe" &&
          fact.payload.action === "startup_timeout",
      ),
    ).toHaveLength(0)
    player.paused = false
    await act(async () => player.dispatch("play"))
    await vi.advanceTimersByTimeAsync(9_999)
    expect(
      events().filter(
        (fact) =>
          fact.kind === "playback_qoe" &&
          fact.payload.action === "startup_timeout",
      ),
    ).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(
      events().filter(
        (fact) =>
          fact.kind === "playback_qoe" &&
          fact.payload.action === "startup_timeout",
      ),
    ).toHaveLength(1)
  })

  it("keeps a voluntary pre-start pause suspended across visibility and bfcache", async () => {
    const player = await mount()
    await act(async () => player.dispatch("play"))
    await vi.advanceTimersByTimeAsync(5_000)
    player.paused = true
    await act(async () => player.dispatch("pause"))
    const visibility = vi.spyOn(document, "visibilityState", "get")
    try {
      visibility.mockReturnValue("hidden")
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      )
      visibility.mockReturnValue("visible")
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      )
      await pagehide(true)
      await act(async () =>
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        ),
      )
      await vi.advanceTimersByTimeAsync(30_000)
      expect(
        events().filter(
          (fact) =>
            fact.kind === "playback_qoe" &&
            fact.payload.action === "startup_timeout",
        ),
      ).toHaveLength(0)
      player.paused = false
      await act(async () => player.dispatch("play"))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(
        events().filter(
          (fact) =>
            fact.kind === "playback_qoe" &&
            fact.payload.action === "startup_timeout",
        ),
      ).toHaveLength(1)
    } finally {
      visibility.mockRestore()
    }
  })

  it("records only explicit skip and pause causes as user intent", async () => {
    const player = await mount()
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
      dispatchPlaybackNavigationIntent({
        mediaId: "other",
        action: "manual_skip",
      })
      dispatchPlaybackNavigationIntent({
        mediaId: "media-1",
        action: "pause_intent",
        cause: "user",
      })
      player.paused = true
      player.dispatch("pause")
      dispatchPlaybackNavigationIntent({
        mediaId: "media-1",
        action: "manual_skip",
      })
    })
    await pagehide()
    expect(
      events()
        .filter((fact) => fact.kind === "playback_navigation")
        .map((fact) => fact.payload),
    ).toEqual([
      expect.objectContaining({ action: "pause", cause: "user" }),
      expect.objectContaining({ action: "manual_skip", cause: "user" }),
    ])
  })

  it("keeps a pause during hidden visibility unknown without explicit system provenance", async () => {
    const player = await mount()
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
    })
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden")
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"))
      player.paused = true
      player.dispatch("pause")
    })
    expect(
      events().filter(
        (fact) =>
          fact.kind === "playback_navigation" &&
          fact.payload.action === "pause",
      )[0]?.payload,
    ).toMatchObject({ cause: "unknown" })
    visibility.mockRestore()
  })

  it("records the automatic first start as an autoplay transition", async () => {
    const player = await mount()
    await act(async () => {
      root.render(
        <RecommendationPlaybackRecorder
          player={player}
          initiation="automatic"
          mediaId="media-1"
          durationSeconds={120}
        />,
      )
    })
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
    })
    expect(
      events()
        .filter((fact) => fact.kind === "playback_navigation")
        .map((fact) => fact.payload),
    ).toEqual([
      expect.objectContaining({
        action: "autoplay_transition",
        cause: "system",
      }),
    ])
  })
  it("does not finalize a paused manual attempt during StrictMode setup replay", async () => {
    const player = await mount()
    await act(async () => {
      root.render(null)
    })
    fetchMock.mockClear()
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    await act(async () => {
      root.render(
        <StrictMode>
          <RecommendationPlaybackRecorder
            player={player}
            initiation="manual"
            mediaId="media-2"
          />
        </StrictMode>,
      )
    })
    expect(events().some((fact) => fact.kind === "playback_end")).toBe(false)
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
    })
    expect(
      events().filter((fact) => fact.kind === "playback_start"),
    ).toHaveLength(1)
  })

  it("closes buffering on pause instead of charging the later pause to buffering", async () => {
    const player = await mount()
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
      player.dispatch("waiting")
    })
    await vi.advanceTimersByTimeAsync(1000)
    player.paused = true
    await act(async () => {
      player.dispatch("pause")
    })
    await vi.advanceTimersByTimeAsync(60_000)
    player.paused = false
    await act(async () => {
      player.dispatch("playing")
    })
    await pagehide()
    expect(
      events()
        .filter((fact) => fact.kind === "playback_qoe")
        .map((fact) => fact.payload),
    ).toEqual([
      expect.objectContaining({ action: "waiting" }),
      expect.objectContaining({ action: "buffering_end" }),
    ])
    expect(
      events()
        .filter((fact) => fact.kind === "playback_navigation")
        .map((fact) => fact.payload),
    ).toEqual([
      expect.objectContaining({ action: "pause" }),
      expect.objectContaining({ action: "resume" }),
    ])
    const qoe = events().filter((fact) => fact.kind === "playback_qoe")
    expect(
      Date.parse(qoe[1]!.occurredAt) - Date.parse(qoe[0]!.occurredAt),
    ).toBe(1000)
  })

  it.each(["playback_request_invalid", "invalid_body"])(
    "preserves immutable baseline facts after an ambiguous commit then %s schema rejection",
    async (errorCode) => {
      const player = await mount()
      const batches: RecommendationPlaybackEvent[][] = []
      fetchMock.mockImplementation((_url, init) => {
        const body = JSON.parse(String(init.body))
        if (body.action !== "facts") return Promise.resolve(response({}))
        batches.push(body.events)
        if (batches.length === 1)
          return Promise.reject(
            new Error("response lost after newer Admin committed"),
          )
        if (batches.length === 2)
          return Promise.resolve(response({ error: errorCode }, false, 400))
        return Promise.resolve(acceptedFactsResponse(init))
      })
      player.paused = false
      await act(async () => {
        player.dispatch("playing")
        player.dispatch("waiting")
        await Promise.resolve()
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_250)
      })
      const baseline = batches[0]!.filter(
        (fact) =>
          ![
            "playback_navigation",
            "playback_qoe",
            "playback_observation",
          ].includes(fact.kind),
      )
      expect(batches[2]).toEqual(baseline)
      expect(batches[2]!.map((fact) => fact.kind)).toEqual([
        "playback_attempt",
        "playback_start",
      ])
      expect(batches[2]![0]!.payload).toEqual({ initiation: "manual" })
      await pagehide()
      expect(
        batches
          .slice(2)
          .flat()
          .some((fact) => fact.kind === "playback_observation"),
      ).toBe(false)
      expect(
        batches.flat().find((fact) => fact.kind === "playback_end")?.payload,
      ).toEqual({
        reason: "pagehide",
        positionSeconds: 0,
        durationSeconds: 120,
        progress: 0,
        completed: false,
      })
    },
  )
})
