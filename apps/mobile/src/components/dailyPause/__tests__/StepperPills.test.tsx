// The stepper (R11 of the 2026-10-02 plan; R6-R10, KTD1, KTD2 of the v2 plan).
// Jest cannot move a native animation, so these tests pin the start of a step,
// its end under Reduce Motion, and the run that a pill tap starts.
import { StrictMode, act, type ReactElement } from "react"
import {
  AccessibilityInfo,
  Animated,
  AppState,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from "react-native"

import { DEVOTIONALS } from "../../../lib/dailyPause/devotionals"
import { pauseColors } from "../../../lib/dailyPause/theme"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { advance, pauseTestFont as font } from "../../../test-utils/dailyPause"
import { PAUSE_INTRO_MS } from "../PauseIntro"
import { PrayScreen } from "../PrayScreen"
import { ReflectScreen } from "../ReflectScreen"
import {
  StepperPills,
  stepperArrivalMs,
  type StepperStage,
} from "../StepperPills"

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))

let renderer: TestInstance | null = null

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 5, 7, 0) })
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(false)
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((() => ({ remove: () => {} })) as never)
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  jest.restoreAllMocks()
  jest.useRealTimers()
})

async function mount(element: ReactElement) {
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  await act(async () => {})
  return renderer!
}

async function render(arrival: StepperStage) {
  return mount(<StepperPills arrival={arrival} font={font} />)
}

async function reduceMotion() {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true)
}

function byId(testID: string): RenderedNode {
  const [found] = renderer!.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  )
  if (!found) throw new Error(`no view "${testID}"`)
  return found
}

function style(testID: string): ViewStyle {
  return StyleSheet.flatten(byId(testID).props.style as ViewStyle)
}

function opacity(testID: string): number {
  return Number(style(testID).opacity ?? 1)
}

/** How far a line has drawn, from its fill's scale. */
function scaleY(testID: string): number {
  const transform = (style(`${testID}-fill`).transform ??
    []) as unknown as Record<string, number>[]
  const entry = transform.find((one) => "scaleY" in one)
  return Number(entry?.scaleY ?? 1)
}

/** The look that shows: the layer at full opacity. */
function look(stage: string): string {
  const shown = ["active", "done", "upcoming"].filter(
    (one) => opacity(`stepper-${stage}-${one}`) === 1,
  )
  if (shown.length !== 1) throw new Error(`${stage} shows ${shown.join(",")}`)
  return shown[0]!
}

function labels(): string[] {
  return renderer!.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessible === true &&
        typeof node.props.accessibilityLabel === "string",
    )
    .map((node) => node.props.accessibilityLabel as string)
}

const STAGES = ["watch", "reflect", "pray"]

/** The host view of the pill button that reads this label. */
function button(label: string): RenderedNode {
  const [found] = renderer!.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label,
  )
  if (!found) throw new Error(`no button "${label}"`)
  return found
}

/** Each text under the view with this testID, with its style. */
function textsIn(testID: string): { text: unknown; style: TextStyle }[] {
  const holder = byId(testID)
  return renderer!.root
    .findAll((node) => {
      if (node.type !== "Text") return false
      for (let up = node.parent; up; up = up.parent) {
        if (up === holder) return true
      }
      return false
    })
    .map((node) => ({
      text: node.props.children,
      style: StyleSheet.flatten(node.props.style as TextStyle),
    }))
}

/** The arrival runs that the stepper starts, in order, each with its clock.
 *  The clock stays in JS, so a test can move it with setValue. */
let runs: Animated.Value[] = []

function fakeArrivalRuns() {
  runs = []
  const arrivals = new Set(
    (["watch", "reflect", "pray"] as const).map(stepperArrivalMs),
  )
  const timing = Animated.timing
  jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
    if (!arrivals.has(config.duration ?? -1)) return timing(value, config)
    return {
      start: () => runs.push(value as Animated.Value),
      stop: () => {},
      reset: () => {},
    } as unknown as Animated.CompositeAnimation
  })
}

