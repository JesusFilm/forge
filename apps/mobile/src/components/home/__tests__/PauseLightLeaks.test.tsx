import { Image } from "expo-image"
import { act } from "react"
import {
  AccessibilityInfo,
  Animated,
  AppState,
  StyleSheet,
  type AppStateStatus,
  type ViewStyle,
} from "react-native"

import {
  LIGHT_LEAK_FLASH_MS,
  LIGHT_LEAK_GAP_MS,
} from "../../../lib/dailyPause/lightLeaks"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { LEAK_PLATES, PauseLightLeaks } from "../PauseLightLeaks"

declare const __dirname: string
declare const require: (moduleName: string) => {
  readFileSync: (path: string, encoding: string) => string
  join: (...parts: string[]) => string
}
const fs = require("node:fs")
const path = require("node:path")

const realTiming = Animated.timing
let timingConfigs: Animated.TimingAnimationConfig[] = []
let appStateListener: ((state: AppStateStatus) => void) | null = null

beforeEach(() => {
  jest.useFakeTimers()
  timingConfigs = []
  // Jest's native driver ends after one frame at the start value, so the
  // tests step the same timing on the JS driver.
  jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
    timingConfigs.push(config)
    return realTiming(value, { ...config, useNativeDriver: false })
  })
  // Math.random 0: every gap is the shortest, and the first shape is "edge".
  jest.spyOn(Math, "random").mockReturnValue(0)
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    appStateListener = listener as (state: AppStateStatus) => void
    return { remove: () => (appStateListener = null) }
  })
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
  appStateListener = null
})

async function render(enabled: boolean): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<PauseLightLeaks enabled={enabled} />)
  })
  return renderer
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

/** The host view of the one leak on screen, or null. */
function leak(renderer: TestInstance): RenderedNode | null {
  const hosts = renderer.root.findAll(
    (node) =>
      node.props.testID === "pause-light-leak" && typeof node.type === "string",
  )
  expect(hosts.length).toBeLessThanOrEqual(1)
  return hosts[0] ?? null
}

function second(renderer: TestInstance): RenderedNode {
  const hosts = renderer.root.findAll(
    (node) =>
      node.props.testID === "pause-light-leak-second" &&
      typeof node.type === "string",
  )
  expect(hosts).toHaveLength(1)
  return hosts[0]!
}

function opacity(node: RenderedNode): number {
  return StyleSheet.flatten(node.props.style as ViewStyle).opacity as number
}

