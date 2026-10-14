// The section markers of the video parts (v2 plan R2-R5, AE1, KTD4). A tap on
// another marker opens its section, and the current marker takes no tap (the
// owner, 2026-10-09 and 2026-10-12). Jest moves a fake clock by hand.
import { StrictMode, act, type ReactElement } from "react"
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Dimensions,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import { pauseColors } from "../../../lib/dailyPause/theme"
import { pauseTestFont as font } from "../../../test-utils/dailyPause"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { CLOSE_RIGHT_EDGE } from "../CloseButton"
import {
  MARKER_ARRIVAL_MS,
  MARKER_CLOSE_CLEARANCE,
  MARKER_GAP,
  MARKER_MAX_SCALE,
  SectionMarkers,
} from "../SectionMarkers"
import type { StepperStage } from "../StepperPills"

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))

let renderer: TestInstance | null = null

/** The arrival runs the row starts, in order. Each clock stays in JS, so a
 *  test can move it with setValue. */
let runs: Animated.Value[] = []

beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((() => ({ remove: () => {} })) as never)
  runs = []
  const timing = Animated.timing
  jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
    if (config.duration !== MARKER_ARRIVAL_MS) return timing(value, config)
    return {
      start: () => runs.push(value as Animated.Value),
      stop: () => {},
      reset: () => {},
    } as unknown as Animated.CompositeAnimation
  })
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  jest.restoreAllMocks()
})

async function mountElement(element: ReactElement) {
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  await act(async () => {})
}

const onSelect = jest.fn()

async function mount(section: StepperStage) {
  onSelect.mockClear()
  await mountElement(
    <SectionMarkers section={section} font={font} onSelect={onSelect} />,
  )
}

async function reduceMotion() {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true)
}

function hosts(test: (node: RenderedNode) => boolean): RenderedNode[] {
  return renderer!.root.findAll(
    (node) => typeof node.type === "string" && test(node),
  )
}

function byId(testID: string): RenderedNode {
  const [found] = hosts((node) => node.props.testID === testID)
  if (!found) throw new Error(`no view "${testID}"`)
  return found
}

function has(testID: string): boolean {
  return hosts((node) => node.props.testID === testID).length > 0
}

function style(testID: string): ViewStyle & TextStyle {
  return StyleSheet.flatten(byId(testID).props.style as ViewStyle & TextStyle)
}

function opacity(testID: string): number {
  return Number(style(testID).opacity ?? 1)
}

/** How far the line has drawn, from its fill's scale. */
function lineDrawn(): number {
  const transform = (style("section-markers-line-fill").transform ??
    []) as unknown as Record<string, number>[]
  const entry = transform.find((one) => "scaleX" in one)
  return Number(entry?.scaleX ?? 1)
}

/** Each marker button, left to right. */
function markerButtons(): RenderedNode[] {
  return hosts((node) => node.props.accessibilityRole === "button")
}

/** The labels that show in gold, at full opacity. */
function litGold(): string[] {
  return hosts((node) => node.type === "Text")
    .filter(
      (node) =>
        StyleSheet.flatten(node.props.style as TextStyle).color ===
          pauseColors.accent &&
        Number(StyleSheet.flatten(node.props.style as TextStyle).opacity) === 1,
    )
    .map((node) => node.props.children as string)
}

async function layOut(label: string, x: number, width: number) {
  const [marker] = hosts((node) => node.props.accessibilityLabel === label)
  const onLayout = marker!.props.onLayout as
    | ((event: { nativeEvent: { layout: object } }) => void)
    | undefined
  await act(async () => {
    onLayout?.({ nativeEvent: { layout: { x, y: 0, width, height: 44 } } })
  })
}

