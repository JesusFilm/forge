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

/** Every layer that a native clock drives. */
const LAYERS = [
  "stepper-node-top-fill",
  "stepper-line-0-fill",
  "stepper-line-1-fill",
  "stepper-line-2-fill",
  ...STAGES.flatMap((stage) =>
    ["upcoming", "done", "active"].map((one) => `stepper-${stage}-${one}`),
  ),
]

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

/** The calls of Animated.Value's setValue that reached one of these clocks. */
function writesTo(
  spy: jest.SpyInstance,
  clocks: readonly Animated.Value[],
): number {
  return spy.mock.contexts.filter((one) =>
    clocks.includes(one as Animated.Value),
  ).length
}

const onContinue = jest.fn()

const SCREENS = [
  {
    name: "Reflect",
    element: () => (
      <ReflectScreen
        devotional={DEVOTIONALS.pharisee}
        meditationLength={3}
        font={font}
        onContinue={onContinue}
      />
    ),
    previous: "Watch, done",
  },
  {
    name: "Pray",
    element: () => (
      <PrayScreen
        devotional={DEVOTIONALS.pharisee}
        meditationLength={3}
        font={font}
        onContinue={onContinue}
      />
    ),
    previous: "Reflect, done",
  },
]

/** The seconds that the screen's countdown says are left. */
function secondsLeft(): number {
  const counts = new Set(
    renderer!.root
      .findAll(
        (node) =>
          typeof node.type === "string" &&
          typeof node.props.accessibilityLabel === "string" &&
          /\d+ seconds? left$/.test(node.props.accessibilityLabel),
      )
      .map((node) =>
        Number(/(\d+) seconds? left$/.exec(node.props.accessibilityLabel!)![1]),
      ),
  )
  if (counts.size !== 1) throw new Error(`counts: ${[...counts].join(",")}`)
  return [...counts][0]!
}

/** True while VoiceOver reaches the content below the stepper. */
function contentShown(): boolean {
  return byId("pause-intro-content").props.accessibilityElementsHidden === false
}

