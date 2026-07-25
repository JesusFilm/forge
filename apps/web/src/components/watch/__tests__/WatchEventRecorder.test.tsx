/**
 * @vitest-environment jsdom
 */

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { MuxPlayerRef } from "@forge/video-player"

import { WatchEventRecorder } from "@/components/watch/WatchEventRecorder"

const { recordMeaningfulWatchEventMock, getViewerIdMock } = vi.hoisted(() => ({
  recordMeaningfulWatchEventMock: vi.fn(),
  getViewerIdMock: vi.fn(),
}))

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
})
