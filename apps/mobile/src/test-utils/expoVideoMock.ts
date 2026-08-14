/**
 * The one expo-video stub. Every suite that renders a component importing
 * expo-video as a value needs it: a bare import reaches native module scope,
 * and jest-expo's own mock does not model the player surface this app reads.
 *
 * Use it from the hoisted factory, which runs lazily so the require is legal:
 *
 *   jest.mock("expo-video", () =>
 *     require("../../test-utils/expoVideoMock").expoVideoModuleMock(),
 *   )
 *
 * The factory and a normal `import` resolve to the same registry entry, so the
 * suite can reach `lastFakePlayer()` for the instance the component created.
 */

import { createElement, useEffect, useMemo, useRef } from "react"

export type FakePlayerListener = (payload?: never) => void

/** Every property the adapter, the chrome, and the caption overlay read. */
export type FakePlayer = {
  muted: boolean
  loop: boolean
  playing: boolean
  currentTime: number
  duration: number
  status: string
  subtitleTrack: unknown
  /** Written by the creation `setup` callback, so a suite can prove the buffer
   *  leaf reached the player it was passed to. */
  bufferOptions?: unknown
  play: jest.Mock<void, []>
  pause: jest.Mock<void, []>
  replace: jest.Mock<void, [string, boolean?]>
  replaceAsync: jest.Mock<Promise<void>, [string]>
  addListener: jest.Mock<{ remove: () => void }, [string, FakePlayerListener]>
  /** Fire a native event at every live listener for `event`. */
  emit: (event: string, payload?: unknown) => void
  /** Live listeners for `event` — a removed listener is gone from this count. */
  listenerCount: (event: string) => number
}

export function makeFakePlayer(
  overrides: Partial<FakePlayer> = {},
): FakePlayer {
  const listeners = new Map<string, Set<FakePlayerListener>>()

  const player: FakePlayer = {
    muted: false,
    loop: false,
    playing: false,
    currentTime: 0,
    duration: 0,
    status: "readyToPlay",
    subtitleTrack: null,
    play: jest.fn(),
    pause: jest.fn(),
    replace: jest.fn(),
    replaceAsync: jest.fn((_url: string) => Promise.resolve()),
    addListener: jest.fn((event: string, listener: FakePlayerListener) => {
      const set = listeners.get(event) ?? new Set<FakePlayerListener>()
      set.add(listener)
      listeners.set(event, set)
      return {
        remove: () => {
          set.delete(listener)
        },
      }
    }),
    emit: (event, payload) => {
      // Copy first: a listener that removes itself must not mutate the live set
      // mid-iteration, which is exactly what the adapter's cleanups do.
      for (const listener of [...(listeners.get(event) ?? [])]) {
        ;(listener as (p?: unknown) => void)(payload)
      }
    },
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
    ...overrides,
  }

  return player
}

const created: FakePlayer[] = []

/** Every player the stub handed out this test, oldest first. */
export function createdFakePlayers(): readonly FakePlayer[] {
  return created
}

/** The most recent player — the one a single-player render just created. */
export function lastFakePlayer(): FakePlayer {
  const player = created.at(-1)
  if (player == null)
    throw new Error("expoVideoMock: no player was created by this render")
  return player
}

/**
 * Live surface counts, kept by the stub's own mount effect.
 *
 * A tree inspected after `act` shows only the LAST commit, so a second surface
 * that lives for one commit — the whole shape of a decoder handoff bug — is
 * invisible to a testID count. React flushes every passive destroy of a commit
 * before any passive create, so a same-commit handoff peaks at one and a real
 * double-attach peaks at two.
 */
let mountedSurfaces = 0
let peakSurfaces = 0
const surfacesPerPlayer = new Map<unknown, number>()
let peakPerPlayer = 0

/** The most surfaces mounted at once, over every commit since the reset. */
export function peakMountedSurfaces(): number {
  return peakSurfaces
}

/** The most surfaces mounted at once on ONE player. Two is what Android
 *  asserts against. */
export function peakSurfacesPerPlayer(): number {
  return peakPerPlayer
}

/** Call from `beforeEach`; the registry is module-scope and survives tests. */
export function resetExpoVideoMock() {
  created.length = 0
  mountedSurfaces = 0
  peakSurfaces = 0
  peakPerPlayer = 0
  surfacesPerPlayer.clear()
}

function trackSurface(player: unknown): () => void {
  mountedSurfaces += 1
  peakSurfaces = Math.max(peakSurfaces, mountedSurfaces)
  const onPlayer = (surfacesPerPlayer.get(player) ?? 0) + 1
  surfacesPerPlayer.set(player, onPlayer)
  peakPerPlayer = Math.max(peakPerPlayer, onPlayer)
  return () => {
    mountedSurfaces = Math.max(0, mountedSurfaces - 1)
    surfacesPerPlayer.set(
      player,
      Math.max(0, (surfacesPerPlayer.get(player) ?? 0) - 1),
    )
  }
}

/** The module body `jest.mock("expo-video", …)` returns. */
export function expoVideoModuleMock() {
  const register = (setup?: (player: FakePlayer) => void) => {
    const player = makeFakePlayer()
    setup?.(player)
    created.push(player)
    return player
  }

  // A host element under a tracking component, so a suite can count mounted
  // surfaces by testID AND read the peak across commits — the one-decoder
  // invariant is asserted by counting these, not by inspecting the player.
  const VideoView = (props: Record<string, unknown>) => {
    const player = props.player
    useEffect(() => trackSurface(player), [player])
    return createElement("VideoView", { testID: "expo-video-view", ...props })
  }

  return {
    VideoView,
    // Memoized on the source exactly as the real hook is (its dep is
    // JSON.stringify(source)). Returning a fresh player per render would churn
    // every `[player]` effect in the adapter and prove nothing about the app.
    useVideoPlayer: jest.fn(
      (source: unknown, setup?: (player: FakePlayer) => void) => {
        const key = JSON.stringify(source ?? null)
        // Source only. `setup` is deliberately not a dep: callers pass an inline
        // arrow, so depending on it re-creates the player every render. The real
        // hook also runs setup once, at creation.
        const setupOnce = useRef(setup)
        return useMemo(() => register(setupOnce.current), [key])
      },
    ),
    createVideoPlayer: jest.fn((_source: unknown) => register()),
    isPictureInPictureSupported: jest.fn(() => true),
  }
}
