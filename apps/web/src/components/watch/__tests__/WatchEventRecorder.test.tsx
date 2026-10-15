/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MuxPlayerRef } from "@forge/video-player"

import { WatchEventRecorder } from "@/components/watch/WatchEventRecorder"
import {
  resetWatchAnalyticsEmitState,
  setWatchAnalyticsFrameScheduler,
} from "@/lib/watch-analytics-contract"

const { recordMeaningfulWatchEventMock, getViewerIdMock, mockEnv } = vi.hoisted(
  () => ({
    recordMeaningfulWatchEventMock: vi.fn(),
    getViewerIdMock: vi.fn(),
    mockEnv: {
      NEXT_PUBLIC_CANONICAL_ORIGIN: "https://www.jesusfilm.org",
      NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2: undefined as boolean | undefined,
    },
  }),
)

vi.mock("@/env", () => ({ env: mockEnv }))

vi.mock("@/lib/watch-event-actions", () => ({
  recordMeaningfulWatchEvent: recordMeaningfulWatchEventMock,
}))

vi.mock("@/lib/viewer-id", () => ({
  getViewerId: getViewerIdMock,
}))

type Listener = () => void

function makePlayer() {
  const listeners = new Map<string, Set<Listener>>()
  return {
    currentTime: 0,
    duration: 120,
    addEventListener: vi.fn((event: string, listener: Listener) => {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
    }),
    removeEventListener: vi.fn((event: string, listener: Listener) => {
      listeners.get(event)?.delete(listener)
    }),
    dispatch(event: string) {
      for (const listener of listeners.get(event) ?? []) listener()
    },
  } as unknown as MuxPlayerRef & { dispatch(event: string): void }
}

