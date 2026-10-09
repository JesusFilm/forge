// The run screen against the REAL day record, settings, and day clock (U8).
// Only the router, AsyncStorage, the fonts, the keep-awake native module, and
// the video player (U9) are modelled. Every render is wrapped in StrictMode.
import AsyncStorage from "@react-native-async-storage/async-storage"
import { StrictMode, act } from "react"
import { Dimensions, StyleSheet, type ViewStyle } from "react-native"

import {
  DEVOTIONALS,
  type PartRange,
} from "../../../lib/dailyPause/devotionals"
import {
  PART_START_BACKSTOP_MS,
  partStopAt,
} from "../../../lib/dailyPause/partClock"
import {
  PAUSE_DAY_STORAGE_KEY,
  PAUSE_DAY_VERSION,
  dayFromRecord,
  getPauseProgressStore,
  resetPauseProgressStoreForTests,
  type PauseStep,
} from "../../../lib/dailyPause/progress"
import {
  PAUSE_TIMERS,
  getPauseSettingsStore,
  resetPauseSettingsStoreForTests,
} from "../../../lib/dailyPause/settings"
import type { ExpoVideoMock } from "../../../test-utils/expoVideoMock"
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
import {
  endPause,
  requestPause,
  setPauseRunOnTop,
} from "../../../lib/pauseCurtain"
import { RunScreen } from "../RunScreen"

// The stores read the module's `default`, so the mock must carry one.
/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
}))
jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").createExpoVideoMock(),
)
/* eslint-enable @typescript-eslint/no-require-imports */

// The part player's adapter reads the play state through `useEvent`.
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  const react = jest.requireActual("react")
  return {
    ...actual,
    useEvent: (
      player: {
        addListener: (
          n: string,
          f: (p?: unknown) => void,
        ) => { remove: () => void }
      },
      event: string,
      initial: unknown,
    ) => {
      const [value, setValue] = react.useState(initial)
      react.useEffect(() => {
        const sub = player.addListener(event, (payload) => setValue(payload))
        return () => sub.remove()
      }, [player, event])
      return value
    },
  }
})
/** One call per mount of the part player, which resolves the file. */
const mockDownloadAsync = jest.fn(async () => ({
  localUri: "file:///bundle/pharisee.mp4",
}))
jest.mock("expo-asset", () => ({
  Asset: { fromModule: () => ({ downloadAsync: () => mockDownloadAsync() }) },
}))
// The glyph loads its font through expo-asset, which is modelled above.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))
jest.mock("../../../lib/watchProgress/store", () => ({
  applyLocalProgress: jest.fn(),
  bufferProgressIntent: jest.fn(),
}))
jest.mock("../../../lib/watchProgress/signInPrompt", () => ({
  noteSignedOutPlaybackStop: jest.fn(),
}))
jest.mock("../../../lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({ drainIntents: jest.fn() }),
  getSignedInAccountId: () => null,
}))

const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  navigate: jest.fn(),
  dismissTo: jest.fn(),
}
/** False while another screen covers the run. */
let mockFocused = true
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useSegments: () => ["pause"],
  useIsFocused: () => mockFocused,
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
/** Monday's devotional. */
const PARTS = DEVOTIONALS.pharisee.parts
/** iPhone 17 Pro, in points. */
const WINDOW = { width: 402, height: 874, scale: 3, fontScale: 1 }
/** One display frame. A test's animation frame is a zero-delay timer. */
const FRAME_MS = 16

const video = jest.requireMock("expo-video") as ExpoVideoMock
const player = video.__player

let renderer: TestInstance | null = null

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date(2026, 9, 5, 9, 0) })
  Dimensions.set({ window: WINDOW, screen: WINDOW })
  await AsyncStorage.clear()
  resetPauseProgressStoreForTests()
  resetPauseSettingsStoreForTests()
  video.__reset()
  mockDownloadAsync.mockClear()
  mockAwakeTags.clear()
  mockFocused = true
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

async function frames(count = 1) {
  await act(async () => {
    jest.advanceTimersByTime(FRAME_MS * count)
  })
}

/** The video file has loaded, and the part's seek goes out behind the cover. */
async function videoReady() {
  player.status = "readyToPlay"
  await act(async () => {
    player.__emit("statusChange", { status: "readyToPlay" })
  })
  await frames(1)
}

async function tickTo(seconds: number) {
  await act(async () => {
    player.__tick({ currentTime: seconds })
  })
}

/** A video part plays from its start to its stop, as on a device. */
async function playToStop(range: PartRange) {
  await videoReady()
  await frames(1)
  await tickTo(range.startSec + 0.2)
  await frames(1)
  await tickTo(partStopAt(range))
  await frames(1)
}