const onContinue = jest.fn()

type SelectSection = (section: StepperStage) => void

const SCREENS: {
  name: string
  element: (onSelectSection?: SelectSection) => React.ReactElement
  previous: string
  previousStage: StepperStage
}[] = [
  {
    name: "Reflect",
    element: (onSelectSection) => (
      <ReflectScreen
        devotional={DEVOTIONALS.pharisee}
        meditationLength={3}
        font={font}
        onContinue={onContinue}
        onSelectSection={onSelectSection}
      />
    ),
    previous: "Watch, done",
    previousStage: "watch",
  },
  {
    name: "Pray",
    element: (onSelectSection) => (
      <PrayScreen
        devotional={DEVOTIONALS.pharisee}
        meditationLength={3}
        font={font}
        onContinue={onContinue}
        onSelectSection={onSelectSection}
      />
    ),
    previous: "Reflect, done",
    previousStage: "reflect",
  },
]

describe("the end state of each arrival step (Reduce Motion)", () => {
  it.each<[StepperStage, string[], string[], number[]]>([
    [
      "watch",
      ["Watch, current step", "Reflect, upcoming", "Pray, upcoming"],
      ["active", "upcoming", "upcoming"],
      [1, 0, 0],
    ],
    [
      "reflect",
      ["Watch, done", "Reflect, current step", "Pray, upcoming"],
      ["done", "active", "upcoming"],
      [1, 1, 0],
    ],
    [
      "pray",
      ["Watch, done", "Reflect, done", "Pray, current step"],
      ["done", "done", "active"],
      [1, 1, 1],
    ],
  ])(
    "after the %s step, shows the pills, the lines, and the top node lit up to it",
    async (arrival, spoken, looks, lines) => {
      await reduceMotion()
      await render(arrival)

      expect(labels()).toEqual(spoken)
      expect(STAGES.map(look)).toEqual(looks)
      expect([0, 1, 2].map((i) => scaleY(`stepper-line-${i}`))).toEqual(lines)
      expect(opacity("stepper-node-top-fill")).toBe(1)
    },
  )

  // The owner (2026-10-06) found the bottom node strange, floating below PRAY.
  it("ends the path at PRAY, with no line below it and no bottom node", async () => {
    await reduceMotion()
    await render("pray")
    const ids = renderer!.root
      .findAll(
        (node) =>
          typeof node.type === "string" &&
          typeof node.props.testID === "string" &&
          /^stepper-(node|line)-[a-z0-9]+$/.test(node.props.testID),
      )
      .map((node) => node.props.testID as string)
    expect(ids).toEqual([
      "stepper-node-top",
      "stepper-line-0",
      "stepper-line-1",
      "stepper-line-2",
    ])
  })

  it("gives each look its Figma fill", async () => {
    await reduceMotion()
    await render("reflect")
    expect(style("stepper-watch-done")).toMatchObject({
      backgroundColor: pauseColors.raised,
    })
    expect(style("stepper-reflect-active")).toMatchObject({
      backgroundColor: pauseColors.ink,
    })
    expect(style("stepper-pray-upcoming")).toMatchObject({
      backgroundColor: pauseColors.background,
      borderColor: pauseColors.pillBorder,
    })
  })

  // The owner (2026-10-06) saw a seam between the fill and the outline. The
  // lit disc now has the outline's own outer edge, so no inner edge is left.
  it("draws a lit node as one disc over the outline, edge to edge", async () => {
    await reduceMotion()
    await render("watch")
    const node = "stepper-node-top"
    expect(style(node).borderWidth ?? 0).toBe(0)
    expect(style(`${node}-fill`)).toMatchObject({
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: Number(style(node).width) / 2,
      backgroundColor: pauseColors.ink,
    })
  })

  it("hides the nodes and the lines from VoiceOver", async () => {
    await reduceMotion()
    await render("watch")
    for (const testID of ["stepper-node-top", "stepper-line-0"]) {
      expect(byId(testID).props.importantForAccessibility).toBe(
        "no-hide-descendants",
      )
      expect(byId(testID).props.accessibilityElementsHidden).toBe(true)
    }
  })
})

