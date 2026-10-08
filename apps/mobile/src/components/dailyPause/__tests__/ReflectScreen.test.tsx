// The Reflect screen (U10, R11, R16, R17, R18, R26, R30). The ring counts the
// pause down while Continue shows grey and ignores taps; as the ring fades at
// zero, Continue turns cream (the owner, 2026-10-08).
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
import { BUTTON_FROM_MS } from "../PauseFinish"
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

function pressableHost(root: TestInstance): RenderedNode | undefined {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === "Continue",
  )[0]
}

/** The disabled host button that VoiceOver reads while the timer runs. */
function findHeld(root: TestInstance): RenderedNode | undefined {
  return root.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button" &&
      (node.props.accessibilityState as { disabled?: boolean } | undefined)
        ?.disabled === true,
  )[0]
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

/** Continue: the grey over it (1 grey, 0 cream), and whether it takes a tap. */
function continueState(root: TestInstance) {
  return {
    grey: opacityOf(host(root, "pause-button-grey")),
    disabled: findHeld(root) != null,
  }
}

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

it("counts down in the ring, and VoiceOver reads the time left", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  expect(ringLabel(root)).toBe("45 seconds left")
  advance(15_000)
  expect(hasExactText(root, "30")).toBe(true)
  expect(ringLabel(root)).toBe("30 seconds left")
})

it("lets no control skip the countdown before zero (R16)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(44_000)
  expect(ringLabel(root)).toBe("1 second left")
  for (const node of pressables(root)) await press(node)
  expect(onContinue).not.toHaveBeenCalled()
  // The owner (2026-10-08): Continue shows grey and disabled until the ring goes.
  expect(continueState(root)).toEqual({ grey: 1, disabled: true })
})

it("turns Continue cream as the ring fades, and moves on only at the tap (R17, AE1)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  expect(pulses(root)).toHaveLength(0)
  advance(45_000)
  expect(host(root, "pause-ring-fade").props.accessibilityElementsHidden).toBe(
    true,
  )
  expect(continueState(root).disabled).toBe(true)
  advance(BUTTON_FROM_MS)
  expect(findHeld(root)).toBeUndefined()
  // The owner (2026-10-06): Continue pulses every two seconds to ask for a tap.
  expect(pulses(root)).toHaveLength(1)
  for (let node = pressableHost(root)?.parent; ; node = node.parent) {
    if (!node) throw new Error("Continue is not inside the pulse")
    if (node.props.testID === "pause-pulse") break
  }
  advance(60_000)
  expect(onContinue).not.toHaveBeenCalled()
  await press(pressableByLabel(root, "Continue"))
  expect(onContinue).toHaveBeenCalledTimes(1)
})

it("holds the timer while the app is away and continues on return (R26)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(15_000)
  appState("background")
  advance(90_000)
  appState("active")
  expect(ringLabel(root)).toBe("30 seconds left")
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
    expect(opacityOf(host(root, "pause-ring-fade"))).toBe(0)
    expect(continueState(root)).toEqual({ grey: 0, disabled: false })
  })
})