/** True while Continue shows as a dimmed button that takes no tap. */
function continueHeld(): boolean {
  return (
    renderer!.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button" &&
        String(node.props.accessibilityLabel).startsWith("Continue") &&
        (node.props.accessibilityState as { disabled?: boolean } | undefined)
          ?.disabled === true,
    ).length > 0
  )
}

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
    await render("reflect")
    const spoken = ["Watch, done", "Reflect, current step", "Pray, upcoming"]
    for (const label of spoken) {
      const target = StyleSheet.flatten(button(label).props.style as ViewStyle)
      expect(Number(target.height)).toBeGreaterThanOrEqual(44)
      expect(typeof pressableByLabel(renderer!, label).props.onPress).toBe(
        "function",
      )
    }
    expect(labels()).toEqual(spoken)
  })

  // A pressed look on a layer that a native clock drives does not show on iOS.
  it("dims a pressed pill on its button, not on its looks", async () => {
    await render("reflect")
    const pressable = pressableByLabel(renderer!, "Reflect, current step")
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

describe("a pill tap replays the arrival (R7-R9, KTD1)", () => {
  beforeEach(() => {
    fakeArrivalRuns()
  })

  it("replays the top node, the line, and WATCH at a tap on PRAY, and PRAY stays upcoming (AE3)", async () => {
    await render("watch")
    expect(runs.length).toBe(1)
    const first = runs[0]!
    act(() => first.setValue(1))
    expect(opacity("stepper-node-top-fill")).toBe(1)
    expect(scaleY("stepper-line-0")).toBe(1)
    expect(STAGES.map(look)).toEqual(["active", "upcoming", "upcoming"])

    await press(pressableByLabel(renderer!, "Pray, upcoming"))
    expect(runs.length).toBe(2)
    expect(runs[1] === first).toBe(false)
    expect(opacity("stepper-node-top-fill")).toBe(0)
    expect(scaleY("stepper-line-0")).toBe(0)
    expect(STAGES.map(look)).toEqual(["upcoming", "upcoming", "upcoming"])

    act(() => runs[1]!.setValue(1))
    expect(STAGES.map(look)).toEqual(["active", "upcoming", "upcoming"])
    expect(labels()).toEqual([
      "Watch, current step",
      "Reflect, upcoming",
      "Pray, upcoming",
    ])
  })

  it("starts the arrival over at a tap mid-run, on a new clock each time, and writes no old clock", async () => {
    await render("reflect")
    const setValue = jest.spyOn(Animated.Value.prototype, "setValue")
    await press(pressableByLabel(renderer!, "Reflect, current step"))
    await press(pressableByLabel(renderer!, "Watch, done"))
    expect(runs.length).toBe(3)
    expect(new Set(runs).size).toBe(3)
    expect(writesTo(setValue, runs)).toBe(0)
    expect(STAGES.map(look)).toEqual(["active", "upcoming", "upcoming"])
  })

  // iOS keeps a native-driven view's last values, so a replay needs new
  // layers. A new button would lose VoiceOver's focus.
  it("keeps each pill button mounted and draws the replay on new layers", async () => {
    await render("reflect")
    const buttons = ["Watch, done", "Reflect, current step", "Pray, upcoming"]
    const before = buttons.map(button)
    const layers = LAYERS.map(byId)
    await press(pressableByLabel(renderer!, "Pray, upcoming"))
    expect(buttons.filter((label, i) => button(label) !== before[i])).toEqual(
      [],
    )
    expect(LAYERS.filter((id, i) => byId(id) === layers[i])).toEqual([])
  })

  it("starts one new run per tap under StrictMode", async () => {
    await mount(
      <StrictMode>
        <StepperPills arrival="reflect" font={font} />
      </StrictMode>,
    )
    const before = runs.length
    expect(before).toBeGreaterThan(0)
    await press(pressableByLabel(renderer!, "Reflect, current step"))
    expect(runs.length).toBe(before + 1)
    expect(runs.slice(0, before).includes(runs[before]!)).toBe(false)
  })

  it("shows the end state at a tap under Reduce Motion, with no run and no new layers (AE4)", async () => {
    await reduceMotion()
    await render("reflect")
    const before = runs.length
    const layers = LAYERS.map(byId)
    const setValue = jest.spyOn(Animated.Value.prototype, "setValue")
    for (const label of [
      "Watch, done",
      "Reflect, current step",
      "Pray, upcoming",
    ]) {
      await press(pressableByLabel(renderer!, label))
    }
    expect(runs.length).toBe(before)
    expect(setValue.mock.calls.length).toBe(0)
    expect(LAYERS.filter((id, i) => byId(id) !== layers[i])).toEqual([])
    expect(STAGES.map(look)).toEqual(["done", "active", "upcoming"])
    expect([0, 1, 2].map((i) => scaleY(`stepper-line-${i}`))).toEqual([1, 1, 0])
    expect(opacity("stepper-node-top-fill")).toBe(1)
  })

  it("replays REFLECT at a tap on WATCH, and the countdown keeps its count (AE2)", async () => {
    await mount(<StrictMode>{SCREENS[0]!.element()}</StrictMode>)
    advance(PAUSE_INTRO_MS)
    advance(25_000)
    expect(secondsLeft()).toBe(20)
    expect(continueHeld()).toBe(true)
    const before = runs.length
    const first = runs[before - 1]!
    act(() => first.setValue(1))
    expect(STAGES.map(look)).toEqual(["done", "active", "upcoming"])

    await press(pressableByLabel(renderer!, "Watch, done"))
    expect(runs.length).toBe(before + 1)
    expect(runs[before] === first).toBe(false)
    expect(STAGES.map(look)).toEqual(["active", "upcoming", "upcoming"])
    expect(scaleY("stepper-line-1")).toBe(0)
    expect(secondsLeft()).toBe(20)
    expect(continueHeld()).toBe(true)
    advance(1_000)
    expect(secondsLeft()).toBe(19)
    expect(continueHeld()).toBe(true)
  })

  describe.each(SCREENS)("on the $name screen", (screen) => {
    it("keeps the intro and the countdown's start at a tap during the intro (R8)", async () => {
      await mount(<StrictMode>{screen.element()}</StrictMode>)
      const full = secondsLeft()
      const tapAt = Math.floor(PAUSE_INTRO_MS / 2)
      advance(tapAt)
      const before = runs.length
      await press(pressableByLabel(renderer!, screen.previous))
      expect(runs.length).toBe(before + 1)

      advance(PAUSE_INTRO_MS - tapAt - 1)
      expect(contentShown()).toBe(false)
      expect(secondsLeft()).toBe(full)
      advance(1)
      expect(contentShown()).toBe(true)
      advance(999)
      expect(secondsLeft()).toBe(full)
      advance(1)
      expect(secondsLeft()).toBe(full - 1)
    })
  })
})