/** Lets the intro and the default pause run out (Reflect 0:45, then Pray
 *  0:30). The countdown re-arms between commits, so the clock moves in small
 *  steps. */
async function waitOutPause() {
  const steps = (PAUSE_INTRO_MS + PAUSE_TIMERS[3].reflectSec * 1000) / 250 + 4
  for (let i = 0; i < steps; i += 1) {
    await act(async () => {
      jest.advanceTimersByTime(250)
    })
  }
}

/** Moves the run on: the part's end on a video part, the button at zero on a
 *  pause screen, and Continue on the Watch screen. */
async function next() {
  const step = savedDay().step
  if (step === "film" || step === "teaching" || step === "prayer") {
    await playToStop(PARTS[step])
  } else if (step === "reflectScreen") {
    await waitOutPause()
    await tap("Continue")
  } else if (step === "prayScreen") {
    await waitOutPause()
    await tap("Amen")
  } else {
    await tap("Continue")
  }
}

/** The step's own sign: a text on a screen, the part's start on a video. */
async function expectShows(step: PauseStep, marker: string | null) {
  if (marker != null) {
    expect(hasText(renderer!, marker)).toBe(true)
    return
  }
  if (step !== "film" && step !== "teaching" && step !== "prayer") {
    throw new Error(`${step} needs a marker`)
  }
  await videoReady()
  expect(player.currentTime).toBe(PARTS[step].startSec)
  // R14: the only control on a video part is the tap on the video.
  expect(buttons()).not.toContain("Continue")
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

/** What VoiceOver reads on the countdown ring. */
function timeLeft(): string | undefined {
  return renderer!.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.accessibilityRole === "timer",
  )[0]?.props.accessibilityLabel
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

const DEV_SKIP = "Skip this step (developer)"

const WATCH = ["Watch, current step", "Reflect, upcoming", "Pray, upcoming"]
const REFLECT = ["Watch, done", "Reflect, current step", "Pray, upcoming"]
const PRAY = ["Watch, done", "Reflect, done", "Pray, current step"]

/** Each step after Begin: a text only it shows (none on a video part, which
 *  shows its part instead), and its stepper. */
const WALK: readonly [PauseStep, string | null, string[]][] = [
  ["watchScreen", "DAILY BIBLE PAUSE", WATCH],
  ["film", null, []],
  ["teaching", null, []],
  ["reflectScreen", DEVOTIONALS.pharisee.verseLabel, REFLECT],
  ["prayer", null, []],
  ["prayScreen", DEVOTIONALS.pharisee.attribution, PRAY],
  ["share", "SHARE", []],
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
    if (index > 0) await next()
    await expectShows(step, marker)
    expect(pills()).toEqual(stepper)
    expect(savedDay().step).toBe(step)
  }
  // R7: reaching Share marks the day done.
  expect(savedDay().done).toBe(true)
})

it("keeps one part player mounted from the film part to the prayer part (KTD7)", async () => {
  await open()
  await tap("Begin Devotional")
  await tap("Continue")
  const mounts = mockDownloadAsync.mock.calls.length
  expect(mounts).toBeGreaterThan(0)

  for (const step of ["teaching", "reflectScreen", "prayer"] as const) {
    await next()
    expect(savedDay().step).toBe(step)
  }
  expect(mockDownloadAsync.mock.calls.length).toBe(mounts)
})

it("offers only the close and Share this video on Share (R22)", async () => {
  await seedDay("prayScreen")
  await open()
  await tap("Resume")
  await next()
  expect(buttons()).toEqual(["Share this video", "Close"])
})

// v2 plan R11-R13, AE5: Reflect and Pray count down on one ring, and a tap
// on the held button before zero leaves the run where it is.
it.each<[PauseStep, string, string, PauseStep]>([
  ["reflectScreen", "Continue", "45 seconds left", "prayer"],
  ["prayScreen", "Amen", "30 seconds left", "share"],
])(
  "keeps the run on %s until its ring reaches zero, then %s moves it on",
  async (step, label, full, nextStep) => {
    await seedDay(step)
    await open()
    await tap("Resume")
    expect(timeLeft()).toBe(full)
    await tap(label)
    expect(savedDay().step).toBe(step)
    await waitOutPause()
    await tap(label)
    expect(savedDay().step).toBe(nextStep)
  },
)

it("keeps the screen awake from the Opening through Pray, under StrictMode with one tag", async () => {
  await open()
  expect(mockAwakeTags.size).toBe(1)
  await tap("Begin Devotional")
  for (let i = 1; i < WALK.length - 1; i += 1) {
    expect(mockAwakeTags.size).toBe(1)
    await next()
  }
  expect(savedDay().step).toBe("prayScreen")
  expect(mockAwakeTags.size).toBe(1)
  await next()
  expect(hasText(renderer!, "Share this video")).toBe(true)
  expect(mockAwakeTags.size).toBe(0)
})

