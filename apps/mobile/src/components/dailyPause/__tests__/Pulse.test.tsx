// The pulse on the Watch and Reflect Continue buttons (the owner, 2026-10-06).
// Jest cannot move a native animation, so a stand-in loop that never starts
// keeps the clock in JS, and the tests drive the clock by hand.
import { act } from "react"
import { Animated, StyleSheet, Text, type ViewStyle } from "react-native"

import type { PauseFace } from "../../../lib/dailyPause/fonts"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { PULSE_CYCLE_MS, PULSE_SCALE, Pulse } from "../Pulse"
import { WatchScreen } from "../WatchScreen"

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}
const fs = require("node:fs")
const path = require("node:path")

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))
let mockReduceMotion = false
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockReduceMotion,
}))

const font = (face: PauseFace) => ({ fontFamily: face })
let renderer: TestInstance | null = null
let loopStart: jest.Mock
let loopStop: jest.Mock
let timingValue: Animated.Value | null = null

beforeEach(() => {
  loopStart = jest.fn()
  loopStop = jest.fn()
  timingValue = null
  const timing = Animated.timing
  jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
    timingValue = value as Animated.Value
    return timing(value, config)
  })
  jest.spyOn(Animated, "loop").mockImplementation(
    () =>
      ({
        start: loopStart,
        stop: loopStop,
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  )
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  mockReduceMotion = false
  jest.restoreAllMocks()
})

async function render(element: React.ReactElement) {
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  return renderer!
}

function pulses(root: TestInstance): RenderedNode[] {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.testID === "pause-pulse",
  )
}

/** True when the host Continue button sits inside a pulse. */
function continueIsPulsing(root: TestInstance): boolean {
  const [button] = root.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === "Continue",
  )
  for (let node = button?.parent; node; node = node.parent) {
    if (node.props.testID === "pause-pulse") return true
  }
  return false
}

function scaleOf(node: RenderedNode): number {
  const transform = (StyleSheet.flatten(node.props.style as ViewStyle)
    .transform ?? []) as unknown as Record<string, number>[]
  return Number(transform.find((one) => "scale" in one)?.scale ?? 1)
}

it("loops one native timing of one second, with no sequence", async () => {
  await render(
    <Pulse>
      <Text>Tap</Text>
    </Pulse>,
  )
  expect(Animated.loop).toHaveBeenCalledTimes(1)
  expect(jest.mocked(Animated.loop).mock.calls[0]![1]).toBeUndefined()
  expect(Animated.timing).toHaveBeenCalledWith(
    expect.any(Animated.Value),
    expect.objectContaining({
      toValue: 1,
      duration: PULSE_CYCLE_MS,
      useNativeDriver: true,
    }),
  )
  expect(loopStart).toHaveBeenCalledTimes(1)
  // A looped sequence freezes after one pass on Fabric.
  const source = fs.readFileSync(
    path.join(__dirname, "..", "Pulse.tsx"),
    "utf8",
  )
  expect(source).not.toContain("Animated.sequence(")
})

it("swells to its peak and settles once a cycle", async () => {
  const root = await render(
    <Pulse>
      <Text>Tap</Text>
    </Pulse>,
  )
  const [pulse] = pulses(root)
  expect(scaleOf(pulse!)).toBe(1)
  const at = (t: number) => {
    act(() => timingValue!.setValue(t))
    return scaleOf(pulses(root)[0]!)
  }
  expect(at(0.3)).toBeCloseTo(PULSE_SCALE)
  expect(at(0.15)).toBeGreaterThan(1)
  expect(at(0.15)).toBeLessThan(PULSE_SCALE)
  expect(at(0.6)).toBeCloseTo(1)
  expect(at(0.8)).toBe(1)
  expect(at(1)).toBe(1)
})

it("stops the loop when it unmounts", async () => {
  await render(
    <Pulse>
      <Text>Tap</Text>
    </Pulse>,
  )
  await unmount(renderer!)
  renderer = null
  expect(loopStop).toHaveBeenCalled()
})

it("keeps still under Reduce Motion", async () => {
  mockReduceMotion = true
  const root = await render(
    <Pulse>
      <Text>Tap</Text>
    </Pulse>,
  )
  expect(pulses(root)).toHaveLength(0)
  expect(loopStart).not.toHaveBeenCalled()
})

it("pulses the Continue button on the Watch screen", async () => {
  const root = await render(
    <WatchScreen meditationLength={3} font={font} onContinue={() => {}} />,
  )
  expect(continueIsPulsing(root)).toBe(true)
})