describe("PauseLightLeaks", () => {
  it("waits one gap, flashes once, then waits again", async () => {
    const renderer = await render(true)
    await advance(LIGHT_LEAK_GAP_MS.min - 1)
    expect(leak(renderer)).toBeNull()

    await advance(1)
    const first = leak(renderer)
    expect(first).not.toBeNull()
    // The flash mounts dark, so no frame shows a leftover value.
    expect(opacity(first!)).toBe(0)

    await advance(LIGHT_LEAK_FLASH_MS - 100)
    expect(leak(renderer)).not.toBeNull()
    await advance(150)
    expect(leak(renderer)).toBeNull()
    await advance(LIGHT_LEAK_GAP_MS.min)
    expect(leak(renderer)).not.toBeNull()
    await unmount(renderer)
  })

  it("rises to the shape's own strength, not to full white", async () => {
    const renderer = await render(true)
    await advance(LIGHT_LEAK_GAP_MS.min)
    // The curve's peak is at 10 % of the flash.
    await advance(LIGHT_LEAK_FLASH_MS * 0.1)
    const peak = opacity(leak(renderer)!)
    expect(peak).toBeGreaterThan(0.5)
    expect(peak).toBeLessThan(1)
    await unmount(renderer)
  })

  // The card sets only a minimum height, so a percentage height or top on a
  // leak does not reach the card's bottom on a device.
  it("screen-blends a filmed leak over the whole card, mirrored for the left ones", async () => {
    // Gap, leak, gap, leak...: sweep, band, sweep-left, then band-left.
    const draws = [0, 0, 0, 0, 0, 0.5, 0, 0.99]
    jest.spyOn(Math, "random").mockImplementation(() => draws.shift() ?? 0)
    const expected = [
      { film: "sweep", scaleX: 1 },
      { film: "band", scaleX: 1 },
      { film: "sweep", scaleX: -1 },
      { film: "band", scaleX: -1 },
    ] as const
    expect(LEAK_PLATES.sweep[0]).not.toBe(LEAK_PLATES.band[0])
    const renderer = await render(true)
    for (const want of expected) {
      await advance(LIGHT_LEAK_GAP_MS.min)
      const style = StyleSheet.flatten(leak(renderer)!.props.style as ViewStyle)
      expect(style).toMatchObject({ top: 0, bottom: 0, left: 0, right: 0 })
      expect(style.height).toBeUndefined()
      expect(style.mixBlendMode).toBe("screen")
      expect(style.transform).toContainEqual({ scaleX: want.scaleX })
      const plates = renderer.root
        .findAll((node) => node.type === Image)
        .map((node) => [node.props.source, node.props.recyclingKey])
      // apps/mobile/CLAUDE.md: every expo-image carries a recyclingKey.
      expect(plates).toEqual([
        [LEAK_PLATES[want.film][0], `leak-${want.film}-0`],
        [LEAK_PLATES[want.film][1], `leak-${want.film}-1`],
      ])
      await advance(LIGHT_LEAK_FLASH_MS + 50)
    }
    await unmount(renderer)
  })

  it("fades the second frame in over the first after the rise", async () => {
    const renderer = await render(true)
    await advance(LIGHT_LEAK_GAP_MS.min)
    await advance(LIGHT_LEAK_FLASH_MS * 0.1)
    expect(opacity(second(renderer))).toBe(0)
    await advance(LIGHT_LEAK_FLASH_MS * 0.65)
    expect(opacity(second(renderer))).toBe(1)
    await unmount(renderer)
  })

  it("never flashes while it is not enabled", async () => {
    const renderer = await render(false)
    await advance(60_000)
    expect(leak(renderer)).toBeNull()
    await unmount(renderer)
  })

  it("takes a running flash away at once when it stops being enabled", async () => {
    const renderer = await render(true)
    await advance(LIGHT_LEAK_GAP_MS.min + 300)
    expect(leak(renderer)).not.toBeNull()
    await act(async () => {
      renderer.update(<PauseLightLeaks enabled={false} />)
    })
    expect(leak(renderer)).toBeNull()
    await advance(60_000)
    expect(leak(renderer)).toBeNull()
    await unmount(renderer)
  })

  it("never flashes with Reduce Motion on", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockResolvedValue(true)
    const renderer = await render(true)
    await advance(60_000)
    expect(leak(renderer)).toBeNull()
    await unmount(renderer)
  })

  it("rests while the app is in the background", async () => {
    const renderer = await render(true)
    await act(async () => appStateListener?.("background"))
    await advance(60_000)
    expect(leak(renderer)).toBeNull()
    await act(async () => appStateListener?.("active"))
    await advance(LIGHT_LEAK_GAP_MS.min)
    expect(leak(renderer)).not.toBeNull()
    await unmount(renderer)
  })

  it("gives each flash a new value instead of a reset", async () => {
    const setValue = jest.spyOn(Animated.Value.prototype, "setValue")
    const renderer = await render(true)
    await advance(LIGHT_LEAK_GAP_MS.min + LIGHT_LEAK_FLASH_MS + 50)
    await advance(LIGHT_LEAK_GAP_MS.min + LIGHT_LEAK_FLASH_MS + 50)
    expect(setValue).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("runs each flash on the native driver", async () => {
    const renderer = await render(true)
    await advance(LIGHT_LEAK_GAP_MS.min + LIGHT_LEAK_FLASH_MS + 50)
    expect(timingConfigs.length).toBeGreaterThan(0)
    for (const config of timingConfigs) {
      expect(config.useNativeDriver).toBe(true)
    }
    await unmount(renderer)
  })

  // A native Animated.sequence or loop can fail to run on Fabric.
  it("uses no Animated.sequence and no Animated.loop", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../PauseLightLeaks.tsx"),
      "utf8",
    )
    expect(source).not.toContain("Animated.sequence(")
    expect(source).not.toContain("Animated.loop(")
  })

  // Jest runs as iOS, so the Android 9 rest is pinned at its call site; the
  // rule itself is tested in lightLeaks.test.ts.
  it("gates every flash on the platform's screen-blend support", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "../PauseLightLeaks.tsx"),
      "utf8",
    )
    expect(source).toContain(
      "const SUPPORTED = lightLeaksSupported(Platform.OS, Platform.Version)",
    )
    expect(source).toMatch(/const running =\s*SUPPORTED &&/)
  })
})
