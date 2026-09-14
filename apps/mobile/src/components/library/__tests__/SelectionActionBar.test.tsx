/**
 * The selection bar replaces the tab bar, so on iOS it must occupy the box the
 * hidden UIKit bar left behind. On Android it must not change at all.
 */
import { act } from "react"
import { Platform } from "react-native"

import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { TAB_BAR_HEIGHT_IOS } from "../../../lib/tabBar"
import { SelectionActionBar } from "../SelectionActionBar"

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// Mutable so a test can move the insets. The `mock` prefix is required:
// babel-plugin-jest-hoist lifts jest.mock above this declaration and rejects
// any other out-of-scope name in the factory.
const mockInsets = { top: 59, right: 0, bottom: 34, left: 0 }
const BASE_INSETS = { ...mockInsets }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
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
  // Restore EVERY field, not only the ones the last test moved — a partial
  // reset leaks an inset into the next suite and reads as a source defect.
  Object.assign(mockInsets, BASE_INSETS)
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
  it("occupies the box the hidden UIKit bar left behind", async () => {
    // Flush and full width, its own height above the home indicator — the bar
    // is hidden while selection is on, so insets.bottom is the indicator only.
    setPlatform("ios")
    const style = await renderBar()
    expect(style.height).toBe(TAB_BAR_HEIGHT_IOS + 34)
    expect(style.paddingBottom).toBe(34)
    expect(style.left).toBe(0)
    expect(style.right).toBe(0)
    expect(style.bottom).toBe(0)
  })

  it("sizes off the home indicator, not the inset that still holds the bar", async () => {
    // Discriminating: hiding the tab bar is what drops insets.bottom, and that
    // lands a frame after this mounts, so the first paint reports 83 (49pt bar
    // + 34pt indicator). Reading it raw floats the buttons 83pt off the edge.
    setPlatform("ios")
    mockInsets.bottom = 34
    const settled = await renderBar()
    mockInsets.bottom = 83
    const firstFrame = await renderBar()

    expect(firstFrame.height).toBe(settled.height)
    expect(firstFrame.paddingBottom).toBe(settled.paddingBottom)
    expect(firstFrame.height).toBe(TAB_BAR_HEIGHT_IOS + 34)
    expect(firstFrame.paddingBottom).toBe(34)
  })

  it("keeps its side padding when there is no notch to clear", async () => {
    // Discriminating: React Native resolves an edge padding ahead of
    // `paddingHorizontal`, so a bare `insets.left` erases the 16pt gutter and
    // the buttons run edge to edge in portrait.
    setPlatform("ios")
    const style = await renderBar()
    expect(style.paddingLeft).toBe(16)
    expect(style.paddingRight).toBe(16)
  })

  it("adds a landscape notch to that padding rather than replacing it", async () => {
    // Distinct values on each side, so a left/right swap fails too.
    setPlatform("ios")
    mockInsets.left = 44
    mockInsets.right = 21
    const style = await renderBar()
    expect(style.paddingLeft).toBe(16 + 44)
    expect(style.paddingRight).toBe(16 + 21)
  })

  it("is no longer a floating capsule", async () => {
    // Discriminating: the retired pill set a radius and side margins. A revert
    // to `tabBarPillShape` reintroduces both under a hidden native bar.
    setPlatform("ios")
    const style = await renderBar()
    expect(style.borderRadius).toBeUndefined()
    expect(style.marginHorizontal).toBeUndefined()
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
