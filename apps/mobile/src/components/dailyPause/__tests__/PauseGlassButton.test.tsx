// The Liquid Glass Continue buttons (the owner, 2026-10-06). GlassView draws
// nothing under an ancestor whose opacity animates, and nothing logs, so these
// tests pin that no ancestor of the glass sets an opacity at all.
import { act } from "react"
import { AppState, Platform, StyleSheet, type ViewStyle } from "react-native"

import { DEVOTIONALS } from "../../../lib/dailyPause/devotionals"
import type { PauseFace } from "../../../lib/dailyPause/fonts"
import { pauseColors } from "../../../lib/dailyPause/theme"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { PAUSE_INTRO_MS } from "../PauseIntro"
import { PrayScreen } from "../PrayScreen"
import { ReflectScreen } from "../ReflectScreen"
import { WatchScreen } from "../WatchScreen"

// The factory owns its state so a case can turn Liquid Glass off.
jest.mock("expo-glass-effect", () => {
  const react = jest.requireActual("react")
  const state = { liquid: true }
  return {
    GlassView: (props: Record<string, unknown>) =>
      react.createElement("GlassView", props),
    isLiquidGlassAvailable: () => state.liquid,
    isGlassEffectAPIAvailable: () => true,
    __state: state,
  }
})
const mockGlass = (
  jest.requireMock("expo-glass-effect") as unknown as {
    __state: { liquid: boolean }
  }
).__state
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => false,
}))

const font = (face: PauseFace) => ({ fontFamily: face })
const platformOs = Object.getOwnPropertyDescriptor(Platform, "OS")!
let renderer: TestInstance | null = null

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 5, 7, 0) })
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((() => ({ remove: () => {} })) as never)
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  mockGlass.liquid = true
  Object.defineProperty(Platform, "OS", platformOs)
  jest.restoreAllMocks()
  jest.useRealTimers()
})

async function render(element: React.ReactElement) {
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  return renderer!
}

function advance(ms: number) {
  for (let left = ms; left > 0; left -= 250) {
    act(() => {
      jest.advanceTimersByTime(Math.min(250, left))
    })
  }
}

function glassLabels(root: TestInstance): string[] {
  return glasses(root).map((glass) => textIn(root, glass))
}

function glasses(root: TestInstance): RenderedNode[] {
  return root.root.findAll((node) => node.type === "GlassView")
}

function textIn(root: TestInstance, glass: RenderedNode): string {
  const texts = root.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      typeof node.props.children === "string" &&
      isInside(node, glass),
  )
  return texts.map((node) => node.props.children as string).join("")
}

function isInside(node: RenderedNode, ancestor: RenderedNode): boolean {
  for (let at = node.parent; at; at = at.parent) {
    if (at === ancestor) return true
  }
  return false
}

/** Every opacity set above the glass, from the glass up to the root. */
function opacitiesAbove(glass: RenderedNode): unknown[] {
  const found: unknown[] = []
  for (let at = glass.parent; at; at = at.parent) {
    if (typeof at.props.style === "function") continue
    const opacity = StyleSheet.flatten(at.props.style as ViewStyle)?.opacity
    if (opacity !== undefined) found.push(opacity)
  }
  return found
}

function reflect() {
  return (
    <ReflectScreen
      devotional={DEVOTIONALS.pharisee}
      meditationLength={3}
      font={font}
      onContinue={() => {}}
    />
  )
}

it("draws the Watch screen's Continue in Liquid Glass, with no fading ancestor", async () => {
  const root = await render(
    <WatchScreen meditationLength={3} font={font} onContinue={() => {}} />,
  )
  const [glass] = glasses(root)
  expect(glassLabels(root)).toEqual(["Continue"])
  expect(glass!.props).toMatchObject({
    glassEffectStyle: "regular",
    colorScheme: "dark",
    isInteractive: true,
  })
  expect(opacitiesAbove(glass!)).toEqual([])
})

it("draws Reflect's timer and then its Continue in Liquid Glass, with no fading ancestor", async () => {
  const root = await render(reflect())
  expect(glassLabels(root)).toEqual(["0:45"])
  expect(opacitiesAbove(glasses(root)[0]!)).toEqual([])

  advance(PAUSE_INTRO_MS)
  advance(45_000)
  expect(glassLabels(root)).toEqual(["Continue"])
  expect(opacitiesAbove(glasses(root)[0]!)).toEqual([])
})

it("keeps Amen the frame's primary button", async () => {
  const root = await render(
    <PrayScreen
      devotional={DEVOTIONALS.pharisee}
      meditationLength={3}
      font={font}
      onContinue={() => {}}
    />,
  )
  expect(glasses(root)).toHaveLength(0)
})

it.each([
  ["without Liquid Glass", () => (mockGlass.liquid = false)],
  [
    "on Android",
    () => Object.defineProperty(Platform, "OS", { value: "android" }),
  ],
])("falls back to the primary button %s", async (_case, arrange) => {
  arrange()
  const root = await render(
    <WatchScreen meditationLength={3} font={font} onContinue={() => {}} />,
  )
  expect(glasses(root)).toHaveLength(0)
  const [button] = root.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === "Continue",
  )
  expect(StyleSheet.flatten(button!.props.style as ViewStyle)).toMatchObject({
    backgroundColor: pauseColors.ink,
  })
})
