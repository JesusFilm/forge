// The run screen against the REAL day record, settings, and day clock (U8).
// Only the router, AsyncStorage, the fonts, and the keep-awake native module
// are modelled. Every render is wrapped in StrictMode.
import AsyncStorage from "@react-native-async-storage/async-storage"
import { StrictMode, act } from "react"
import { Dimensions, StyleSheet, type ViewStyle } from "react-native"

import {
  PAUSE_DAY_STORAGE_KEY,
  PAUSE_DAY_VERSION,
  dayFromRecord,
  getPauseProgressStore,
  resetPauseProgressStoreForTests,
  type PauseStep,
} from "../../../lib/dailyPause/progress"
import {
  getPauseSettingsStore,
  resetPauseSettingsStoreForTests,
} from "../../../lib/dailyPause/settings"
import {
  TestRenderer,
  hasText,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { RunScreen } from "../RunScreen"

// The stores read the module's `default`, so the mock must carry one.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
}))
/* eslint-enable @typescript-eslint/no-require-imports */

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  dismissTo: jest.fn(),
}
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useSegments: () => ["pause"],
}))
jest.mock("../../../contexts/ExperienceSelectionProvider", () => ({
  useExperienceSelection: () => ({ isReady: true, currentSlug: "jesus-film" }),
}))
jest.mock("expo-font", () => ({
  loadAsync: jest.fn(async () => {}),
  isLoaded: jest.fn(() => true),
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
}))

/** The native module keeps a set of tags, and any tag keeps the screen on. */
const mockAwakeTags = new Set<string>()
jest.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: async (tag: string) => {
    mockAwakeTags.add(tag)
  },
  deactivateKeepAwake: async (tag: string) => {
    mockAwakeTags.delete(tag)
  },
}))

const MONDAY_KEY = "2026-10-05"
/** iPhone 17 Pro, in points. */
const WINDOW = { width: 402, height: 874, scale: 3, fontScale: 1 }

let renderer: TestInstance | null = null

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date(2026, 9, 5, 9, 0) })
  Dimensions.set({ window: WINDOW, screen: WINDOW })
  await AsyncStorage.clear()
  resetPauseProgressStoreForTests()
  resetPauseSettingsStoreForTests()
  mockAwakeTags.clear()
  Object.values(mockRouter).forEach((fn) => fn.mockReset())
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  jest.useRealTimers()
})

async function seedDay(step: PauseStep, done = false) {
  await AsyncStorage.setItem(
    PAUSE_DAY_STORAGE_KEY,
    JSON.stringify({
      version: PAUSE_DAY_VERSION,
      dayKey: MONDAY_KEY,
      step,
      done,
      bellRead: true,
    }),
  )
}

async function open(): Promise<TestInstance> {
  await act(async () => {
    renderer = TestRenderer.create(
      <StrictMode>
        <RunScreen />
      </StrictMode>,
    )
  })
  await act(async () => {})
  return renderer!
}

async function closeRoute() {
  if (renderer) await unmount(renderer)
  renderer = null
}

async function tap(label: string) {
  await press(pressableByLabel(renderer!, label))
  await act(async () => {})
}

/** The labels of every host button, in render order. */
function buttons(): string[] {
  return renderer!.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button",
    )
    .map((node) => node.props.accessibilityLabel as string)
}

/** The stepper pills' labels, top to bottom; empty without a stepper. */
function pills(): string[] {
  return renderer!.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        typeof node.props.accessibilityLabel === "string" &&
        /^(Watch|Reflect|Pray), /.test(node.props.accessibilityLabel),
    )
    .map((node) => node.props.accessibilityLabel as string)
}

function closeTop(): number {
  const [close] = renderer!.root.findAll(
    (node: RenderedNode) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === "Close",
  )
  return StyleSheet.flatten(close!.props.style as ViewStyle).top as number
}

function savedDay() {
  return dayFromRecord(getPauseProgressStore().getSnapshot(), MONDAY_KEY)
}

const WATCH = ["Watch, current step", "Reflect, upcoming", "Pray, upcoming"]
const REFLECT = ["Watch, done", "Reflect, current step", "Pray, upcoming"]
const PRAY = ["Watch, done", "Reflect, done", "Pray, current step"]

