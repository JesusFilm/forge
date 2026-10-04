import { act } from "react"
import { Animated, BackHandler, Text } from "react-native"

import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import { endPause, requestPause } from "../../lib/pauseCurtain"
import { LOGO_DURATION_MS } from "../DailyBiblePauseLogo"
import {
  PAUSE_FADE_IN_MS,
  PAUSE_FADE_OUT_MS,
  PauseStage,
  pauseProgressAt,
} from "../PauseStage"

const mockSetStatusBarHidden = jest.fn()
jest.mock("expo-status-bar", () => ({
  setStatusBarHidden: (...args: unknown[]) => mockSetStatusBarHidden(...args),
}))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))

const CURTAIN_LABEL = "Daily Bible Pause. Tap to return."

type Timing = {
  toValue: number
  duration: number
  delay: number
  finish: () => void
}
let timings: Timing[] = []
let backHandlers: Array<() => boolean> = []

beforeEach(() => {
  jest.useFakeTimers()
  timings = []
  backHandlers = []
  jest.spyOn(Animated, "timing").mockImplementation((_value, config) => {
    let callback: Animated.EndCallback | undefined
    timings.push({
      toValue: config.toValue as number,
      duration: config.duration ?? 0,
      delay: config.delay ?? 0,
      finish: () => callback?.({ finished: true }),
    })
    return {
      start: (cb?: Animated.EndCallback) => {
        callback = cb
      },
      stop: () => {},
      reset: () => {},
    } as unknown as Animated.CompositeAnimation
  })
  jest
    .spyOn(BackHandler, "addEventListener")
    .mockImplementation((_, handler) => {
      const fn = handler as unknown as () => boolean
      backHandlers.push(fn)
      return {
        remove: () => {
          backHandlers = backHandlers.filter((other) => other !== fn)
        },
      }
    })
})

afterEach(() => {
  act(() => endPause())
  mockSetStatusBarHidden.mockClear()
  jest.restoreAllMocks()
  jest.useRealTimers()
})

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <PauseStage>
        <Text>App</Text>
      </PauseStage>,
    )
  })
  return renderer
}

function curtainCount(renderer: TestInstance): number {
  return renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === CURTAIN_LABEL &&
      typeof node.props.onPress === "function",
  ).length
}

const fade = () => timings.find((t) => t.toValue === 1 && t.delay === 0)!
const pen = () => timings.find((t) => t.delay > 0)!
const lift = () => timings.find((t) => t.toValue === 0)!

async function pause() {
  await act(async () => requestPause())
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

describe("pauseProgressAt", () => {
  const run = { from: 0, to: 1, startedAt: 1000, duration: 2000 }

  it("reads a linear run from the clock, clamped at both ends", () => {
    expect(pauseProgressAt(run, 500)).toBe(0)
    expect(pauseProgressAt(run, 2000)).toBe(0.5)
    expect(pauseProgressAt(run, 9000)).toBe(1)
  })

  it("reads a falling run as well as a rising one", () => {
    const falling = { from: 0.8, to: 0, startedAt: 0, duration: 800 }
    expect(pauseProgressAt(falling, 400)).toBeCloseTo(0.4)
  })
})

describe("PauseStage", () => {
  it("draws only the app until a pause is requested", async () => {
    const renderer = await render()
    expect(curtainCount(renderer)).toBe(0)
    expect(timings).toHaveLength(0)
    await unmount(renderer)
  })

  it("fades to black over the whole fade and hides the status bar", async () => {
    const renderer = await render()
    await pause()
    expect(curtainCount(renderer)).toBe(1)
    expect(fade().duration).toBe(PAUSE_FADE_IN_MS)
    expect(mockSetStatusBarHidden).toHaveBeenCalledWith(true, "fade")
    await unmount(renderer)
  })

  // The bars meet at 1.7 s (0.85 of the 2 s fade); the pen leads them by 0.5 s.
  it("starts the logo's pen 0.5 s before the bars meet", async () => {
    const renderer = await render()
    await pause()
    expect(pen()).toEqual(
      expect.objectContaining({
        toValue: 1,
        delay: 1200,
        duration: LOGO_DURATION_MS,
      }),
    )
    await unmount(renderer)
  })

  it("lifts on a tap, then takes the curtain down when the lift ends", async () => {
    const renderer = await render()
    await pause()
    await advance(PAUSE_FADE_IN_MS)
    await press(pressableByLabel(renderer, CURTAIN_LABEL))
    expect(mockSetStatusBarHidden).toHaveBeenLastCalledWith(false, "fade")
    expect(lift().duration).toBe(PAUSE_FADE_OUT_MS)
    // The curtain stays up while it lifts.
    expect(curtainCount(renderer)).toBe(1)
    await act(async () => lift().finish())
    expect(curtainCount(renderer)).toBe(0)
    await unmount(renderer)
  })

  it("lifts from where the fade is when the tap comes halfway", async () => {
    const renderer = await render()
    await pause()
    await advance(PAUSE_FADE_IN_MS / 2)
    await press(pressableByLabel(renderer, CURTAIN_LABEL))
    expect(lift().duration).toBeCloseTo(PAUSE_FADE_OUT_MS / 2)
    await unmount(renderer)
  })

  it("never lifts faster than 300 ms", async () => {
    const renderer = await render()
    await pause()
    await advance(50)
    await press(pressableByLabel(renderer, CURTAIN_LABEL))
    expect(lift().duration).toBe(300)
    await unmount(renderer)
  })

  // Measured on the iPhone 17 simulator (2026-10-01): the native driver never
  // called this back, and a lift that waited for it left the screen black.
  it("lifts even when stopAnimation never calls back", async () => {
    jest
      .spyOn(Animated.Value.prototype, "stopAnimation")
      .mockImplementation(() => {})
    const renderer = await render()
    await pause()
    await advance(PAUSE_FADE_IN_MS)
    await press(pressableByLabel(renderer, CURTAIN_LABEL))
    expect(lift()).toBeDefined()
    await unmount(renderer)
  })

  it("lifts on Android's back button, and consumes it only while paused", async () => {
    const renderer = await render()
    expect(backHandlers).toHaveLength(0)
    await pause()
    expect(backHandlers).toHaveLength(1)
    let consumed = false
    await act(async () => {
      consumed = backHandlers[0]!()
    })
    expect(consumed).toBe(true)
    expect(lift()).toBeDefined()
    await act(async () => lift().finish())
    expect(backHandlers).toHaveLength(0)
    await unmount(renderer)
  })
})
