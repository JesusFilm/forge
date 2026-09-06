import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, vi } from "vitest"
import type { MuxPlayerRef } from "@forge/video-player"

type Listener = () => void

export type RecorderFetchMock = ReturnType<typeof vi.fn>

export type PlaybackRecorderHarness = Readonly<{
  root: Root
  fetchMock: RecorderFetchMock
}>

export function makePlayer() {
  const listeners = new Map<string, Set<Listener>>()
  return {
    currentTime: 0,
    duration: 120,
    paused: true,
    muted: false,
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
  } as unknown as MuxPlayerRef & {
    paused: boolean
    muted: boolean
    dispatch(event: string): void
  }
}

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

export const response = (body: unknown, ok = true, status = ok ? 200 : 503) =>
  ({ ok, status, json: vi.fn().mockResolvedValue(body) }) as unknown as Response

export function acceptedFactsResponse(init: RequestInit | undefined): Response {
  const body = JSON.parse(String(init?.body ?? "{}")) as {
    events?: Array<{ eventId: string }>
  }
  return response({
    receipts: (body.events ?? []).map((event, index) => ({
      eventId: event.eventId,
      status: "accepted",
      sequence: index + 1,
    })),
  })
}

/** Register the common jsdom lifecycle while keeping state local to a suite. */
export function usePlaybackRecorderHarness(
  setHarness: (harness: PlaybackRecorderHarness) => void,
): void {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-19T03:00:00.000Z"))
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    window.sessionStorage.clear()
    window.history.replaceState({}, "", "/watch/video.html")
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
    setHarness({ root, fetchMock })
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
      await Promise.resolve()
      await vi.runAllTimersAsync()
      await Promise.resolve()
    })
    container.remove()
    window.sessionStorage.clear()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
}