/** Each step after Begin: a text only it shows, and its stepper. */
const WALK: readonly [PauseStep, string, string[]][] = [
  ["watchScreen", "DAILY BIBLE PAUSE", WATCH],
  ["film", "Film part", []],
  ["teaching", "Teaching part", []],
  ["reflectScreen", "Reflect", REFLECT],
  ["prayer", "Prayer part", []],
  ["prayScreen", "Pray", PRAY],
  ["share", "Share", []],
]

it("walks from Begin through the R10 steps to Share, with the stepper only on the three screens", async () => {
  await open()
  expect(buttons()).toEqual([
    "Begin Devotional",
    "Customize experience",
    "Close",
  ])
  await tap("Begin Devotional")
  for (const [index, [step, marker, stepper]] of WALK.entries()) {
    if (index > 0) await tap("Continue")
    expect(hasText(renderer!, marker)).toBe(true)
    expect(pills()).toEqual(stepper)
    expect(savedDay().step).toBe(step)
  }
})

it("offers only the close and Share this video on Share (R22)", async () => {
  await seedDay("prayScreen")
  await open()
  await tap("Resume")
  await tap("Continue")
  expect(buttons()).toEqual(["Share this video", "Close"])
})

it("keeps the screen awake from the Opening through Pray, under StrictMode with one tag", async () => {
  await open()
  expect(mockAwakeTags.size).toBe(1)
  await tap("Begin Devotional")
  for (let i = 1; i < WALK.length - 1; i += 1) {
    expect(mockAwakeTags.size).toBe(1)
    await tap("Continue")
  }
  expect(hasText(renderer!, "Pray")).toBe(true)
  expect(mockAwakeTags.size).toBe(1)
  await tap("Continue")
  expect(hasText(renderer!, "Share this video")).toBe(true)
  expect(mockAwakeTags.size).toBe(0)
})

it("lets the screen sleep after the close", async () => {
  await open()
  await tap("Begin Devotional")
  await tap("Continue")
  expect(mockAwakeTags.size).toBe(1)
  await tap("Close")
  expect(mockRouter.dismissTo).toHaveBeenCalledWith("/(tabs)")
  await closeRoute()
  expect(mockAwakeTags.size).toBe(0)
})

it.each(WALK.filter(([step]) => step !== "share"))(
  "after a close during the %s step, the Opening resumes at that step (R5, R6)",
  async (step, marker, stepper) => {
    await open()
    await tap("Begin Devotional")
    const target = WALK.findIndex(([one]) => one === step)
    for (let i = 0; i < target; i += 1) await tap("Continue")
    await closeRoute()

    await open()
    expect(buttons()).toEqual([
      "Resume",
      "Start over",
      "Customize experience",
      "Close",
    ])
    await tap("Resume")
    expect(hasText(renderer!, marker)).toBe(true)
    expect(pills()).toEqual(stepper)
  },
)

it("starts over at the Watch screen and replaces the saved step", async () => {
  await seedDay("prayer")
  await open()
  await tap("Start over")
  expect(pills()).toEqual(WATCH)
  expect(savedDay().step).toBe("watchScreen")
})

it("begins again on a done day, and the day stays done", async () => {
  await seedDay("share", true)
  await open()
  expect(buttons()).toEqual([
    "Begin Devotional",
    "Customize experience",
    "Close",
  ])
  await tap("Begin Devotional")
  expect(pills()).toEqual(WATCH)
  expect(savedDay()).toMatchObject({ step: "watchScreen", done: true })
})

it("shows a new Meditation length at once (R31)", async () => {
  await open()
  expect(hasText(renderer!, "–  3 min  –")).toBe(true)
  await act(async () => {
    getPauseSettingsStore().update({ meditationLength: 5 })
  })
  expect(hasText(renderer!, "–  5 min  –")).toBe(true)
  await tap("Begin Devotional")
  expect(hasText(renderer!, "–  5 min  –")).toBe(true)
})

it("opens the customize sheet over the Opening", async () => {
  await open()
  await tap("Customize experience")
  expect(mockRouter.push).toHaveBeenCalledWith("/pause/customize")
})

it("puts the close in the safe area on screens and in the top letterbox on video parts (R24)", async () => {
  const videoTop = (WINDOW.height - (WINDOW.width * 1920) / 1080) / 2
  await open()
  expect(closeTop()).toBe(62)
  await tap("Begin Devotional")
  expect(closeTop()).toBe(62)
  await tap("Continue")
  expect(closeTop()).toBeGreaterThanOrEqual(0)
  expect(closeTop() + 44).toBeLessThanOrEqual(videoTop)
})