describe("the arrival", () => {
  it("starts with no line and REFLECT plain, then draws the line and lights REFLECT gold (AE1)", async () => {
    await mount("reflect")
    expect(runs.length).toBe(1)
    expect(lineDrawn()).toBe(0)
    expect(opacity("section-marker-reflect-plain")).toBe(1)
    expect(opacity("section-marker-reflect-gold")).toBe(0)
    expect(litGold()).toEqual([])

    act(() => runs[0]!.setValue(1))
    expect(lineDrawn()).toBe(1)
    expect(opacity("section-marker-reflect-plain")).toBe(0)
    expect(litGold()).toEqual(["REFLECT"])
  })

  it.each<[StepperStage, string]>([
    ["watch", "WATCH"],
    ["pray", "PRAY"],
  ])("lights only the %s marker gold (R3)", async (section, gold) => {
    await mount(section)
    act(() => runs[0]!.setValue(1))
    expect(litGold()).toEqual([gold])
    for (const stage of ["watch", "reflect", "pray"]) {
      expect(has(`section-marker-${stage}-gold`)).toBe(stage === section)
    }
  })

  it("runs the line from the left edge of WATCH to the right edge of the current marker", async () => {
    await mount("reflect")
    expect(style("section-markers-line").width).toBe(0)
    expect(style("section-markers-line").left).toBe(0)
    await layOut("Reflect section", 96, 84)
    expect(style("section-markers-line").width).toBe(180)
    // Only the current marker measures, so another layout moves nothing.
    await layOut("Watch section", 0, 60)
    expect(style("section-markers-line").width).toBe(180)
  })

  it("keeps the line inside the row, below the text", async () => {
    await mount("pray")
    const row = style("section-markers")
    const line = style("section-markers-line")
    expect(line.bottom).toBeGreaterThan(0)
    expect(Number(line.bottom) + Number(line.height)).toBeLessThan(
      Number(row.height) / 2,
    )
  })

  it("shows the end state at once under Reduce Motion", async () => {
    await reduceMotion()
    await mount("pray")
    expect(lineDrawn()).toBe(1)
    expect(litGold()).toEqual(["PRAY"])
  })
})

describe("the marker buttons", () => {
  it.each<[StepperStage, string]>([
    ["watch", "Watch section"],
    ["reflect", "Reflect section"],
    ["pray", "Pray section"],
  ])(
    "makes each marker a button, and marks only the %s marker selected and dimmed",
    async (section, current) => {
      await mount(section)
      expect(
        markerButtons().map((node) => {
          const state = node.props.accessibilityState as {
            selected?: boolean
            disabled?: boolean
          }
          return [node.props.accessibilityLabel, state.selected, state.disabled]
        }),
      ).toEqual(
        ["Watch section", "Reflect section", "Pray section"].map((label) => [
          label,
          label === current,
          label === current,
        ]),
      )
    },
  )

  it("gives each marker a target as tall as the close's", async () => {
    await mount("reflect")
    for (const node of markerButtons()) {
      const height = StyleSheet.flatten(
        typeof node.props.style === "function"
          ? node.props.style({ pressed: false })
          : (node.props.style as ViewStyle),
      ).height
      expect(height).toBe(44)
    }
  })

  // A tap off the markers must still reach the video's pause button under it.
  it("passes a touch off the markers through to the video", async () => {
    await mount("reflect")
    expect(byId("section-markers").props.pointerEvents).toBe("box-none")
    expect(byId("section-markers-group").props.pointerEvents).toBe("box-none")
    expect(byId("section-markers-line").props.pointerEvents).toBe("none")
  })

  it("hides the line from VoiceOver", async () => {
    await mount("reflect")
    expect(byId("section-markers-line").props).toMatchObject({
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    })
  })

  it("caps the text scale of every marker", async () => {
    await mount("reflect")
    expect(MARKER_MAX_SCALE).toBeGreaterThan(1)
    expect(Number.isFinite(MARKER_MAX_SCALE)).toBe(true)
    const caps = hosts((node) => node.type === "Text").map(
      (node) => node.props.maxFontSizeMultiplier,
    )
    expect(caps.length).toBeGreaterThanOrEqual(3)
    expect(new Set(caps)).toEqual(new Set([MARKER_MAX_SCALE]))
  })
})

