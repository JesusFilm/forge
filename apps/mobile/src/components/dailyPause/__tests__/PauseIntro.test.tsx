// The Reflect and Pray intro (the owner, 2026-10-06): the stepper starts at
// the center of the screen and moves up, then the content shows and the pause
// timer starts. Jest cannot move a native animation, so these tests pin the
// start, the end under Reduce Motion, and the timer's own clock.
import { StrictMode, act } from "react"
import {
  AppState,
  Dimensions,
  StyleSheet,
  type AppStateStatus,
  type ViewStyle,
} from "react-native"

import { DEVOTIONALS } from "../../../lib/dailyPause/devotionals"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { advance, pauseTestFont as font } from "../../../test-utils/dailyPause"
import { PAUSE_INTRO_MS } from "../PauseIntro"
import { PrayScreen } from "../PrayScreen"
import { ReflectScreen } from "../ReflectScreen"

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))
let mockReduceMotion = false
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockReduceMotion,
}))

/** iPhone 17 Pro, in points. */
const WINDOW = { width: 402, height: 874, scale: 3, fontScale: 1 }
/** The body is 874 - 62 - 36 = 776 tall, and the stepper is 220 tall. */
const CENTERED_SHIFT = (776 - 220) / 2

let renderer: TestInstance | null = null

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 5, 7, 0) })
  Dimensions.set({ window: WINDOW, screen: WINDOW })
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(((
      _event: string,
      _handler: (state: AppStateStatus) => void,
    ) => ({ remove: () => {} })) as never)
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  mockReduceMotion = false
  jest.restoreAllMocks()
  jest.useRealTimers()
})

const SCREENS = [
  {
    name: "Reflect",
    element: () => (
      <ReflectScreen
        devotional={DEVOTIONALS.pharisee}
        meditationLength={3}
        font={font}
        onContinue={() => {}}
      />
    ),
    timer: (root: TestInstance) =>
      labelsOf(root).find((label) => label.startsWith("Continue")),
    full: "Continue, 45 seconds left",
    oneDown: "Continue, 44 seconds left",
  },
  {
    name: "Pray",
    element: () => (
      <PrayScreen
        devotional={DEVOTIONALS.pharisee}
        meditationLength={3}
        font={font}
        onContinue={() => {}}
      />
    ),
    timer: (root: TestInstance) =>
      labelsOf(root).find((label) => label.endsWith("left")),
    full: "30 seconds left",
    oneDown: "29 seconds left",
  },
]

async function render(screen: (typeof SCREENS)[number]) {
  await act(async () => {
    renderer = TestRenderer.create(<StrictMode>{screen.element()}</StrictMode>)
  })
  await act(async () => {})
  return renderer!
}

function labelsOf(root: TestInstance): string[] {
  return root.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.accessibilityLabel === "string",
    )
    .map((node) => node.props.accessibilityLabel as string)
}

function hosts(root: TestInstance, testID: string): RenderedNode[] {
  return root.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  )
}

function style(node: RenderedNode): ViewStyle {
  return StyleSheet.flatten(node.props.style as ViewStyle)
}

function translateY(node: RenderedNode): number {
  const transform = (style(node).transform ?? []) as unknown as Record<
    string,
    number
  >[]
  return Number(transform.find((one) => "translateY" in one)?.translateY ?? 0)
}

function stepperShift(root: TestInstance): number {
  const [stepper] = hosts(root, "pause-intro-stepper")
  return translateY(stepper!)
}

/** The verse or prayer group. */
function content(root: TestInstance): RenderedNode {
  const found = hosts(root, "pause-intro-content")
  expect(found).toHaveLength(1)
  return found[0]!
}

/** The button below the scroll view. It may be Liquid Glass, so a cover
 *  fades off it and its own opacity never moves. */
function buttonRow(root: TestInstance): { row: RenderedNode; cover: number } {
  const [row] = hosts(root, "pause-intro-covered")
  const [cover] = hosts(root, "pause-intro-cover")
  return { row: row!, cover: Number(style(cover!).opacity) }
}

describe.each(SCREENS)("the $name screen", (screen) => {
  it("starts the stepper at the center of the screen, with the content hidden", async () => {
    const root = await render(screen)
    expect(stepperShift(root)).toBe(CENTERED_SHIFT)
    const { row, cover } = buttonRow(root)
    expect(style(content(root)).opacity).toBe(0)
    expect(cover).toBe(1)
    expect(style(row).opacity).toBeUndefined()
    for (const hidden of [content(root), row]) {
      expect(hidden.props.accessibilityElementsHidden).toBe(true)
      expect(hidden.props.importantForAccessibility).toBe("no-hide-descendants")
    }
  })

  it("keeps the stepper inside a scroll view too short for the center", async () => {
    const root = await render(screen)
    const [scroll] = root.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.onLayout === "function" &&
        node.props.contentContainerStyle != null,
    )
    const onLayout = scroll!.props.onLayout as (event: {
      nativeEvent: { layout: { height: number } }
    }) => void
    act(() => {
      onLayout({ nativeEvent: { layout: { height: 300 } } })
    })
    expect(stepperShift(root)).toBe(300 - 220)
  })

  it("holds the pause timer until the content shows, then starts it", async () => {
    const root = await render(screen)
    advance(PAUSE_INTRO_MS - 1)
    expect(screen.timer(root)).toBe(screen.full)
    expect(content(root).props.accessibilityElementsHidden).toBe(true)
    advance(1)
    advance(999)
    expect(screen.timer(root)).toBe(screen.full)
    expect(content(root).props.accessibilityElementsHidden).toBe(false)
    expect(buttonRow(root).row.props.accessibilityElementsHidden).toBe(false)
    advance(1)
    expect(screen.timer(root)).toBe(screen.oneDown)
  })

  it("under Reduce Motion, shows the end at once and starts the timer", async () => {
    mockReduceMotion = true
    const root = await render(screen)
    expect(stepperShift(root)).toBe(0)
    expect(style(content(root)).opacity).toBe(1)
    expect(buttonRow(root).cover).toBe(0)
    for (const shown of [content(root), buttonRow(root).row]) {
      expect(shown.props.accessibilityElementsHidden).toBe(false)
    }
    advance(1000)
    expect(screen.timer(root)).toBe(screen.oneDown)
  })
})
