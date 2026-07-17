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

    await act(async () => {
      player.currentTime = 90
      player.dispatch("timeupdate")
    })
    expect(recordMeaningfulWatchEventMock).toHaveBeenCalledTimes(1)
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
