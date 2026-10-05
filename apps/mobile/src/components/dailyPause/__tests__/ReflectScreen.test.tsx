// The Reflect screen (U10, R11, R16, R17, R18, R26, R30). The timer counts
// down in the button, which ignores taps until 0:00 and then reads Continue.
import { StrictMode, act } from "react"
import { AppState, type AppStateStatus } from "react-native"

import { DEVOTIONALS } from "../../../lib/dailyPause/devotionals"
import type { PauseFace } from "../../../lib/dailyPause/fonts"
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
import { PAUSE_INTRO_MS } from "../PauseIntro"
import { ReflectScreen } from "../ReflectScreen"

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))

const font = (face: PauseFace) => ({ fontFamily: face })
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

/** Small steps, so React commits between timers as it does on a phone. */
function advance(ms: number) {
  for (let left = ms; left > 0; left -= 250) {
    act(() => {
      jest.advanceTimersByTime(Math.min(250, left))
    })
  }
}

function appState(state: AppStateStatus) {
  act(() => {
    for (const handler of [...handlers]) handler(state)
  })
}

function pressables(root: TestInstance): RenderedNode[] {
  return root.root.findAll((node) => typeof node.props.onPress === "function")
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

it.each<[MeditationLength, string]>([
  [1, "0:20"],
  [3, "0:45"],
  [5, "1:30"],
])(
  "starts the timer by Meditation length (%i min → %s, AE4)",
  async (length, clock) => {
    const root = await render(length)
    expect(hasText(root, clock)).toBe(true)
    expect(hasText(root, "Continue")).toBe(false)
  },
)

it("counts down in the button and VoiceOver reads the time left", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  expect(findHeld(root)?.props.accessibilityLabel).toBe(
    "Continue, 45 seconds left",
  )
  advance(15_000)
  expect(hasText(root, "0:30")).toBe(true)
  expect(findHeld(root)?.props.accessibilityLabel).toBe(
    "Continue, 30 seconds left",
  )
})

it("lets no control skip the countdown before zero (R16)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(44_000)
  expect(hasText(root, "0:01")).toBe(true)
  for (const node of pressables(root)) await press(node)
  expect(onContinue).not.toHaveBeenCalled()
  expect(
    root.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Continue" &&
        typeof node.props.onPress === "function",
    ),
  ).toHaveLength(0)
})

it("shows Continue at 0:00 and moves on only at the tap (R17, AE1)", async () => {
  const root = await render(3)
  advance(PAUSE_INTRO_MS)
  advance(45_000)
  expect(hasText(root, "Continue")).toBe(true)
  expect(findHeld(root)).toBeUndefined()
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
  expect(hasText(root, "0:30")).toBe(true)
  advance(1_000)
  expect(hasText(root, "0:29")).toBe(true)
})