describe("WatchEventRecorder", () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.resetAllMocks()
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = undefined
    window.gtag = vi.fn()
    window.localStorage.clear()
    getViewerIdMock.mockReturnValue("viewer-123")
    recordMeaningfulWatchEventMock.mockResolvedValue({
      ok: true,
      recorded: true,
    })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    window.gtag = undefined
    window.localStorage.clear()
  })

  it("records once after meaningful playback", async () => {
    const player = makePlayer()

    await act(async () => {
      root.render(
        <WatchEventRecorder
          playerRef={{ current: player }}
          videoId="video-1"
          videoDubId="dub-1"
          durationSeconds={120}
        />,
      )
    })

    await act(async () => {
      player.currentTime = 10
      player.dispatch("timeupdate")
    })
    expect(recordMeaningfulWatchEventMock).not.toHaveBeenCalled()

    await act(async () => {
      player.currentTime = 30
      player.dispatch("timeupdate")
    })
    await vi.waitFor(() =>
      expect(recordMeaningfulWatchEventMock).toHaveBeenCalledTimes(1),
    )
    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "a_media_progress25",
      expect.objectContaining({
        progress_percent: 25,
        video_dub_id: "dub-1",
        video_id: "video-1",
      }),
    )
    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "video_progress",
      expect.objectContaining({
        position_seconds: 30,
        progress_percent: 25,
        video_dub_id: "dub-1",
        video_id: "video-1",
      }),
    )

    await act(async () => {
      player.currentTime = 90
      player.dispatch("timeupdate")
    })
    expect(recordMeaningfulWatchEventMock).toHaveBeenCalledTimes(1)
    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "a_media_progress50",
      expect.objectContaining({
        progress_percent: 50,
        video_dub_id: "dub-1",
        video_id: "video-1",
      }),
    )
    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "a_media_progress75",
      expect.objectContaining({
        progress_percent: 75,
        video_dub_id: "dub-1",
        video_id: "video-1",
      }),
    )
    expect(
      (window.gtag as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, eventName, params]) =>
          eventName === "a_media_progress25" && params?.progress_percent === 25,
      ),
    ).toHaveLength(1)
  })

  it("reports playback start, pause, and completion with legacy GA names", async () => {
    const player = makePlayer()

    await act(async () => {
      root.render(
        <WatchEventRecorder
          playerRef={{ current: player }}
          videoId="video-1"
          videoDubId="dub-1"
          durationSeconds={120}
        />,
      )
    })

    await act(async () => {
      player.currentTime = 2
      player.dispatch("play")
      player.dispatch("play")
      player.currentTime = 12
      player.dispatch("pause")
      player.currentTime = 120
      player.dispatch("ended")
      player.dispatch("ended")
    })

    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "videostarts",
      expect.objectContaining({
        progress_percent: 0,
        video_dub_id: "dub-1",
        video_id: "video-1",
      }),
    )
    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "videoplay",
      expect.objectContaining({
        video_dub_id: "dub-1",
        video_id: "video-1",
      }),
    )
    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "video_pause",
      expect.objectContaining({
        position_seconds: 12,
        video_dub_id: "dub-1",
        video_id: "video-1",
      }),
    )
    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "videocomplete",
      expect.objectContaining({
        progress_percent: 100,
        video_dub_id: "dub-1",
        video_id: "video-1",
      }),
    )
    expect(
      (window.gtag as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, eventName]) => eventName === "videostarts",
      ),
    ).toHaveLength(1)
    expect(
      (window.gtag as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, eventName]) => eventName === "videoplay",
      ),
    ).toHaveLength(2)
    expect(
      (window.gtag as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, eventName]) => eventName === "videocomplete",
      ),
    ).toHaveLength(1)
  })

  it("reports 10 and 90 percent media milestones once", async () => {
    const player = makePlayer()

    await act(async () => {
      root.render(
        <WatchEventRecorder
          playerRef={{ current: player }}
          videoId="video-1"
          videoDubId="dub-1"
          durationSeconds={120}
        />,
      )
    })

    await act(async () => {
      player.currentTime = 12
      player.dispatch("timeupdate")
      player.dispatch("timeupdate")
      player.currentTime = 108
      player.dispatch("timeupdate")
      player.dispatch("timeupdate")
    })

    expect(
      (window.gtag as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, eventName]) => eventName === "a_media_progress10",
      ),
    ).toHaveLength(1)
    expect(
      (window.gtag as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, eventName]) => eventName === "a_media_progress90",
      ),
    ).toHaveLength(1)
  })

  // v1 CHARACTERIZATION (R11, R12). Freezes the per-identity counts the v2
  // event contract must reproduce for repeated play/timeupdate/ended events,
  // including after a seek backwards and a replay.
  it("keeps v1 start, progress, milestone, and completion counts under repeated events", async () => {
    const player = makePlayer()

    await act(async () => {
      root.render(
        <WatchEventRecorder
          playerRef={{ current: player }}
          videoId="video-1"
          videoDubId="dub-1"
          durationSeconds={120}
        />,
      )
    })

    await act(async () => {
      player.currentTime = 0
      player.dispatch("play")
      // Cross every milestone, then seek backwards and replay across them.
      for (const seconds of [12, 30, 60, 90, 108, 120, 12, 30, 60, 90, 108]) {
        player.currentTime = seconds
        player.dispatch("timeupdate")
        player.dispatch("timeupdate")
      }
      player.dispatch("pause")
      player.dispatch("play")
      player.currentTime = 120
      player.dispatch("ended")
      player.dispatch("ended")
    })

    const gtagMock = window.gtag as unknown as ReturnType<typeof vi.fn>
    const countOf = (eventName: string) =>
      gtagMock.mock.calls.filter(([, name]) => name === eventName).length

    // Once per playback identity.
    expect(countOf("videostarts")).toBe(1)
    expect(countOf("video_progress")).toBe(1)
    expect(countOf("videocomplete")).toBe(1)
    // Once per milestone per identity, surviving seek and replay.
    expect(countOf("a_media_progress10")).toBe(1)
    expect(countOf("a_media_progress25")).toBe(1)
    expect(countOf("a_media_progress50")).toBe(1)
    expect(countOf("a_media_progress75")).toBe(1)
    expect(countOf("a_media_progress90")).toBe(1)
    // Per real transition, not per identity.
    expect(countOf("videoplay")).toBe(2)
    expect(countOf("video_pause")).toBe(1)
  })

  it("queues signed-out playback locally and flushes it after sign-in", async () => {
    const player = makePlayer()
    recordMeaningfulWatchEventMock
      .mockResolvedValueOnce({
        ok: true,
        recorded: false,
        reason: "signed-out",
      })
      .mockResolvedValueOnce({
        ok: true,
        recorded: true,
      })

    await act(async () => {
      root.render(
        <WatchEventRecorder
          playerRef={{ current: player }}
          videoId="video-1"
          videoDubId="dub-1"
          durationSeconds={120}
        />,
      )
    })
    await act(async () => {
      player.currentTime = 30
      player.dispatch("timeupdate")
    })

    await vi.waitFor(() =>
      expect(
        window.localStorage.getItem("forge.watch.pending_events"),
      ).toContain("video-1"),
    )

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    await act(async () => {
      root.render(
        <WatchEventRecorder
          playerRef={{ current: makePlayer() }}
          videoId="video-2"
          videoDubId="dub-2"
          durationSeconds={120}
        />,
      )
    })

    await vi.waitFor(() =>
      expect(
        window.localStorage.getItem("forge.watch.pending_events"),
      ).toBeNull(),
    )
  })

  // v1 CHARACTERIZATION of the terminal pause. Media elements fire `pause`
  // right before `ended`; v1 records it as a real pause. v2 deliberately
  // does not (see the v2 suite) — this pins that v1 is left as shipped.
  it("keeps the v1 terminal pause before completion", async () => {
    const player = makePlayer() as ReturnType<typeof makePlayer> & {
      ended?: boolean
    }

    await act(async () => {
      root.render(
        <WatchEventRecorder
          playerRef={{ current: player }}
          videoId="video-1"
          videoDubId="dub-1"
          durationSeconds={120}
        />,
      )
    })

    await act(async () => {
      player.dispatch("play")
      player.currentTime = 120
      player.ended = true
      player.dispatch("pause")
      player.dispatch("ended")
    })

    const names = (
      window.gtag as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map(([, name]) => name)
    expect(names.filter((name) => name === "video_pause")).toHaveLength(1)
    expect(names.filter((name) => name === "videocomplete")).toHaveLength(1)
    // v1 never carries the v2 contract version.
    for (const [, , params] of (
      window.gtag as unknown as ReturnType<typeof vi.fn>
    ).mock.calls) {
      expect(params).not.toHaveProperty("event_contract_version")
    }
  })
})