describe("the start of each arrival step (motion on)", () => {
  it("starts the Watch step from an unlit top node, no line, and WATCH unlit", async () => {
    await render("watch")
    expect(opacity("stepper-node-top-fill")).toBe(0)
    expect(scaleY("stepper-line-0")).toBe(0)
    expect(look("watch")).toBe("upcoming")
  })

  it("starts the Reflect step from WATCH lit and no line to REFLECT", async () => {
    await render("reflect")
    expect(opacity("stepper-node-top-fill")).toBe(1)
    expect(scaleY("stepper-line-0")).toBe(1)
    expect(scaleY("stepper-line-1")).toBe(0)
    expect(STAGES.map(look)).toEqual(["active", "upcoming", "upcoming"])
  })
})

describe("one pill width (R6, KTD2)", () => {
  it("sizes every pill from REFLECT in both wide looks", async () => {
    await render("reflect")
    const widest = [
      ...textsIn("stepper-reflect-active"),
      ...textsIn("stepper-reflect-done"),
    ]
    expect(widest.map(({ text }) => text)).toEqual(["REFLECT", "✓", "REFLECT"])
    for (const stage of STAGES) {
      expect(textsIn(`stepper-${stage}-sizer`)).toEqual(widest)
      for (const one of ["active", "done"]) {
        expect(style(`stepper-${stage}-sizer-${one}`).paddingHorizontal).toBe(
          style(`stepper-reflect-${one}`).paddingHorizontal,
        )
      }
      expect(style(`stepper-${stage}-sizer`).opacity).toBe(0)
      expect(
        byId(`stepper-${stage}-sizer`).props.importantForAccessibility,
      ).toBe("no-hide-descendants")
    }
  })

  it("stretches each look over the sizer, with the label centered", async () => {
    await render("reflect")
    for (const stage of STAGES) {
      for (const one of ["upcoming", "done", "active"]) {
        expect(style(`stepper-${stage}-${one}`)).toMatchObject({
          position: "absolute",
          left: 0,
          right: 0,
          justifyContent: "center",
        })
      }
    }
  })
})

describe("the pill buttons (R10)", () => {
  it("makes each pill a button that says its state, with a target at least 44 pt tall", async () => {
    await mount(
      <StepperPills arrival="reflect" font={font} onSelect={() => {}} />,
    )
    const spoken = ["Watch, done", "Reflect, current step", "Pray, upcoming"]
    for (const label of spoken) {
      const target = StyleSheet.flatten(button(label).props.style as ViewStyle)
      expect(Number(target.height)).toBeGreaterThanOrEqual(44)
    }
    for (const label of ["Watch, done", "Pray, upcoming"]) {
      expect(typeof pressableByLabel(renderer!, label).props.onPress).toBe(
        "function",
      )
    }
    expect(labels()).toEqual(spoken)
  })

  // A pressed look on a layer that a native clock drives does not show on iOS.
  it("dims a pressed pill on its button, not on its looks", async () => {
    await mount(
      <StepperPills arrival="reflect" font={font} onSelect={() => {}} />,
    )
    const pressable = pressableByLabel(renderer!, "Watch, done")
    const pressedStyle = pressable.props.style as (state: {
      pressed: boolean
    }) => ViewStyle
    expect(
      StyleSheet.flatten(pressedStyle({ pressed: true })).opacity,
    ).toBeLessThan(1)
    expect(
      StyleSheet.flatten(pressedStyle({ pressed: false })).opacity,
    ).toBeUndefined()
  })
})

