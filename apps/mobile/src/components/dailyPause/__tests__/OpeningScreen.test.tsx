// The Opening (R3, R5, R6, R31). It offers Begin Devotional, or Resume and
// Start over when today's saved step lies between the Opening and Share.
import { act } from "react"

import { DEVOTIONALS } from "../../../lib/dailyPause/devotionals"
import type { PauseFace } from "../../../lib/dailyPause/fonts"
import {
  PAUSE_STEPS,
  type PauseDay,
  type PauseStep,
} from "../../../lib/dailyPause/progress"
import type { MeditationLength } from "../../../lib/dailyPause/settings"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { OpeningScreen } from "../OpeningScreen"

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))

const font = (face: PauseFace) => ({ fontFamily: face })
const EMPTY_DAY: PauseDay = { step: null, done: false, bellRead: true }

let renderer: TestInstance | null = null
const onBegin = jest.fn()
const onResume = jest.fn()
const onStartOver = jest.fn()
const onCustomize = jest.fn()

beforeEach(() => {
  ;[onBegin, onResume, onStartOver, onCustomize].forEach((fn) => fn.mockReset())
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
})

async function render(
  day: PauseDay,
  meditationLength: MeditationLength = 3,
): Promise<TestInstance> {
  await act(async () => {
    renderer = TestRenderer.create(
      <OpeningScreen
        devotional={DEVOTIONALS.pharisee}
        meditationLength={meditationLength}
        day={day}
        font={font}
        onBegin={onBegin}
        onResume={onResume}
        onStartOver={onStartOver}
        onCustomize={onCustomize}
      />,
    )
  })
  return renderer!
}

/** The labels of every host button, in render order. */
function buttons(root: TestInstance): string[] {
  return root.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button",
    )
    .map((node) => node.props.accessibilityLabel as string)
}

it("shows today's question, the length, Begin Devotional, and the customize link (R3)", async () => {
  const root = await render(EMPTY_DAY)
  expect(hasText(root, "DAILY BIBLE PAUSE")).toBe(true)
  expect(hasText(root, "–  3 min  –")).toBe(true)
  expect(hasText(root, DEVOTIONALS.pharisee.question)).toBe(true)
  expect(buttons(root)).toEqual(["Begin Devotional", "Customize experience"])
})

it("shows the chosen Meditation length (R31)", async () => {
  const root = await render(EMPTY_DAY, 5)
  expect(hasText(root, "–  5 min  –")).toBe(true)
})

const RESUMABLE: PauseStep[] = [
  "watchScreen",
  "film",
  "teaching",
  "reflectScreen",
  "prayer",
  "prayScreen",
]

it.each<[PauseStep | null]>([
  [null],
  ...PAUSE_STEPS.map((s) => [s] as [PauseStep]),
])(
  "offers Resume and Start over only between the Opening and Share (saved %s)",
  async (step) => {
    const root = await render({ ...EMPTY_DAY, step })
    const expected =
      step !== null && RESUMABLE.includes(step)
        ? ["Resume", "Start over", "Customize experience"]
        : ["Begin Devotional", "Customize experience"]
    expect(buttons(root)).toEqual(expected)
  },
)

it("resumes at the saved step (R6)", async () => {
  const root = await render({ ...EMPTY_DAY, step: "prayer" })
  await press(pressableByLabel(root, "Resume"))
  expect(onResume).toHaveBeenCalledWith("prayer")
})

it("starts over from the Resume choice", async () => {
  const root = await render({ ...EMPTY_DAY, step: "prayer" })
  await press(pressableByLabel(root, "Start over"))
  expect(onStartOver).toHaveBeenCalledTimes(1)
  expect(onResume).not.toHaveBeenCalled()
})

it("offers Begin Devotional only on a done day whose saved step is Share", async () => {
  const root = await render({ step: "share", done: true, bellRead: true })
  expect(buttons(root)).toEqual(["Begin Devotional", "Customize experience"])
  await press(pressableByLabel(root, "Begin Devotional"))
  expect(onBegin).toHaveBeenCalledTimes(1)
})

it("offers Resume at the step a replay left on a done day", async () => {
  const root = await render({ step: "teaching", done: true, bellRead: true })
  await press(pressableByLabel(root, "Resume"))
  expect(onResume).toHaveBeenCalledWith("teaching")
})

it("opens the customize sheet from the link", async () => {
  const root = await render(EMPTY_DAY)
  await press(pressableByLabel(root, "Customize experience"))
  expect(onCustomize).toHaveBeenCalledTimes(1)
})