// Review #6: a screen pushed above the run kept the phone awake under it.
it("lets the screen sleep while another screen covers the run", async () => {
  await open()
  await tap("Begin Devotional")
  await tap("Continue")
  expect(mockAwakeTags.size).toBe(1)

  mockFocused = false
  await act(async () => {
    renderer!.update(
      <StrictMode>
        <RunScreen />
      </StrictMode>,
    )
  })
  expect(mockAwakeTags.size).toBe(0)

  mockFocused = true
  await act(async () => {
    renderer!.update(
      <StrictMode>
        <RunScreen />
      </StrictMode>,
    )
  })
  expect(mockAwakeTags.size).toBe(1)
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
    for (let i = 0; i < target; i += 1) await next()
    await closeRoute()

    await open()
    expect(buttons()).toEqual([
      "Resume",
      "Start over",
      "Customize experience",
      "Close",
    ])
    await tap("Resume")
    await expectShows(step, marker)
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

it("offers Try again when a part never starts, and the close stays reachable", async () => {
  await open()
  await tap("Begin Devotional")
  await tap("Continue")
  // The file never becomes ready.
  await act(async () => {
    jest.advanceTimersByTime(PART_START_BACKSTOP_MS + FRAME_MS)
  })
  // The developer Skip shows because jest runs as a development bundle.
  expect(buttons()).toEqual(["Try again", "Close", DEV_SKIP])
  await tap("Close")
  expect(mockRouter.dismissTo).toHaveBeenCalledWith("/(tabs)")
})

describe("the developer Skip", () => {
  it("shows only on the timed steps, and each tap moves the run on", async () => {
    await open()
    expect(buttons()).not.toContain(DEV_SKIP)
    await tap("Begin Devotional")
    expect(buttons()).not.toContain(DEV_SKIP)
    await tap("Continue")
    for (const step of [
      "film",
      "teaching",
      "reflectScreen",
      "prayer",
      "prayScreen",
    ] as const) {
      expect(savedDay().step).toBe(step)
      expect(buttons()).toContain(DEV_SKIP)
      await tap(DEV_SKIP)
    }
    expect(savedDay()).toMatchObject({ step: "share", done: true })
    expect(buttons()).toEqual(["Share this video", "Close"])
  })

  it("silences a part that it ends in the middle of playback", async () => {
    await open()
    await tap("Begin Devotional")
    await tap("Continue")
    await videoReady()
    await frames(1)
    await tickTo(PARTS.film.startSec + 0.2)
    await frames(1)
    expect(player.muted).toBe(false)

    await tap(DEV_SKIP)
    expect(savedDay().step).toBe("teaching")
    expect(player.muted).toBe(true)
  })

  it("is absent from a release bundle", async () => {
    const globals = globalThis as unknown as { __DEV__: boolean }
    globals.__DEV__ = false
    try {
      await open()
      await tap("Begin Devotional")
      await tap("Continue")
      expect(savedDay().step).toBe("film")
      expect(buttons()).not.toContain(DEV_SKIP)
    } finally {
      globals.__DEV__ = true
    }
  })
})

// Review #8: a run left open overnight ignored today's reminder and widget,
// so the viewer finished yesterday's devotional and today stayed undone.
describe("an entry point while the run is on top", () => {
  afterEach(() => {
    setPauseRunOnTop(false)
    act(() => endPause())
  })

  async function reachReflect() {
    await open()
    await tap("Begin Devotional")
    for (const step of ["film", "teaching", "reflectScreen"] as const) {
      await next()
      expect(savedDay().step).toBe(step)
    }
  }

  it("goes back to the Opening with today's devotional when the run is from an earlier day", async () => {
    await reachReflect()
    setPauseRunOnTop(true)
    // Tuesday morning, a Lamp day.
    jest.setSystemTime(new Date(2026, 9, 6, 7, 0))
    await act(async () => requestPause())
    await act(async () => {})

    expect(buttons()).toContain("Begin Devotional")
    expect(hasText(renderer!, DEVOTIONALS.lamp.question)).toBe(true)
  })

  it("keeps today's run where it is", async () => {
    await reachReflect()
    setPauseRunOnTop(true)
    await act(async () => requestPause())
    await act(async () => {})

    expect(hasText(renderer!, DEVOTIONALS.pharisee.verseLabel)).toBe(true)
    expect(buttons()).not.toContain("Begin Devotional")
  })
})
