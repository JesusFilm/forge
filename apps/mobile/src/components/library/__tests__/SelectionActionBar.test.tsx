/**
 * The selection bar replaces the tab bar, so on iOS it must occupy the same box
 * as the pill. On Android it must not change at all.
 */
import { act } from "react"
import { Platform } from "react-native"

import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  TAB_BAR_PILL_HEIGHT,
  TAB_BAR_PILL_LIFT,
  TAB_BAR_PILL_RADIUS,
  TAB_BAR_PILL_SIDE_MARGIN,
} from "../../../lib/tabBar"
import { SelectionActionBar } from "../SelectionActionBar"

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 59, right: 0, bottom: 34, left: 0 }),
}))
jest.mock("expo-router", () => ({ useSegments: () => ["(tabs)"] }))
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => true,
  isGlassEffectAPIAvailable: () => true,
}))

const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
})

async function render(hasFailed = false): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <SelectionActionBar
        count={3}
        combinedBytes={1024}
        hasFailed={hasFailed}
        onRetryFailed={() => {}}
        onDeletePress={() => {}}
      />,
    )
  })
  return renderer
}

function flatten(raw: unknown): Record<string, unknown> {
  return (
    Array.isArray(raw) ? Object.assign({}, ...raw.filter(Boolean)) : raw
  ) as Record<string, unknown>
}

async function renderBar(): Promise<Record<string, unknown>> {
  const renderer = await render()
  return flatten(renderer.root.findAll((n) => n.type === "View")[0].props.style)
}

/** Both action buttons, resolved through the Pressable style callback.
 *  A Pressable and its host view both carry the label, so each button matches
 *  twice; the assertions check every match and both background colours. */
async function buttonStyles(): Promise<Record<string, unknown>[]> {
  const renderer = await render(true)
  return renderer.root
    .findAll((n) => typeof n.props.accessibilityLabel === "string")
    .filter((n) => typeof n.type !== "string")
    .map((n) => {
      const style = n.props.style
      return flatten(
        typeof style === "function"
          ? (style as (s: { pressed: boolean }) => unknown)({ pressed: false })
          : style,
      )
    })
}

describe("iOS", () => {
  it("occupies the same box as the tab pill", async () => {
    setPlatform("ios")
    const style = await renderBar()
    expect(style.height).toBe(TAB_BAR_PILL_HEIGHT)
    expect(style.borderRadius).toBe(TAB_BAR_PILL_RADIUS)
    expect(style.marginBottom).toBe(34 + TAB_BAR_PILL_LIFT)
    expect(style.marginHorizontal).toBe(TAB_BAR_PILL_SIDE_MARGIN)
  })

  it("drops the opaque fill and the hairline the flush bar carried", async () => {
    setPlatform("ios")
    const style = await renderBar()
    expect(style.backgroundColor).toBeUndefined()
    expect(style.borderTopWidth).toBe(0)
  })
})

describe("Android", () => {
  it("keeps the flush, full-width, opaque bar", async () => {
    setPlatform("android")
    const style = await renderBar()
    expect(style.backgroundColor).toBe("rgba(12, 12, 13, 0.94)")
    expect(style.left).toBe(0)
    expect(style.right).toBe(0)
    expect(style.bottom).toBe(0)
    expect(style.borderRadius).toBeUndefined()
    expect(style.paddingBottom).toBe(34 + 14)
  })
})

describe("both action buttons fit the capsule on iOS", () => {
  it("shrinks the retry button too, not only delete", async () => {
    // hasFailed defaults false, so a fixture that never sets it leaves the
    // retry button unrendered and its height unpinned.
    setPlatform("ios")
    const styles = await buttonStyles()
    expect(new Set(styles.map((s) => s.backgroundColor)).size).toBe(2)
    styles.forEach((s) => expect(s.height).toBe(40))
  })

  it("leaves both buttons at 48 on Android", async () => {
    setPlatform("android")
    const styles = await buttonStyles()
    expect(new Set(styles.map((s) => s.backgroundColor)).size).toBe(2)
    styles.forEach((s) => expect(s.height).toBe(48))
  })
})