// v2 (U4): every assertion is captured at the `window.gtag` spy with the real
// contract, route resolver, and scheduling seam in the path. The flag is ON
// and `window.gtag` is defined in every case, so an absence assertion cannot
// pass because some other gate was closed.
describe("WatchEventRecorder — v2 contract", () => {
  const lumoEpisode = "/watch/lumo-the-gospel-of-john.html/wedding-in-cana.html"
  let container: HTMLDivElement
  let root: Root
  let gtag: ReturnType<typeof vi.fn>
  let frames: Array<() => void>

  function runFrames() {
    act(() => {
      for (const callback of frames.splice(0, frames.length)) callback()
    })
  }

  function events(): Array<[string, Record<string, unknown>]> {
    return gtag.mock.calls
      .filter(([command]) => command === "event")
      .map(([, name, params]) => [
        name as string,
        params as Record<string, unknown>,
      ])
  }

  function countOf(name: string): number {
    return events().filter(([eventName]) => eventName === name).length
  }

  async function renderRecorder(
    player: ReturnType<typeof makePlayer>,
    identity: { videoId: string; videoDubId: string } = {
      videoId: "video-1",
      videoDubId: "dub-1",
    },
    durationSeconds: number | null = 120,
  ) {
    await act(async () => {
      root.render(
        <WatchEventRecorder
          playerRef={{ current: player }}
          videoId={identity.videoId}
          videoDubId={identity.videoDubId}
          durationSeconds={durationSeconds}
        />,
      )
    })
  }

  async function step(run: () => void) {
    await act(async () => {
      run()
    })
    runFrames()
  }

  beforeEach(() => {
    vi.resetAllMocks()
    resetWatchAnalyticsEmitState()
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = true
    gtag = vi.fn()
    window.gtag = gtag
    frames = []
    setWatchAnalyticsFrameScheduler((callback) => {
      frames.push(callback)
    })
    window.history.replaceState({}, "", "/watch/jesus.html")
    window.localStorage.clear()
    getViewerIdMock.mockReturnValue("viewer-123")
    recordMeaningfulWatchEventMock.mockResolvedValue({
      ok: true,
      recorded: true,
    })
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    setWatchAnalyticsFrameScheduler(null)
    window.gtag = undefined
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = undefined
    window.localStorage.clear()
  })

  it("fires start, meaningful progress, each crossed milestone, and completion once per identity with canonical context (AE3)", async () => {
    window.history.replaceState({}, "", lumoEpisode)
    const player = makePlayer()
    await renderRecorder(player)

    await step(() => {
      player.currentTime = 0
      player.dispatch("play")
      // Seek from below 10% straight past 25%: both crossed milestones fire.
      player.currentTime = 36
      player.dispatch("timeupdate")
      // Seek backwards and replay across the same milestones.
      player.currentTime = 6
      player.dispatch("timeupdate")
      player.currentTime = 36
      player.dispatch("timeupdate")
      player.dispatch("timeupdate")
    })

    expect(countOf("videostarts")).toBe(1)
    expect(countOf("a_media_progress10")).toBe(1)
    expect(countOf("a_media_progress25")).toBe(1)
    expect(countOf("a_media_progress50")).toBe(0)
    expect(countOf("video_progress")).toBe(1)

    await step(() => {
      player.currentTime = 120
      player.dispatch("ended")
      player.dispatch("ended")
    })

    expect(countOf("videocomplete")).toBe(1)
    for (const milestone of [10, 25, 50, 75, 90]) {
      expect(countOf(`a_media_progress${milestone}`)).toBe(1)
    }

    // Every player event carries the standalone canonical identity AND the
    // contextual entry form, without the recorder rebuilding path logic.
    for (const [, params] of events()) {
      expect(params).toMatchObject({
        event_contract_version: 2,
        page_path: "/watch/wedding-in-cana.html",
        watch_route_type: "video",
        watch_route_variant: "contextual",
        watch_raw_path: lumoEpisode,
      })
    }
    expect(
      events().find(([name]) => name === "videostarts")?.[1],
    ).toMatchObject({
      watch_position_seconds: 0,
      watch_duration_seconds: 120,
      watch_content_id: "video-1",
      watch_dub_id: "dub-1",
    })
    expect(
      events().find(([name]) => name === "a_media_progress25")?.[1],
    ).toMatchObject({ watch_progress_percent: 25 })
    expect(
      events().find(([name]) => name === "videocomplete")?.[1],
    ).toMatchObject({
      watch_progress_percent: 100,
      watch_duration_seconds: 120,
    })
    // v1 parameter names never appear under v2.
    for (const [, params] of events()) {
      expect(params).not.toHaveProperty("video_id")
      expect(params).not.toHaveProperty("progress_percent")
    }
    // The Admin meaningful-playback action is separate from GA and still
    // records once.
    await vi.waitFor(() =>
      expect(recordMeaningfulWatchEventMock).toHaveBeenCalledTimes(1),
    )
  })

  it("records each real play and pause while start stays once", async () => {
    const player = makePlayer()
    await renderRecorder(player)

    await step(() => {
      player.currentTime = 2
      player.dispatch("play")
      player.currentTime = 12
      player.dispatch("pause")
      player.dispatch("play")
    })

    expect(countOf("videoplay")).toBe(2)
    expect(countOf("video_pause")).toBe(1)
    expect(countOf("videostarts")).toBe(1)
    expect(
      events().find(([name]) => name === "video_pause")?.[1],
    ).toMatchObject({
      watch_position_seconds: 12,
      watch_duration_seconds: 120,
      watch_progress_percent: 10,
    })
  })

  it("does not turn the browser's terminal pause into an analytical pause", async () => {
    const player = makePlayer() as ReturnType<typeof makePlayer> & {
      ended?: boolean
    }
    await renderRecorder(player)

    await step(() => {
      player.dispatch("play")
      player.currentTime = 120
      player.ended = true
      player.dispatch("pause")
      player.dispatch("ended")
    })

    expect(countOf("video_pause")).toBe(0)
    expect(countOf("videocomplete")).toBe(1)
  })

  it("resets identity-scoped guards on a dub swap but not on a same-identity rerender", async () => {
    const player = makePlayer()
    await renderRecorder(player)

    await step(() => {
      player.dispatch("play")
      player.currentTime = 30
      player.dispatch("timeupdate")
    })
    expect(countOf("videostarts")).toBe(1)
    expect(countOf("a_media_progress25")).toBe(1)

    // Same identity, new duration prop: a rerender, not a new playback.
    await renderRecorder(player, undefined, 121)
    await step(() => {
      player.dispatch("play")
      player.dispatch("timeupdate")
    })
    expect(countOf("videostarts")).toBe(1)
    expect(countOf("a_media_progress25")).toBe(1)
    expect(countOf("video_progress")).toBe(1)

    // A different dub is a new playback identity.
    await renderRecorder(player, { videoId: "video-1", videoDubId: "dub-2" })
    await step(() => {
      player.dispatch("play")
      player.dispatch("timeupdate")
    })
    expect(countOf("videostarts")).toBe(2)
    expect(countOf("a_media_progress25")).toBe(2)
    expect(countOf("video_progress")).toBe(2)
    expect(
      events()
        .filter(([name]) => name === "videostarts")
        .map(([, params]) => params.watch_dub_id),
    ).toEqual(["dub-1", "dub-2"])
  })

  it("omits unsafe numeric fields without suppressing a valid event", async () => {
    const player = makePlayer()
    ;(player as unknown as { duration: number }).duration = Number.NaN
    await renderRecorder(player, undefined, null)

    await step(() => {
      player.currentTime = Number.POSITIVE_INFINITY
      player.dispatch("play")
      player.dispatch("pause")
    })

    expect(countOf("videoplay")).toBe(1)
    expect(countOf("videostarts")).toBe(1)
    expect(countOf("video_pause")).toBe(1)
    for (const [, params] of events()) {
      expect(params).not.toHaveProperty("watch_duration_seconds")
      expect(params).not.toHaveProperty("watch_progress_percent")
    }
  })

  it("dispatches nothing on a non-firing timeupdate (R28)", async () => {
    const player = makePlayer()
    await renderRecorder(player)

    await step(() => {
      player.currentTime = 30
      player.dispatch("timeupdate")
    })
    const before = gtag.mock.calls.length

    // Below the next milestone (50%) and past the meaningful threshold: the
    // handler must return early — no queued dispatch, so no frame requested.
    await act(async () => {
      for (const seconds of [31, 32, 40, 50, 59]) {
        player.currentTime = seconds
        player.dispatch("timeupdate")
      }
    })
    expect(frames).toHaveLength(0)
    runFrames()
    expect(gtag.mock.calls.length).toBe(before)
  })

  it("defers player events to the paint yield (R28)", async () => {
    const player = makePlayer()
    await renderRecorder(player)

    await act(async () => {
      player.dispatch("play")
    })
    expect(gtag).not.toHaveBeenCalled()

    runFrames()
    expect(countOf("videoplay")).toBe(1)
    expect(countOf("videostarts")).toBe(1)
  })

  it("emits the v1 wire names and counts again when the flag is off", async () => {
    mockEnv.NEXT_PUBLIC_FORGE_WATCH_GA4_CONTRACT_V2 = false
    const player = makePlayer()
    await renderRecorder(player)

    await act(async () => {
      player.dispatch("play")
      player.currentTime = 30
      player.dispatch("timeupdate")
    })

    // Synchronous, unversioned, legacy parameter names: the v1 path.
    expect(countOf("videoplay")).toBe(1)
    expect(countOf("videostarts")).toBe(1)
    expect(countOf("a_media_progress25")).toBe(1)
    expect(countOf("video_progress")).toBe(1)
    expect(frames).toHaveLength(0)
    for (const [, params] of events()) {
      expect(params).not.toHaveProperty("event_contract_version")
      expect(params).toHaveProperty("video_id", "video-1")
    }
  })
})
