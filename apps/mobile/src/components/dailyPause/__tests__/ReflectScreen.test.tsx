// The Reflect screen (U10, R11, R16-R18, R26, R30; v2 plan U2, R11-R15). The
// ring counts the pause down while Continue shows grey and takes no tap. At
// zero the ring fades and Continue turns cream, on Pray's clock (KTD3).
import { StrictMode, act } from "react"
import {
  Animated,
  AppState,
  StyleSheet,
  type AppStateStatus,
  type ViewStyle,
} from "react-native"

import { DEVOTIONALS } from "../../../lib/dailyPause/devotionals"
import type { MeditationLength } from "../../../lib/dailyPause/settings"
import { pauseSpacing } from "../../../lib/dailyPause/theme"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import {
  advance,
  pauseTestFont as font,
  pulses,
} from "../../../test-utils/dailyPause"
import { BUTTON_FROM_MS, FINISH_MS, RING_FADE_MS } from "../PauseFinish"
import { PAUSE_INTRO_MS } from "../PauseIntro"
import { ReflectScreen } from "../ReflectScreen"

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))
// The OS read lands after mount; the hook reads it from the first render here.
let mockReduceMotion = false
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockReduceMotion,
}))

const onContinue = jest.fn()
let renderer: TestInstance | null = null
let handlers: ((state: AppStateStatus) => void)[] = []
/** The fade clock at zero, and its start. Jest cannot move a native
 *  animation, so a stand-in keeps that clock in JS. */
let finishClock: Animated.Value | null = null
let finishStart: jest.Mock

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 5, 7, 0) })
  onContinue.mockReset()
  handlers = []
  finishClock = null
  finishStart = jest.fn()
  const timing = Animated.timing
  jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
    if (config.duration !== FINISH_MS) return timing(value, config)
    expect(config.useNativeDriver).toBe(true)
    finishClock = value as Animated.Value
    return {
      start: finishStart,
      stop: jest.fn(),
      reset: jest.fn(),
    } as unknown as Animated.CompositeAnimation
  })
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _event: string,
    handler: (state: AppStateStatus) => void,
  ) => {
    handlers.push(handler)
    return {
      remove: () => {
        handlers = handlers.filter((one) => one !== handler)
      },
    }
  }) as never)
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  jest.restoreAllMocks()
  jest.useRealTimers()
})

async function render(
  meditationLength: MeditationLength = 3,
  devotional = DEVOTIONALS.pharisee,
): Promise<TestInstance> {
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <ReflectScreen
          devotional={devotional}
          meditationLength={meditationLength}
          font={font}
          onContinue={onContinue}
        />
      </StrictMode>,
    )
  })
  return renderer!
}

function appState(state: AppStateStatus) {
  act(() => {
    for (const handler of [...handlers]) handler(state)
  })
}

/** Every control a person can reach: a button with a press handler. A
 *  component's own onPress prop is not one. */
function pressables(root: TestInstance): RenderedNode[] {
  return root.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" &&
      node.props.accessibilityRole === "button",
  )
}

function hostsWithLabel(root: TestInstance, label: string): RenderedNode[] {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityLabel === label,
  )
}

function isDisabled(node: RenderedNode): boolean {
  const state = node.props.accessibilityState as
    | { disabled?: boolean }
    | undefined
  return state?.disabled === true
}

/** A text node that reads exactly this, not a longer text that contains it. */
function hasExactText(root: TestInstance, text: string): boolean {
  return (
    root.root.findAll(
      (node) => typeof node.type === "string" && node.props.children === text,
    ).length > 0
  )
}

/** VoiceOver reads the ring as one element that says the time left. */
function ringLabel(root: TestInstance): string | undefined {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityRole === "timer",
  )[0]?.props.accessibilityLabel
}

function host(root: TestInstance, testID: string): RenderedNode {
  const [node] = root.root.findAll(
    (one) => typeof one.type === "string" && one.props.testID === testID,
  )
  return node!
}

function opacityOf(node: RenderedNode): number {
  return Number(StyleSheet.flatten(node.props.style as ViewStyle).opacity)
}

/** The ring's fade wrapper: its opacity, and whether VoiceOver reaches it. */
function ring(root: TestInstance) {
  const node = host(root, "pause-ring-fade")
  return {
    level: opacityOf(node),
    hidden: node.props.accessibilityElementsHidden,
  }
}

