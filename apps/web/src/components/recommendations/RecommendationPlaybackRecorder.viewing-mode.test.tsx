/** @vitest-environment jsdom */
import { act } from "react"
import type { Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { RecommendationPlaybackRecorder } from "./RecommendationPlaybackRecorder"
import {
  acceptedFactsResponse,
  makePlayer,
  response,
  usePlaybackRecorderHarness,
  type RecorderFetchMock,
} from "./RecommendationPlaybackRecorder.test-fixtures"
import {
  RECOMMENDATION_TAB_CORRELATION_KEY,
  type RecommendationPlaybackEvent,
} from "@/lib/recommendation-contracts"

describe("preview viewing mode recording", () => {
  let root: Root
  let fetchMock: RecorderFetchMock
  usePlaybackRecorderHarness((harness) => {
    root = harness.root
    fetchMock = harness.fetchMock
  })
  afterEach(() => vi.restoreAllMocks())

  async function setup() {
    let monotonic = 0
    vi.spyOn(performance, "now").mockImplementation(() => monotonic)
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    sessionStorage.setItem(
      RECOMMENDATION_TAB_CORRELATION_KEY,
      "claim-nonce-1234567890",
    )
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(
        JSON.parse(String(init?.body ?? "{}")).action === "claim"
          ? response({
              episode: {
                episodeId: "episode-1",
                capability: "episode-capability-secret",
                activeUntil: "2026-08-19T07:00:00.000Z",
                hardUntil: "2026-08-19T09:00:00.000Z",
              },
            })
          : acceptedFactsResponse(init),
      ),
    )
    const player = makePlayer()
    Object.assign(player, {
      paused: false,
      muted: true,
      volume: 1,
      readyState: 4,
      playbackRate: 1,
      seeking: false,
    })
    const render = async (
      viewable: boolean,
      initiation: "manual" | null = null,
    ) => {
      await act(async () => {
        root.render(
          <RecommendationPlaybackRecorder
            player={player}
            initiation={initiation}
            mediaId="video"
            durationSeconds={120}
            viewable={viewable}
          />,
        )
        await Promise.resolve()
      })
    }
    await render(true)
    return {
      player,
      render,
      async advance(seconds: number) {
        for (let i = 0; i < seconds; i++) {
          monotonic += 1_000
          player.currentTime += 1
          await act(async () => {
            player.dispatch("timeupdate")
            await Promise.resolve()
            await Promise.resolve()
          })
        }
      },
      events() {
        return fetchMock.mock.calls.flatMap(
          ([, init]) =>
            (
              JSON.parse(String(init?.body ?? "{}")) as {
                events?: RecommendationPlaybackEvent[]
              }
            ).events ?? [],
        )
      },
    }
  }

  it("delivers qualified-duration muted preview evidence without inventing a manual play", async () => {
    const h = await setup()
    await h.advance(30)
    const modes = h
      .events()
      .filter((event) => event.kind === "playback_viewing_mode")
    expect(modes).toHaveLength(3)
    expect(
      modes.reduce((sum, event) => sum + event.payload.activeMilliseconds, 0),
    ).toBe(30_000)
    expect(
      modes.every(
        (event) => event.payload.preview && event.payload.mode === "sound_off",
      ),
    ).toBe(true)
    expect(
      h
        .events()
        .some(
          (event) =>
            event.kind === "playback_attempt" ||
            event.kind === "playback_start",
        ),
    ).toBe(false)
    expect(modes[2]?.occurredAt).toBe("2026-08-19T03:00:30.000Z")
  })

  it("stops credit while covered and separates later sound-on activation", async () => {
    const h = await setup()
    await h.advance(6)
    await h.render(false)
    await h.advance(20)
    await h.render(true, "manual")
    h.player.muted = false
    await act(async () => h.player.dispatch("volumechange"))
    await h.advance(10)
    const modes = h
      .events()
      .filter((event) => event.kind === "playback_viewing_mode")
    expect(
      modes.map((event) => [
        event.payload.mode,
        event.payload.preview,
        event.payload.activeMilliseconds,
      ]),
    ).toEqual([
      ["sound_off", true, 6_000],
      ["sound_on", false, 10_000],
    ])
  })

  it("retains a preview media error so short failed playback cannot penalize candidate performance", async () => {
    const h = await setup()
    await h.advance(3)
    await act(async () => {
      h.player.dispatch("error")
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(h.events().some((event) => event.kind === "playback_error")).toBe(
      true,
    )
    expect(h.events().some((event) => event.kind === "playback_attempt")).toBe(
      false,
    )
  })
})
