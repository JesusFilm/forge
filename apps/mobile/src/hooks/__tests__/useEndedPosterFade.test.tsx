/**
 * Behavioural coverage for the ended-playback poster. The previous suite
 * pinned statement TEXT in the hook file, which cannot see an effect's
 * dependency array, a try/catch's nesting, or a same-value state bail-out —
 * exactly the places this hook can break. These tests drive the real hook
 * against a fake player instead.
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

import { useEndedPosterFade } from "../useEndedPosterFade"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

type Listener = () => void

/** Minimal stand-in for the expo-video player surface this hook touches. */
function makeFakePlayer(opts?: { duration?: number; currentTime?: number }) {
  const listeners: Record<string, Listener[]> = {}
  let removed = 0
  const state = {
    duration: opts?.duration ?? 100,
    currentTime: opts?.currentTime ?? 100,
    /** Set true to make the getters throw, like a released native player. */
    released: false,
  }
  const player = {
    addListener(event: string, cb: Listener) {
      ;(listeners[event] ??= []).push(cb)
      return {
        remove() {
          removed += 1
        },
      }
    },
    get duration() {
      if (state.released) throw new Error("player released")
      return state.duration
    },
    get currentTime() {
      if (state.released) throw new Error("player released")
      return state.currentTime
    },
  }
  return {
    player,
    state,
    emit: (event: string) => listeners[event]?.forEach((cb) => cb()),
    listenerCount: (event: string) => listeners[event]?.length ?? 0,
    removedCount: () => removed,
  }
}

let api: ReturnType<typeof useEndedPosterFade> | null = null

function render(fake: ReturnType<typeof makeFakePlayer>, isPlaying: boolean) {
  function Harness({ playing }: { playing: boolean }) {
    api = useEndedPosterFade(
      fake.player as unknown as Parameters<typeof useEndedPosterFade>[0],
      playing,
    )
    return null
  }
  let renderer!: TestInstance
  act(() => {
    renderer = TestRenderer.create(<Harness playing={isPlaying} />)
  })
  // The shared helper's TestInstance type exposes only root/unmount; the
  // underlying react-test-renderer instance also has update().
  const updatable = renderer as unknown as {
    update(el: React.ReactElement): void
  }
  return {
    renderer,
    setPlaying: (playing: boolean) =>
      act(() => {
        updatable.update(<Harness playing={playing} />)
      }),
  }
}

/** Animated.Value's current numeric value. */
function fade(): number {
  return (
    api?.posterFade as unknown as { __getValue: () => number }
  ).__getValue()
}

/**
 * Spy on the fade value's writes. The ramp runs on the NATIVE driver, so its
 * JS value never advances under jest — the observable contract is therefore
 * "who calls setValue(0), and when", which is exactly where the repeat-event
 * bug lives.
 */
function spyOnFade() {
  const value = api?.posterFade as unknown as {
    setValue: (v: number) => void
  }
  return jest.spyOn(value, "setValue")
}

beforeEach(() => {
  jest.useFakeTimers()
  api = null
})
afterEach(() => {
  jest.useRealTimers()
})

describe("useEndedPosterFade", () => {
  it("latches ended and starts the poster transparent so it can fade in", () => {
    const fake = makeFakePlayer()
    const { renderer } = render(fake, true)
    expect(api?.ended).toBe(false)
    expect(fade()).toBe(1)

    const setValue = spyOnFade()
    act(() => fake.emit("playToEnd"))
    expect(api?.ended).toBe(true)
    // Zeroed synchronously by the listener — a passive effect would let the
    // overlay paint one frame at full opacity first.
    expect(setValue).toHaveBeenCalledWith(0)
    expect(fade()).toBe(0)
    act(() => renderer.unmount())
  })

  it("keeps the poster opaque when playToEnd repeats", () => {
    // Both platforms re-emit playToEnd for an item already at its end. The
    // state write then bails out as a same-value set, so nothing re-runs the
    // fade effect: an unconditional zero here would strand the overlay at
    // opacity 0 and show the black last frame it exists to cover.
    const fake = makeFakePlayer()
    const { renderer } = render(fake, true)

    act(() => fake.emit("playToEnd"))
    expect(api?.ended).toBe(true)

    // The latch is already true: a repeat must not re-zero the value, because
    // the same-value state write cannot re-run the effect that ramps it back.
    const setValue = spyOnFade()
    act(() => fake.emit("playToEnd"))
    expect(api?.ended).toBe(true)
    expect(setValue).not.toHaveBeenCalledWith(0)
    act(() => renderer.unmount())
  })

  it("clears the latch and restores opacity when playback resumes", () => {
    const fake = makeFakePlayer()
    const { renderer, setPlaying } = render(fake, false)

    act(() => fake.emit("playToEnd"))
    expect(api?.ended).toBe(true)

    setPlaying(true)
    expect(api?.ended).toBe(false)
    // Solid again for the pre-start/cast poster states.
    expect(fade()).toBe(1)
    act(() => renderer.unmount())
  })

  it("drops the latch when a paused seek leaves the end", () => {
    const fake = makeFakePlayer({ duration: 100, currentTime: 100 })
    const { renderer } = render(fake, false)

    act(() => fake.emit("playToEnd"))
    expect(api?.ended).toBe(true)

    // Still at the end: the watcher must not clear it.
    act(() => jest.advanceTimersByTime(600))
    expect(api?.ended).toBe(true)

    fake.state.currentTime = 42
    act(() => jest.advanceTimersByTime(600))
    expect(api?.ended).toBe(false)
    act(() => renderer.unmount())
  })

  it("ignores an unusable duration rather than dropping the poster", () => {
    const fake = makeFakePlayer({ duration: 0, currentTime: 0 })
    const { renderer } = render(fake, false)

    act(() => fake.emit("playToEnd"))
    act(() => jest.advanceTimersByTime(600))
    // duration 0 says "unknown", not "seeked away".
    expect(api?.ended).toBe(true)
    act(() => renderer.unmount())
  })

  it("survives a released player instead of throwing inside the interval", () => {
    const fake = makeFakePlayer()
    const { renderer } = render(fake, false)

    act(() => fake.emit("playToEnd"))
    fake.state.released = true

    expect(() => {
      act(() => jest.advanceTimersByTime(600))
    }).not.toThrow()
    expect(api?.ended).toBe(true)
    act(() => renderer.unmount())
  })

  it("tears the listener and the watcher down on unmount", () => {
    const fake = makeFakePlayer()
    const { renderer } = render(fake, false)
    act(() => fake.emit("playToEnd"))
    expect(jest.getTimerCount()).toBeGreaterThan(0)

    act(() => renderer.unmount())
    expect(fake.removedCount()).toBe(1)
    // The watcher must not keep polling a player the screen has dropped.
    fake.state.released = true
    expect(() => {
      act(() => jest.advanceTimersByTime(2000))
    }).not.toThrow()
  })
})