// The owner, 2026-10-09: a tap on another pill opens the start of that
// section, and the current pill takes no tap and replays nothing.
describe("a pill tap", () => {
  const onSelect = jest.fn()

  beforeEach(() => {
    fakeArrivalRuns()
    onSelect.mockClear()
  })

  async function renderWith(arrival: StepperStage) {
    return mount(
      <StepperPills arrival={arrival} font={font} onSelect={onSelect} />,
    )
  }

  it("asks for another section at a tap on its pill, back or ahead, and starts no new run", async () => {
    await renderWith("reflect")
    const before = runs.length
    await press(pressableByLabel(renderer!, "Watch, done"))
    await press(pressableByLabel(renderer!, "Pray, upcoming"))
    expect(onSelect.mock.calls).toEqual([["watch"], ["pray"]])
    expect(runs.length).toBe(before)
  })

  it("does nothing at a tap on the current pill: no run, no section, and the look stays", async () => {
    await renderWith("reflect")
    const before = runs.length
    act(() => runs[before - 1]!.setValue(1))
    const current = button("Reflect, current step")
    expect(current.props.accessibilityState).toMatchObject({ disabled: true })
    const pressables = renderer!.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Reflect, current step" &&
        typeof node.props.onPress === "function",
    )
    expect(pressables.length).toBe(0)
    // A press that reaches the button anyway changes nothing.
    await act(async () => {
      ;(current.props.onPress as (() => void) | undefined)?.()
    })
    expect(onSelect).not.toHaveBeenCalled()
    expect(runs.length).toBe(before)
    expect(STAGES.map(look)).toEqual(["done", "active", "upcoming"])
  })

  // The first screen gives no onSelect, so none of its pills takes a tap.
  it("takes no tap on any pill without onSelect, and VoiceOver reads each as dimmed", async () => {
    await render("watch")
    const spoken = [
      "Watch, current step",
      "Reflect, upcoming",
      "Pray, upcoming",
    ]
    const tappable = renderer!.root.findAll(
      (node) =>
        spoken.includes(node.props.accessibilityLabel as string) &&
        typeof node.props.onPress === "function",
    )
    expect(tappable.length).toBe(0)
    for (const label of spoken) {
      expect(button(label).props.accessibilityState).toMatchObject({
        disabled: true,
      })
      expect(button(label).props.accessibilityHint).toBeUndefined()
    }
  })

  it("tells VoiceOver where another pill goes, and gives the current pill no hint", async () => {
    await renderWith("watch")
    expect(
      ["Watch, current step", "Reflect, upcoming", "Pray, upcoming"].map(
        (label) => button(label).props.accessibilityHint ?? null,
      ),
    ).toEqual([
      null,
      "Goes to the start of the Reflect section",
      "Goes to the start of the Pray section",
    ])
  })

  it("asks once per tap under StrictMode", async () => {
    await mount(
      <StrictMode>
        <StepperPills arrival="pray" font={font} onSelect={onSelect} />
      </StrictMode>,
    )
    await press(pressableByLabel(renderer!, "Watch, done"))
    expect(onSelect.mock.calls).toEqual([["watch"]])
  })

  it("keeps the end state under Reduce Motion and still opens another section", async () => {
    await reduceMotion()
    await renderWith("reflect")
    const before = runs.length
    const setValue = jest.spyOn(Animated.Value.prototype, "setValue")
    await press(pressableByLabel(renderer!, "Pray, upcoming"))
    expect(onSelect.mock.calls).toEqual([["pray"]])
    expect(runs.length).toBe(before)
    expect(setValue.mock.calls.length).toBe(0)
    expect(STAGES.map(look)).toEqual(["done", "active", "upcoming"])
  })

  describe.each(SCREENS)("on the $name screen", (screen) => {
    it("passes a tap on an earlier pill to onSelectSection, during the intro too", async () => {
      await mount(<StrictMode>{screen.element(onSelect)}</StrictMode>)
      advance(Math.floor(PAUSE_INTRO_MS / 2))
      await press(pressableByLabel(renderer!, screen.previous))
      expect(onSelect.mock.calls).toEqual([[screen.previousStage]])
    })
  })
})
