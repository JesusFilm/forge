// The selection bar (feat-553 U9, R19, KTD15): it takes the footer's place
// with the selected reference and Copy, Share, and Clear. Copy and Share send
// one text. Each render is in <StrictMode>, because the bar holds a timer.

import { StrictMode, act } from "react"
import {
  AccessibilityInfo,
  Share,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import * as Clipboard from "expo-clipboard"

import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  READER_TOUCH_TARGET,
  readerFooterHeight,
  type ReaderLayout,
} from "../../../lib/bible/reader/chrome"
import { READER_COPY } from "../../../lib/bible/reader/copy"
import { readerTokens } from "../../../lib/bible/theme/palettes"
import {
  SELECTION_COPIED_MS,
  SelectionBar,
  type SelectionBarProps,
} from "../SelectionBar"

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
}))
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => false,
  isGlassEffectAPIAvailable: () => false,
}))
// Liquid Glass is off above, so each button's content renders inside this.
jest.mock("../../ui/PlatformBlur", () => ({
  PlatformBlur: ({ children }: { children: unknown }) => children,
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))

const TOKENS = readerTokens("classic", "dark")
const REFERENCE = "John 3:16-17"
const TEXT =
  "16 For God so loved the world. 17 For God did not send.\n\nJohn 3:16-17 · BSB"
const setString = Clipboard.setStringAsync as jest.Mock

let mounted: TestInstance | null = null
let announcements: string[] = []

beforeEach(() => {
  announcements = []
  setString.mockClear()
  setString.mockImplementation(async () => true)
  jest
    .spyOn(AccessibilityInfo, "announceForAccessibility")
    .mockImplementation((text: string) => {
      announcements.push(text)
    })
})

afterEach(async () => {
  if (mounted != null) {
    await unmount(mounted)
    mounted = null
  }
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function render(overrides: Partial<SelectionBarProps> = {}) {
  const onClear = jest.fn()
  const props: SelectionBarProps = {
    tokens: TOKENS,
    layout: "phone",
    bottomInset: 34,
    reference: REFERENCE,
    text: TEXT,
    onClear,
    ...overrides,
  }
  await act(async () => {
    mounted = TestRenderer.create(
      <StrictMode>
        <SelectionBar {...props} />
      </StrictMode>,
    )
  })
  return { renderer: mounted!, onClear, props }
}

function flat(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}
}

/** One host View per control: Pressable passes the role and style down. */
function buttons(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button",
  )
}

async function pressLabel(renderer: TestInstance, label: string) {
  const [control] = renderer.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.props.accessibilityLabel === label,
  )
  expect(control).toBeDefined()
  await act(async () => control!.props.onPress?.())
}

function textCount(renderer: TestInstance, text: string): number {
  return renderer.root.findAll(
    (node) => node.type === "Text" && node.props.children === text,
  ).length
}

describe("SelectionBar (R19, KTD15)", () => {
  it("shows the selected reference in the shown translation's numbers", async () => {
    const { renderer } = await render()
    expect(textCount(renderer, REFERENCE)).toBe(1)
    const [heading] = renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityLabel ===
          READER_COPY.selection.selected(REFERENCE),
    )
    expect(heading).toBeDefined()
  })

  it("copies to the clipboard the same text that Share sends", async () => {
    const share = jest
      .spyOn(Share, "share")
      .mockResolvedValue({ action: Share.sharedAction })
    const { renderer } = await render()
    await pressLabel(renderer, READER_COPY.selection.copyLabel(REFERENCE))
    await pressLabel(renderer, READER_COPY.selection.shareLabel(REFERENCE))
    expect(setString).toHaveBeenCalledTimes(1)
    expect(share).toHaveBeenCalledTimes(1)
    const copied = setString.mock.calls[0]?.[0]
    expect(copied).toBe(TEXT)
    expect(share.mock.calls[0]?.[0]).toMatchObject({ message: copied })
  })

  it("says Copied after a copy, then goes back", async () => {
    jest.useFakeTimers()
    const { renderer } = await render()
    await pressLabel(renderer, READER_COPY.selection.copyLabel(REFERENCE))
    expect(textCount(renderer, READER_COPY.selection.copied)).toBe(1)
    expect(textCount(renderer, READER_COPY.selection.copy)).toBe(0)
    expect(announcements).toContain(READER_COPY.selection.copied)
    await act(async () => {
      jest.advanceTimersByTime(SELECTION_COPIED_MS)
    })
    expect(textCount(renderer, READER_COPY.selection.copied)).toBe(0)
    expect(textCount(renderer, READER_COPY.selection.copy)).toBe(1)
  })

  it("does not say Copied when the clipboard refuses the text", async () => {
    setString.mockImplementation(async () => false)
    const { renderer } = await render()
    await pressLabel(renderer, READER_COPY.selection.copyLabel(REFERENCE))
    expect(textCount(renderer, READER_COPY.selection.copied)).toBe(0)
    expect(announcements).not.toContain(READER_COPY.selection.copied)
  })

  it("forgets Copied when the selection changes", async () => {
    const { renderer, props } = await render()
    await pressLabel(renderer, READER_COPY.selection.copyLabel(REFERENCE))
    expect(textCount(renderer, READER_COPY.selection.copied)).toBe(1)
    await act(async () => {
      renderer.update(
        <StrictMode>
          <SelectionBar {...props} reference="John 3:16" text="Other text" />
        </StrictMode>,
      )
    })
    expect(textCount(renderer, READER_COPY.selection.copied)).toBe(0)
  })

  it("swallows a dismissed share sheet", async () => {
    jest.spyOn(Share, "share").mockRejectedValue(new Error("dismissed"))
    const { renderer } = await render()
    await pressLabel(renderer, READER_COPY.selection.shareLabel(REFERENCE))
    // A rejection that escaped would fail the suite as unhandled.
    await act(async () => {
      await Promise.resolve()
    })
  })

  it("clears the selection from its Clear button", async () => {
    const { renderer, onClear } = await render()
    await pressLabel(renderer, READER_COPY.selection.clearLabel)
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("gives Copy, Share, and Clear a label and a 44 x 44 target (R36)", async () => {
    const { renderer } = await render()
    const controls = buttons(renderer)
    expect(controls).toHaveLength(3)
    for (const control of controls) {
      expect(
        String(control.props.accessibilityLabel ?? "").length,
      ).toBeGreaterThan(0)
      const style = flat(control)
      expect(Number(style.minWidth ?? style.width)).toBeGreaterThanOrEqual(
        READER_TOUCH_TARGET,
      )
      expect(Number(style.minHeight ?? style.height)).toBeGreaterThanOrEqual(
        READER_TOUCH_TARGET,
      )
    }
  })

  it.each<ReaderLayout>(["phone", "tablet"])(
    "takes the %s footer's exact height, so the verse box does not move",
    async (layout) => {
      const { renderer } = await render({ layout, bottomInset: 34 })
      const [bar] = renderer.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props.testID === "bible-selection-bar",
      )
      expect(flat(bar!).height).toBe(readerFooterHeight(layout) + 34)
    },
  )
})
