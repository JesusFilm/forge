// The Pray screen (U10, R11, R16, R17, R19, R26, R30). The ring counts the
// seconds down, and Amen ignores taps until the ring reaches zero.
import { StrictMode, act } from "react"
import {
  AppState,
  StyleSheet,
  type AppStateStatus,
  type ViewStyle,
} from "react-native"

import { DEVOTIONALS } from "../../../lib/dailyPause/devotionals"
import type { MeditationLength } from "../../../lib/dailyPause/settings"
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
import { PAUSE_INTRO_MS } from "../PauseIntro"
import { PrayScreen } from "../PrayScreen"

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

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 9, 5, 7, 0) })
  onContinue.mockReset()
  handlers = []
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
        <PrayScreen
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

/** A text node that reads exactly this, not a longer text that contains it. */
function hasExactText(root: TestInstance, text: string): boolean {
  return (
    root.root.findAll(
      (node) => typeof node.type === "string" && node.props.children === text,
    ).length > 0
  )
}

function hostsWithLabel(root: TestInstance, label: string): RenderedNode[] {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityLabel === label,
  )
}

/** VoiceOver reads the ring as one element that says the time left. */
function ringLabel(root: TestInstance): string | undefined {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityRole === "timer",
  )[0]?.props.accessibilityLabel
}

function isDisabled(node: RenderedNode): boolean {
  const state = node.props.accessibilityState as
    | { disabled?: boolean }
    | undefined
  return state?.disabled === true
}

function turn(root: TestInstance, testID: string): number {
  const node = root.root.findAll(
    (one) => typeof one.type === "string" && one.props.testID === testID,
  )[0]
  const style = StyleSheet.flatten(node.props.style as ViewStyle)
  const rotate = (style.transform as { rotate: string }[])[0].rotate
  return Number.parseFloat(rotate)
}

/**
 * The part of the ring that shows, from the two half rings' turns. Each half
 * ring is a 180° arc that starts at (turn - 45°) clockwise from 12 o'clock.
 * The right clip shows 0°-180°, and the left clip shows 180°-360°.
 */
function shownFraction(root: TestInstance): number {
  const clampArc = (degrees: number) => Math.min(180, Math.max(0, degrees))
  const rightStart = turn(root, "countdown-ring-right") - 45
  const leftStart = turn(root, "countdown-ring-left") - 45
  const shown = clampArc(180 - rightStart) + clampArc(360 - leftStart)
  return shown / 360
}

it("shows the stepper with PRAY active and the two before it done (R11)", async () => {
  const root = await render()
  for (const label of ["Watch, done", "Reflect, done", "Pray, current step"]) {
    expect(hostsWithLabel(root, label)).toHaveLength(1)
  }
})

it("shows the prayer prompt and the attribution of the devotional it gets (R19)", async () => {
  const root = await render(3, DEVOTIONALS.lamp)
  expect(hasText(root, DEVOTIONALS.lamp.prayerPrompt)).toBe(true)
  expect(hasText(root, DEVOTIONALS.lamp.attribution)).toBe(true)
  expect(hasText(root, DEVOTIONALS.pharisee.prayerPrompt)).toBe(false)
})

it.each<[MeditationLength, string, string]>([
  [1, "15", "15 seconds left"],
  [3, "30", "30 seconds left"],
  [5, "60", "1 minute left"],
])(
  "starts the ring by Meditation length (%i min → %s, AE4)",
  async (length, numeral, spoken) => {
    const root = await render(length)
    expect(hasExactText(root, numeral)).toBe(true)
    expect(ringLabel(root)).toBe(spoken)
  },
)

it("counts the seconds down in the ring", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(12_000)
  expect(hasExactText(root, "18")).toBe(true)
  expect(ringLabel(root)).toBe("18 seconds left")
})

it("lets no control skip the ring before zero (R16)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(29_000)
  expect(ringLabel(root)).toBe("1 second left")
  const pressables = root.root.findAll(
    (node) => typeof node.props.onPress === "function",
  )
  for (const node of pressables) await press(node)
  expect(onContinue).not.toHaveBeenCalled()
  expect(hostsWithLabel(root, "Amen").some(isDisabled)).toBe(true)
})

it("makes Amen active at zero and moves on only at the tap (R17)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  expect(pulses(root)).toHaveLength(0)
  advance(30_000)
  expect(hasExactText(root, "0")).toBe(true)
  expect(hostsWithLabel(root, "Amen").some(isDisabled)).toBe(false)
  // The owner (2026-10-06): Amen pulses every two seconds to ask for a tap.
  expect(pulses(root)).toHaveLength(1)
  const [amen] = hostsWithLabel(root, "Amen")
  let inPulse = false
  for (let node = amen?.parent; node; node = node.parent) {
    if (node.props.testID === "pause-pulse") inPulse = true
  }
  expect(inPulse).toBe(true)
  advance(60_000)
  expect(onContinue).not.toHaveBeenCalled()
  await press(pressableByLabel(root, "Amen"))
  expect(onContinue).toHaveBeenCalledTimes(1)
})

it("holds the ring while the app is away and continues on return (R26)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(10_000)
  appState("inactive")
  advance(45_000)
  appState("active")
  expect(ringLabel(root)).toBe("20 seconds left")
  advance(1_000)
  expect(ringLabel(root)).toBe("19 seconds left")
})

describe("under Reduce Motion", () => {
  beforeEach(() => {
    mockReduceMotion = true
  })

  afterEach(() => {
    mockReduceMotion = false
  })

  it("fills the ring by the fraction of time left, one step a second", async () => {
    const root = await render(3)
    expect(shownFraction(root)).toBeCloseTo(1)
    advance(10_000)
    expect(shownFraction(root)).toBeCloseTo(20 / 30)
    advance(5_000)
    expect(shownFraction(root)).toBeCloseTo(0.5)
    advance(8_000)
    expect(shownFraction(root)).toBeCloseTo(7 / 30)
    advance(7_000)
    expect(shownFraction(root)).toBeCloseTo(0)
  })
})
