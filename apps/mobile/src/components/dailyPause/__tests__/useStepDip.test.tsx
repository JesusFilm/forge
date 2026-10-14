import { StrictMode, act } from "react"
import { Animated, StyleSheet, View, type ViewStyle } from "react-native"

import { DIP_TIMINGS, type DipKind } from "../../../lib/dailyPause/stepDip"
import { pauseColors } from "../../../lib/dailyPause/theme"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { DIP_END_MARGIN_MS, useStepDip } from "../useStepDip"

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}
const fs = require("node:fs")
const path = require("node:path")

const realTiming = Animated.timing
let timingConfigs: Animated.TimingAnimationConfig[] = []
let startDip: (change: () => void, kind?: DipKind) => void = () => {}

function Harness({ reduceMotion = false }: { reduceMotion?: boolean }) {
  const { dip, veil } = useStepDip(reduceMotion)
  startDip = dip
  return <View>{veil}</View>
}

beforeEach(() => {
  jest.useFakeTimers()
  timingConfigs = []
  // Jest's native driver ends after one frame at the start value, so the
  // tests step the same timing on the JS driver.
  jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
    timingConfigs.push(config)
    return realTiming(value, { ...config, useNativeDriver: false })
  })
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function render(reduceMotion = false): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <Harness reduceMotion={reduceMotion} />
      </StrictMode>,
    )
  })
  return renderer
}

async function dip(change: () => void, kind?: DipKind) {
  await act(async () => startDip(change, kind))
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

function veil(renderer: TestInstance): RenderedNode | null {
  const hosts = renderer.root.findAll(
    (node) =>
      node.props.testID === "pause-step-dip" && typeof node.type === "string",
  )
  expect(hosts.length).toBeLessThanOrEqual(1)
  return hosts[0] ?? null
}

function style(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as ViewStyle)
}

describe("useStepDip", () => {
  it("changes the step only under the dark veil, once, then lifts", async () => {
    const flow = DIP_TIMINGS.flow
    const renderer = await render()
    const change = jest.fn()
    await dip(change)
    expect(style(veil(renderer)!).opacity).toBe(0)
    expect(style(veil(renderer)!).backgroundColor).toBe(pauseColors.background)

    await advance(flow.swapMs - 1)
    expect(change).not.toHaveBeenCalled()
    await advance(1)
    expect(change).toHaveBeenCalledTimes(1)
    expect(style(veil(renderer)!).opacity).toBe(1)

    await advance(flow.totalMs - flow.swapMs)
    expect(style(veil(renderer)!).opacity).toBe(0)
    await advance(DIP_END_MARGIN_MS)
    expect(veil(renderer)).toBeNull()
    expect(change).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("ignores a second change while one dips", async () => {
    const renderer = await render()
    const first = jest.fn()
    const second = jest.fn()
    await dip(first)
    await dip(second, "jump")
    await advance(DIP_TIMINGS.flow.totalMs + DIP_END_MARGIN_MS)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    const third = jest.fn()
    await dip(third)
    await advance(DIP_TIMINGS.flow.swapMs)
    expect(third).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("uses the quick dip for a jump, and for every change with Reduce Motion on", async () => {
    const jump = DIP_TIMINGS.jump
    for (const [reduceMotion, kind] of [
      [false, "jump"],
      [true, "flow"],
    ] as const) {
      const renderer = await render(reduceMotion)
      const change = jest.fn()
      await dip(change, kind)
      await advance(jump.swapMs)
      expect(change).toHaveBeenCalledTimes(1)
      await advance(jump.totalMs - jump.swapMs + DIP_END_MARGIN_MS)
      expect(veil(renderer)).toBeNull()
      await unmount(renderer)
    }
  })

  it("takes every touch while it shows", async () => {
    const renderer = await render()
    await dip(jest.fn())
    expect(veil(renderer)!.props.pointerEvents ?? "auto").toBe("auto")
    await unmount(renderer)
  })

  it("runs each dip on the native driver, from a new value", async () => {
    const setValue = jest.spyOn(Animated.Value.prototype, "setValue")
    const renderer = await render()
    for (let i = 0; i < 2; i += 1) {
      await dip(jest.fn())
      await advance(DIP_TIMINGS.flow.totalMs + DIP_END_MARGIN_MS)
    }
    expect(timingConfigs.length).toBeGreaterThan(0)
    for (const config of timingConfigs) {
      expect(config.useNativeDriver).toBe(true)
    }
    expect(setValue).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("drops the change when the run closes mid-dip", async () => {
    const renderer = await render()
    const change = jest.fn()
    await dip(change)
    await advance(DIP_TIMINGS.flow.outMs / 2)
    await unmount(renderer)
    await advance(DIP_TIMINGS.flow.totalMs * 2)
    expect(change).not.toHaveBeenCalled()
  })

  // A native Animated.sequence or loop can fail to run on Fabric.
  it("uses no Animated.sequence and no Animated.loop", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../useStepDip.tsx"),
      "utf8",
    )
    expect(source).not.toContain("Animated.sequence(")
    expect(source).not.toContain("Animated.loop(")
  })
})