describe("a marker tap", () => {
  it("opens another section: a tap on PRAY or WATCH asks for that section, and the row does not replay", async () => {
    await mount("reflect")
    act(() => runs[0]!.setValue(1))
    await press(pressableByLabel(renderer!, "Pray section"))
    await press(pressableByLabel(renderer!, "Watch section"))
    expect(onSelect.mock.calls).toEqual([["pray"], ["watch"]])
    expect(runs.length).toBe(1)
    expect(litGold()).toEqual(["REFLECT"])
  })

  // Before 2026-10-12 a tap on the current marker played the arrival again.
  it("takes no tap on the current marker: no section, no new run, and the light stays", async () => {
    await mount("reflect")
    act(() => runs[0]!.setValue(1))
    const tappable = renderer!.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Reflect section" &&
        typeof node.props.onPress === "function",
    )
    expect(tappable.length).toBe(0)
    const pressables = renderer!.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Reflect section" &&
        node.props.disabled === true,
    )
    expect(pressables.length).toBeGreaterThan(0)
    expect(onSelect).not.toHaveBeenCalled()
    expect(runs.length).toBe(1)
    expect(lineDrawn()).toBe(1)
    expect(litGold()).toEqual(["REFLECT"])
  })

  it("tells a screen reader where another marker goes, and gives the current marker no hint", async () => {
    await mount("watch")
    expect(
      markerButtons().map((node) => node.props.accessibilityHint ?? null),
    ).toEqual([
      null,
      "Plays the Reflect part of the video",
      "Plays the Pray part of the video",
    ])
  })

  it("opens another section once per tap under StrictMode", async () => {
    await mountElement(
      <StrictMode>
        <SectionMarkers section="pray" font={font} onSelect={onSelect} />
      </StrictMode>,
    )
    await press(pressableByLabel(renderer!, "Watch section"))
    expect(onSelect.mock.calls).toEqual([["watch"]])
  })

  it("keeps the end state at a tap under Reduce Motion, with no run, and still opens another section", async () => {
    await reduceMotion()
    await mount("watch")
    const before = runs.length
    const setValue = jest.spyOn(Animated.Value.prototype, "setValue")
    for (const label of ["Reflect section", "Pray section"]) {
      await press(pressableByLabel(renderer!, label))
    }
    expect(runs.length).toBe(before)
    expect(setValue.mock.calls.length).toBe(0)
    expect(lineDrawn()).toBe(1)
    expect(litGold()).toEqual(["WATCH"])
    expect(onSelect.mock.calls).toEqual([["reflect"], ["pray"]])
  })
})

// The owner, 2026-10-14: wider gaps between WATCH, REFLECT, and PRAY.
describe("the row's spacing", () => {
  const DEFAULT_WINDOW = Dimensions.get("window")
  const DEFAULT_SCREEN = Dimensions.get("screen")
  afterEach(() => {
    Dimensions.set({ window: DEFAULT_WINDOW, screen: DEFAULT_SCREEN })
  })

  function setWindow(width: number, fontScale: number) {
    const window = { width, height: 874, scale: 3, fontScale }
    Dimensions.set({ window, screen: window })
  }

  function groupStyle(): ViewStyle {
    return StyleSheet.flatten(
      byId("section-markers-group").props.style as ViewStyle,
    )
  }

  it("spaces the markers wider than before at the default text size", async () => {
    setWindow(402, 1)
    await mount("watch")
    expect(MARKER_GAP).toBeGreaterThan(24)
    expect(groupStyle().justifyContent).toBe("space-between")
    // The three labels plus two full gaps fit on an iPhone 17.
    const width = groupStyle().width as number
    expect(width).toBeGreaterThan(156 + 2 * 24)
    expect((402 - width) / 2).toBeGreaterThanOrEqual(
      CLOSE_RIGHT_EDGE + MARKER_CLOSE_CLEARANCE,
    )
  })

  it("keeps WATCH clear of the close on a narrow phone with the largest text", async () => {
    setWindow(375, 3)
    await mount("watch")
    const width = groupStyle().width as number
    // The row is centred, so its left edge is half the space left over.
    expect((375 - width) / 2).toBeGreaterThanOrEqual(
      CLOSE_RIGHT_EDGE + MARKER_CLOSE_CLEARANCE,
    )
    // The labels themselves still fit: 156 points at the 1.3 text cap.
    expect(width).toBeGreaterThanOrEqual(156 * MARKER_MAX_SCALE)
  })
})