/** Continue: the grey over it (1 grey, 0 cream), and whether it takes a tap. */
function continueState(root: TestInstance) {
  return {
    grey: opacityOf(host(root, "pause-button-grey")),
    disabled: hostsWithLabel(root, "Continue").some(isDisabled),
  }
}

/** Moves the fade clock to this many ms after zero. */
function finishAt(ms: number) {
  act(() => finishClock!.setValue(ms / FINISH_MS))
}

/** Moves the fake clock in one step, so a timer set at the end of the last
 *  step fires at its exact time. */
function exactly(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms)
  })
}

it("shows the stepper with REFLECT active (R11)", async () => {
  const root = await render()
  const labels = root.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.accessibilityLabel === "string",
    )
    .map((node) => node.props.accessibilityLabel)
  expect(labels).toEqual(
    expect.arrayContaining([
      "Watch, done",
      "Reflect, current step",
      "Pray, upcoming",
    ]),
  )
})

it("shows the verse and the reference label of the devotional it gets (R18)", async () => {
  const root = await render(3, DEVOTIONALS.lamp)
  expect(hasText(root, DEVOTIONALS.lamp.verse)).toBe(true)
  expect(hasText(root, DEVOTIONALS.lamp.verseLabel)).toBe(true)
  expect(hasText(root, DEVOTIONALS.pharisee.verse)).toBe(false)
  expect(hasText(root, "We’ll give you some time.")).toBe(true)
})

// v2 R14: the stepper, the ring, the verse, its reference, and the pause line,
// with no quote mark. R15: Continue stays below the scroll view.
it("lays the screen out in the v2 order, with no quote mark (R14, R15)", async () => {
  const root = await render()
  const nodes = root.root.findAll((node) => typeof node.type === "string")
  const at = (match: (node: RenderedNode) => boolean) => {
    const index = nodes.findIndex(match)
    expect(index).toBeGreaterThanOrEqual(0)
    return index
  }
  const order = [
    at((node) => node.props.testID === "pause-intro-stepper"),
    at((node) => node.props.accessibilityRole === "timer"),
    at((node) => node.props.children === DEVOTIONALS.pharisee.verse),
    at((node) => node.props.children === DEVOTIONALS.pharisee.verseLabel),
    at((node) => node.props.children === "We’ll give you some time."),
    at((node) => node.props.testID === "pause-intro-covered"),
  ]
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  expect(hasText(root, "“")).toBe(false)

  const [scroll] = nodes.filter(
    (node) => node.props.contentContainerStyle != null,
  )
  const [button] = hostsWithLabel(root, "Continue")
  expect(scroll).toBeDefined()
  expect(button).toBeDefined()
  for (let node = button!.parent; node; node = node.parent) {
    expect(node).not.toBe(scroll)
  }
})

// Jest has no layout, so this pins the shape only. On the iPhone 17 Pro
// simulator a fixed 87 pt gap put the reference and the pause line below
// Continue; the shrinking gap keeps them on screen (v2 R14).
it("lets the gap above the ring shrink, up to Pray's gap (v2 R14)", async () => {
  const root = await render()
  const views = root.root.findAll((node) => typeof node.type === "string")
  const [scroll] = views.filter(
    (node) => node.props.contentContainerStyle != null,
  )
  expect(StyleSheet.flatten(scroll!.props.contentContainerStyle)).toMatchObject(
    { flexGrow: 1 },
  )
  const gaps = views.filter((node) => {
    const style = StyleSheet.flatten(node.props.style as ViewStyle) ?? {}
    return style.maxHeight === pauseSpacing.ringGap
  })
  expect(gaps).toHaveLength(1)
  expect(StyleSheet.flatten(gaps[0]!.props.style as ViewStyle)).toMatchObject({
    flexGrow: 1,
  })
  const fixed = views.filter(
    (node) =>
      StyleSheet.flatten(node.props.style as ViewStyle)?.height ===
      pauseSpacing.ringGap,
  )
  expect(fixed).toHaveLength(0)
})

it.each<[MeditationLength, string, string]>([
  [1, "20", "20 seconds left"],
  [3, "45", "45 seconds left"],
  [5, "90", "1 minute 30 seconds left"],
])(
  "starts the ring by Meditation length (%i min → %s, AE4)",
  async (length, numeral, spoken) => {
    const root = await render(length)
    expect(hasExactText(root, numeral)).toBe(true)
    expect(ringLabel(root)).toBe(spoken)
  },
)

