/** @vitest-environment jsdom */
import { act, StrictMode } from "react"
import type { Root } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { RecommendationPlaybackRecorder } from "./RecommendationPlaybackRecorder"
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
      "playback_observation",
      "playback_error",
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
