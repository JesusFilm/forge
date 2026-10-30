// The floating back button over full-bleed content. On Liquid Glass it takes
// Apple's own press response; elsewhere a press scales it.

// apps/mobile's tsconfig maps `react` to its .d.ts. These mocks re-point
// `react` at the real package (see apps/mobile/CLAUDE.md "Component render tests").
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
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// jest-expo reports Liquid Glass as available, so each case pins the branch.
const mockGate = { glass: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
  }),
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))

import { act } from "react"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import { FloatingBackButton } from "../FloatingBackButton"
import { FLOATING_BACK_SIZE } from "../../../lib/playerLayout"
import {
  TestRenderer,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

async function render(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<FloatingBackButton />)
  })
  return renderer
}

function pressedStyle(renderer: TestInstance): ViewStyle {
  const target = pressableByLabel(renderer, "Go back")
  const style = target.props.style as (state: {
    pressed: boolean
  }) => StyleProp<ViewStyle>
  return StyleSheet.flatten(style({ pressed: true })) ?? {}
}

afterEach(() => {
  mockGate.glass = true
})

describe("FloatingBackButton press", () => {
  it("draws a 44pt glass with a small ring around it, so most taps land on the glass", async () => {
    const renderer = await render()
    const [view] = renderer.root.findAll((n) => n.type === "GlassView")
    const style = StyleSheet.flatten(view!.props.style as StyleProp<ViewStyle>)
    expect(FLOATING_BACK_SIZE).toBe(44)
    expect([style.width, style.height]).toEqual([
      FLOATING_BACK_SIZE,
      FLOATING_BACK_SIZE,
    ])
    // Apple's press response misses a tap on the ring; 6pt keeps a 56pt target.
    expect(pressableByLabel(renderer, "Go back").props.hitSlop).toBe(6)
    await unmount(renderer)
  })

  it.each([
    ["Liquid Glass", true, true, undefined],
    ["no Liquid Glass", false, false, [{ scale: 0.92 }]],
  ] as const)(
    "on %s, the press response is right",
    async (_name, glass, interactive, transform) => {
      mockGate.glass = glass
      const renderer = await render()
      const [view] = renderer.root.findAll((n) => n.type === "GlassView")
      expect(view!.props.isInteractive).toBe(interactive)
      // Two press responses at once would read as a defect.
      expect(pressedStyle(renderer).transform).toEqual(transform)
      await unmount(renderer)
    },
  )
})