it("counts whole seconds down in the ring, with Continue grey and held (R11, R12)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  expect(ringLabel(root)).toBe("45 seconds left")
  advance(15_000)
  expect(hasExactText(root, "30")).toBe(true)
  expect(ringLabel(root)).toBe("30 seconds left")
  // KTD3: the held button reads Continue, with no clock in it.
  expect(hasText(root, "0:30")).toBe(false)
  expect(continueState(root)).toEqual({ grey: 1, disabled: true })
})

it("lets no control skip the ring before zero (R12, R16)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(44_000)
  expect(ringLabel(root)).toBe("1 second left")
  expect(pressables(root).length).toBeGreaterThan(0)
  for (const node of pressables(root)) await press(node)
  expect(onContinue).not.toHaveBeenCalled()
  expect(continueState(root)).toEqual({ grey: 1, disabled: true })
})

it("fades the ring out at zero, then turns Continue cream on Pray's timing (R13)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(44_000)
  expect(ring(root)).toEqual({ level: 1, hidden: false })
  expect(finishStart).not.toHaveBeenCalled()

  advance(1_000)
  expect(hasExactText(root, "0")).toBe(true)
  expect(finishStart).toHaveBeenCalledTimes(1)
  expect(ring(root).hidden).toBe(true)
  expect(continueState(root)).toEqual({ grey: 1, disabled: true })

  finishAt(RING_FADE_MS / 2)
  expect(ring(root).level).toBeGreaterThan(0)
  expect(ring(root).level).toBeLessThan(1)
  finishAt(RING_FADE_MS)
  expect(ring(root).level).toBe(0)
  finishAt(BUTTON_FROM_MS)
  expect(continueState(root).grey).toBe(1)
  finishAt(FINISH_MS)
  expect(continueState(root).grey).toBe(0)

  // Continue takes taps from when its grey starts to fade, on its own clock.
  exactly(BUTTON_FROM_MS - 1)
  expect(continueState(root).disabled).toBe(true)
  exactly(1)
  expect(continueState(root).disabled).toBe(false)
  await press(pressableByLabel(root, "Continue"))
  expect(onContinue).toHaveBeenCalledTimes(1)
})

it("pulses Continue only after the fade ends, and moves on only at the tap (R13, R17)", async () => {
  const loopStart = jest.fn()
  jest.spyOn(Animated, "loop").mockImplementation(
    () =>
      ({
        start: loopStart,
        stop: jest.fn(),
        reset: jest.fn(),
      }) as unknown as Animated.CompositeAnimation,
  )
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(45_000)
  expect(pulses(root)).toHaveLength(0)

  exactly(BUTTON_FROM_MS)
  // The owner (2026-10-06): Continue pulses every two seconds to ask for a tap.
  expect(pulses(root)).toHaveLength(1)
  const [button] = hostsWithLabel(root, "Continue")
  let inPulse = false
  for (let node = button?.parent; node; node = node.parent) {
    if (node.props.testID === "pause-pulse") inPulse = true
  }
  expect(inPulse).toBe(true)
  exactly(FINISH_MS - BUTTON_FROM_MS - 1)
  expect(loopStart).not.toHaveBeenCalled()
  exactly(1)
  expect(loopStart).toHaveBeenCalledTimes(1)

  advance(60_000)
  expect(onContinue).not.toHaveBeenCalled()
  await press(pressableByLabel(root, "Continue"))
  expect(onContinue).toHaveBeenCalledTimes(1)
})

it("holds the ring while the app is away and continues on return (R26)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(15_000)
  appState("background")
  advance(90_000)
  appState("active")
  expect(ringLabel(root)).toBe("30 seconds left")
  expect(continueState(root).disabled).toBe(true)
  advance(1_000)
  expect(ringLabel(root)).toBe("29 seconds left")
})

describe("under Reduce Motion", () => {
  beforeEach(() => {
    mockReduceMotion = true
  })

  afterEach(() => {
    mockReduceMotion = false
  })

  it("hides the ring and turns Continue cream at once at zero", async () => {
    const root = await render(3)
    advance(44_000)
    expect(continueState(root)).toEqual({ grey: 1, disabled: true })
    advance(1_000)
    expect(finishStart).not.toHaveBeenCalled()
    expect(ring(root)).toEqual({ level: 0, hidden: true })
    expect(continueState(root)).toEqual({ grey: 0, disabled: false })
    await press(pressableByLabel(root, "Continue"))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
})
