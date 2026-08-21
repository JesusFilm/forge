/**
 * Behavioural coverage for the SDUI autostart gate.
 *
 * Neither SDUI player route autostarted, while every other surface in the app
 * started behind a spinner, so the same card behaved differently depending on
 * which shelf it came from. These tests drive the real hook against a fake
 * player; the anti-strand case is the one that matters most, because a veil
 * with no release is the documented failure mode
 * (docs/solutions/logic-errors/mobile-watch-autostart-veil-gate-missing-release-path.md).
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package (see apps/mobile/CLAUDE.md "Component render
 * tests").
 */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})

import { act } from "react"
import type React from "react"
import { AppState } from "react-native"

import {
  AUTOSTART_VEIL_TIMEOUT_MS,
  useAutostartPlayback,
} from "../useAutostartPlayback"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type Listener = (payload?: unknown) => void

/** Minimal stand-in for the expo-video surface this hook touches. */
function makeFakePlayer(opts?: { status?: string; playThrows?: boolean }) {
  const listeners: Record<string, Listener[]> = {}
  const state = {
    plays: 0,
    removed: 0,
    status: opts?.status ?? "idle",
  }
  const player = {
    get status() {
      return state.status
    },
    play() {
      if (opts?.playThrows) throw new Error("released")
      state.plays += 1
    },
    addListener(event: string, cb: Listener) {
      ;(listeners[event] ??= []).push(cb)
      return {
        remove() {
          state.removed += 1
          listeners[event] = (listeners[event] ?? []).filter((l) => l !== cb)
        },
      }
    },
  }
  const emit = (event: string, payload?: unknown) => {
    for (const l of [...(listeners[event] ?? [])]) l(payload)
  }
  return { player, state, emit }
}

type Result = { hasStarted: boolean; awaitingAutostart: boolean }

/** Renders the hook and exposes its latest return value. */
function renderHook(
  player: ReturnType<typeof makeFakePlayer>["player"],
  initial: { sourceUrl: string | null; isPlaying: boolean },
) {
  const seen: Result[] = []
  function Harness({
    sourceUrl,
    isPlaying,
  }: {
    sourceUrl: string | null
    isPlaying: boolean
  }) {
    seen.push(
      useAutostartPlayback(
        player as unknown as Parameters<typeof useAutostartPlayback>[0],
        sourceUrl,
        isPlaying,
      ),
    )
    return null
  }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(
      (<Harness {...initial} />) as unknown as React.ReactElement,
    )
  })
  return {
    latest: () => seen[seen.length - 1],
    rerender: (next: { sourceUrl: string | null; isPlaying: boolean }) =>
      act(() => {
        renderer.update(
          (<Harness {...next} />) as unknown as React.ReactElement,
        )
      }),
    unmount: () => act(() => renderer.unmount()),
  }
}

describe("useAutostartPlayback", () => {
  const realAppState = AppState.currentState

  beforeEach(() => {
    ;(AppState as { currentState: string }).currentState = "active"
  })

  afterEach(() => {
    ;(AppState as { currentState: string }).currentState = realAppState
    jest.useRealTimers()
  })

  it("starts playback when the source loads", () => {
    const { player, state, emit } = makeFakePlayer()
    renderHook(player, { sourceUrl: "https://a/x.m3u8", isPlaying: false })

    expect(state.plays).toBe(0)
    act(() => emit("sourceLoad"))
    expect(state.plays).toBe(1)
  })

  it("never starts audio the viewer cannot see", () => {
    ;(AppState as { currentState: string }).currentState = "background"
    const { player, state, emit } = makeFakePlayer()
    renderHook(player, { sourceUrl: "https://a/x.m3u8", isPlaying: false })

    act(() => emit("sourceLoad"))
    expect(state.plays).toBe(0)
  })

  it("starts at most once for one source", () => {
    const { player, state, emit } = makeFakePlayer()
    renderHook(player, { sourceUrl: "https://a/x.m3u8", isPlaying: false })

    act(() => emit("sourceLoad"))
    act(() => emit("sourceLoad"))
    expect(state.plays).toBe(1)
  })

  it("stays unlatched when play throws, so a later load can still start", () => {
    const { player, emit } = makeFakePlayer({ playThrows: true })
    const hook = renderHook(player, {
      sourceUrl: "https://a/x.m3u8",
      isPlaying: false,
    })

    act(() => emit("sourceLoad"))
    // Still awaiting: nothing started, nothing errored.
    expect(hook.latest().awaitingAutostart).toBe(true)
  })

  it("shows the veil until playback actually starts", () => {
    const { player } = makeFakePlayer()
    const hook = renderHook(player, {
      sourceUrl: "https://a/x.m3u8",
      isPlaying: false,
    })

    expect(hook.latest()).toEqual({
      hasStarted: false,
      awaitingAutostart: true,
    })

    hook.rerender({ sourceUrl: "https://a/x.m3u8", isPlaying: true })
    expect(hook.latest()).toEqual({
      hasStarted: true,
      awaitingAutostart: false,
    })
  })

  it("never shows the veil without a source", () => {
    const { player } = makeFakePlayer()
    const hook = renderHook(player, { sourceUrl: null, isPlaying: false })
    expect(hook.latest().awaitingAutostart).toBe(false)
  })

  it("releases the veil when the source errors", () => {
    const { player, emit } = makeFakePlayer()
    const hook = renderHook(player, {
      sourceUrl: "https://a/x.m3u8",
      isPlaying: false,
    })

    act(() => emit("statusChange", { status: "error" }))
    expect(hook.latest().awaitingAutostart).toBe(false)
    expect(hook.latest().hasStarted).toBe(false)
  })

  it("seeds the stop condition from a source that already failed", () => {
    const { player } = makeFakePlayer({ status: "error" })
    const hook = renderHook(player, {
      sourceUrl: "https://a/x.m3u8",
      isPlaying: false,
    })
    expect(hook.latest().awaitingAutostart).toBe(false)
  })

  // The anti-strand case: a load that neither starts nor errors must still
  // hand the viewer back their controls.
  it("releases the veil for a load that neither starts nor errors", () => {
    jest.useFakeTimers()
    const { player } = makeFakePlayer()
    const hook = renderHook(player, {
      sourceUrl: "https://a/x.m3u8",
      isPlaying: false,
    })

    expect(hook.latest().awaitingAutostart).toBe(true)
    act(() => {
      jest.advanceTimersByTime(AUTOSTART_VEIL_TIMEOUT_MS)
    })
    expect(hook.latest().awaitingAutostart).toBe(false)
    expect(hook.latest().hasStarted).toBe(false)
  })

  it("re-arms for a new source so the next item also autostarts", () => {
    const { player, state, emit } = makeFakePlayer()
    const hook = renderHook(player, {
      sourceUrl: "https://a/x.m3u8",
      isPlaying: false,
    })

    act(() => emit("sourceLoad"))
    expect(state.plays).toBe(1)

    hook.rerender({ sourceUrl: "https://a/y.m3u8", isPlaying: false })
    act(() => emit("sourceLoad"))
    expect(state.plays).toBe(2)
  })

  it("removes its listeners on unmount", () => {
    const { player, state } = makeFakePlayer()
    const hook = renderHook(player, {
      sourceUrl: "https://a/x.m3u8",
      isPlaying: false,
    })
    hook.unmount()
    expect(state.removed).toBe(2)
  })
})
