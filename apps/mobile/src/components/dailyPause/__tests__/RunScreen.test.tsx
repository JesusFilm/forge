// The run screen against the REAL day record, settings, and day clock (U8).
// Only the router, AsyncStorage, the fonts, the keep-awake native module, and
// the video player (U9) are modelled. Every render is wrapped in StrictMode.
import AsyncStorage from "@react-native-async-storage/async-storage"
import { StrictMode, act } from "react"
import {
  Animated,
  Dimensions,
  StyleSheet,
  type TextStyle,
  type ViewStyle,
} from "react-native"

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
import { pauseColors } from "../../../lib/dailyPause/theme"
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
import {
  CLOSE_PROMPT_FADE_MS,
  CLOSE_PROMPT_FINISHED,
  CLOSE_PROMPT_RESUME,
  CLOSE_PROMPT_TITLE,
} from "../ClosePrompt"
import { PAUSE_INTRO_MS } from "../PauseIntro"
import {
  endPause,
  getPauseExitTarget,
  getPausePhase,
  requestPause,
  requestPauseExit,
  setPauseRunOnTop,
} from "../../../lib/pauseCurtain"
import { RunScreen } from "../RunScreen"
import { MARKER_ARRIVAL_MS } from "../SectionMarkers"

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
// The OS read lands after mount; the hook reads it from the first render here.
let mockReduceMotion = false
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockReduceMotion,
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
  // A close through the prompt starts an exit; the next test starts idle.
  act(() => endPause())
  mockReduceMotion = false
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

function within(node: RenderedNode, root: RenderedNode): boolean {
  for (let up = node.parent; up; up = up.parent) if (up === root) return true
  return false
}

/** The close prompt's root, or null while it does not show. */
function prompt(): RenderedNode | null {
  const [root] = renderer!.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.testID === "close-prompt",
  )
  return root ?? null
}

async function tapInPrompt(label: string) {
  const root = prompt()
  expect(root == null).toBe(false)
  const [button] = renderer!.root.findAll(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function" &&
      within(node, root!),
  )
  expect(button == null).toBe(false)
  await press(button!)
  await act(async () => {})
}

/** The close (×), then Close in the prompt (the owner, 2026-10-12). */
async function closeRun() {
  await tap("Close")
  await tapInPrompt("Close")
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

/** The section marker buttons (v2 plan R2), found by what VoiceOver reads. */
function markerButtons(): RenderedNode[] {
  return renderer!.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button" &&
      /^(Watch|Reflect|Pray) section$/.test(
        node.props.accessibilityLabel ?? "",
      ),
  )
}

function isSelected(node: RenderedNode): boolean {
  const state = node.props.accessibilityState as
    | { selected?: boolean }
    | undefined
  return state?.selected === true
}

/** The marker VoiceOver reads as selected; null without a marker row. */
function markerLabel(): string | null {
  const markers = markerButtons()
  if (markers.length === 0) return null
  expect(markers.length).toBe(3)
  const selected = markers.filter(isSelected)
  expect(selected.length).toBe(1)
  return selected[0]!.props.accessibilityLabel as string
}

/** The marker row itself. */
function markerRow(): RenderedNode {
  const [row] = renderer!.root.findAll(
    (node) =>
      typeof node.type === "string" && node.props.testID === "section-markers",
  )
  return row!
}

/** The markers that show in gold. */
function goldMarkers(): string[] {
  return renderer!.root
    .findAll(
      (node) =>
        node.type === "Text" &&
        ["WATCH", "REFLECT", "PRAY"].includes(node.props.children as string),
    )
    .filter(
      (node) =>
        StyleSheet.flatten(node.props.style as TextStyle).color ===
        pauseColors.accent,
    )
    .map((node) => node.props.children as string)
}

/** The marker row's top edge and height in window points. */
function markerBox(): { top: number; height: number } {
  const style = StyleSheet.flatten(markerRow().props.style as ViewStyle)
  return { top: style.top as number, height: style.height as number }
}

function savedDay() {
  return dayFromRecord(getPauseProgressStore().getSnapshot(), MONDAY_KEY)
}

const DEV_SKIP = "Skip this step (developer)"

const WATCH = ["Watch, current step", "Reflect, upcoming", "Pray, upcoming"]
const REFLECT = ["Watch, done", "Reflect, current step", "Pray, upcoming"]
const PRAY = ["Watch, done", "Reflect, done", "Pray, current step"]

/** Each step after Begin: a text only it shows (none on a video part, which
 *  shows its part instead), its stepper, and its marker row (v2 plan R2). */
const WALK: readonly [PauseStep, string | null, string[], string | null][] = [
  ["watchScreen", "DAILY BIBLE PAUSE", WATCH, null],
  ["film", null, [], "Watch section"],
  ["teaching", null, [], "Reflect section"],
  ["reflectScreen", DEVOTIONALS.pharisee.verseLabel, REFLECT, null],
  ["prayer", null, [], "Pray section"],
  ["prayScreen", DEVOTIONALS.pharisee.attribution, PRAY, null],
  ["share", "SHARE", [], null],
]

it("walks from Begin through the R10 steps to Share, with the stepper only on the three screens and the markers only on the parts", async () => {
  await open()
  expect(buttons()).toEqual([
    "Begin Devotional",
    "Customize experience",
    "Close",
  ])
  expect(markerLabel()).toBeNull()
  await tap("Begin Devotional")
  for (const [index, [step, marker, stepper, section]] of WALK.entries()) {
    if (index > 0) await next()
    await expectShows(step, marker)
    expect(pills()).toEqual(stepper)
    expect(markerLabel()).toBe(section)
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

it("offers Share this video, Browse media, Finish, and the close on Share (v2 R20)", async () => {
  await seedDay("prayScreen")
  await open()
  await tap("Resume")
  await next()
  expect(buttons()).toEqual([
    "Share this video",
    "Browse media",
    "Finish",
    "Close",
  ])
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
  await closeRun()
  expect(getPauseExitTarget()).toEqual({ kind: "home" })
  await closeRoute()
  expect(mockAwakeTags.size).toBe(0)
})

it.each(WALK.filter(([step]) => step !== "share"))(
  "after a close during the %s step, the Opening resumes at that step (R5, R6)",
  async (step, marker, stepper, section) => {
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
    expect(markerLabel()).toBeNull()
    await tap("Resume")
    await expectShows(step, marker)
    expect(pills()).toEqual(stepper)
    expect(markerLabel()).toBe(section)
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

// The owner, 2026-10-09: a stepper pill opens the start of its section, back
// or ahead, and the current pill takes no tap. No pill on the first screen
// (the Watch screen) takes a tap.
describe("the stepper pills", () => {
  it.each<[PauseStep, string, PauseStep, string[], string | null]>([
    ["prayScreen", "Watch, done", "watchScreen", WATCH, null],
    ["prayScreen", "Reflect, done", "teaching", [], "Reflect section"],
    ["reflectScreen", "Watch, done", "watchScreen", WATCH, null],
    ["reflectScreen", "Pray, upcoming", "prayer", [], "Pray section"],
  ])(
    "on the %s step, a tap on %s opens the %s step",
    async (from, pill, to, stepper, marker) => {
      await seedDay(from)
      await open()
      await tap("Resume")
      await tap(pill)
      expect(savedDay().step).toBe(to)
      expect(pills()).toEqual(stepper)
      expect(markerLabel()).toBe(marker)
    },
  )

  it.each<[PauseStep, string, string[]]>([
    ["watchScreen", "Watch, current step", WATCH],
    ["reflectScreen", "Reflect, current step", REFLECT],
    ["prayScreen", "Pray, current step", PRAY],
  ])(
    "on the %s step, the current pill takes no tap",
    async (step, pill, stepper) => {
      await seedDay(step)
      await open()
      await tap("Resume")
      const current = renderer!.root.findAll(
        (node) =>
          node.props.accessibilityLabel === pill &&
          typeof node.props.onPress === "function",
      )
      expect(current.length).toBe(0)
      expect(savedDay().step).toBe(step)
      expect(pills()).toEqual(stepper)
    },
  )

  it("takes no tap on any pill of the first screen, and VoiceOver reads all three as dimmed", async () => {
    await open()
    await tap("Begin Devotional")
    expect(pills()).toEqual(WATCH)
    const tappable = renderer!.root.findAll(
      (node) =>
        WATCH.includes(node.props.accessibilityLabel as string) &&
        typeof node.props.onPress === "function",
    )
    expect(tappable.length).toBe(0)
    const dimmed = renderer!.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        WATCH.includes(node.props.accessibilityLabel as string) &&
        (node.props.accessibilityState as { disabled?: boolean } | undefined)
          ?.disabled === true,
    )
    expect(dimmed.length).toBe(3)
    expect(savedDay().step).toBe("watchScreen")
  })
})

// v2 plan R2-R5, AE1, KTD4: each part shows its own section in the close's row.
// A tap on another marker opens its part (owner, 2026-10-09). The current marker
// takes no tap (2026-10-12). A tap off the markers still pauses the part.
describe("the section markers", () => {
  it.each<[PauseStep, string, string]>([
    ["film", "WATCH", "Watch section"],
    ["teaching", "REFLECT", "Reflect section"],
    ["prayer", "PRAY", "Pray section"],
  ])(
    "shows the %s part's own section in gold (R3, AE1)",
    async (step, gold, label) => {
      await seedDay(step)
      await open()
      await tap("Resume")
      expect(markerLabel()).toBe(label)
      expect(goldMarkers()).toEqual([gold])
    },
  )

  it("shows the row while a part loads and after it fails", async () => {
    await open()
    await tap("Begin Devotional")
    await tap("Continue")
    expect(markerLabel()).toBe("Watch section")
    await act(async () => {
      jest.advanceTimersByTime(PART_START_BACKSTOP_MS + FRAME_MS)
    })
    expect(buttons()).toContain("Try again")
    expect(markerLabel()).toBe("Watch section")
  })

  it("takes no tap on the current marker and keeps the part playing; a tap off the markers still pauses it", async () => {
    await seedDay("teaching")
    await open()
    await tap("Resume")
    await videoReady()
    await frames(1)
    await tickTo(PARTS.teaching.startSec + 0.2)
    await frames(1)
    expect(player.playing).toBe(true)
    expect(markerRow().props.pointerEvents).toBe("box-none")

    const tappable = renderer!.root.findAll(
      (node) =>
        node.props.accessibilityLabel === "Reflect section" &&
        typeof node.props.onPress === "function",
    )
    expect(tappable.length).toBe(0)
    expect(player.playing).toBe(true)
    expect(markerLabel()).toBe("Reflect section")
    expect(savedDay().step).toBe("teaching")

    await tap("Pause video")
    expect(player.playing).toBe(false)
    expect(buttons()).toContain("Resume video")
  })

  // The owner, 2026-10-09: a marker tap switches the video to that section.
  it.each<[PauseStep, string, PauseStep, string]>([
    ["film", "Pray section", "prayer", "PRAY"],
    ["teaching", "Watch section", "film", "WATCH"],
    ["prayer", "Reflect section", "teaching", "REFLECT"],
  ])(
    "from the %s part, a tap on %s opens the %s part from its start",
    async (from, marker, to, gold) => {
      await seedDay(from)
      await open()
      await tap("Resume")
      await videoReady()
      await frames(1)
      await tickTo(PARTS[from as keyof typeof PARTS].startSec + 0.2)
      await frames(1)
      expect(player.playing).toBe(true)

      await tap(marker)
      expect(savedDay().step).toBe(to)
      expect(markerLabel()).toBe(marker)
      expect(goldMarkers()).toEqual([gold])
      // The old part goes quiet at once, and the new one seeks to its start
      // two frames later, behind the cover.
      expect(player.muted).toBe(true)
      await frames(2)
      expect(player.currentTime).toBe(PARTS[to as keyof typeof PARTS].startSec)

      await tickTo(PARTS[to as keyof typeof PARTS].startSec + 0.2)
      await frames(1)
      expect(player.playing).toBe(true)
      expect(player.muted).toBe(false)
    },
  )

  it("from a paused part, a marker tap plays the new part with no play cue over it", async () => {
    const cues = () =>
      renderer!.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          ["part-paused-cue", "part-paused-cue-leaving"].includes(
            node.props.testID as string,
          ),
      ).length
    await seedDay("teaching")
    await open()
    await tap("Resume")
    await videoReady()
    await frames(1)
    await tickTo(PARTS.teaching.startSec + 0.2)
    await frames(1)
    await tap("Pause video")
    expect(player.playing).toBe(false)
    expect(cues()).toBe(1)

    await tap("Pray section")
    expect(savedDay().step).toBe("prayer")
    expect(cues()).toBe(0)
    await frames(2)
    expect(player.currentTime).toBe(PARTS.prayer.startSec)
    await tickTo(PARTS.prayer.startSec + 0.2)
    await frames(1)
    expect(player.playing).toBe(true)
    expect(cues()).toBe(0)
  })

  it("plays a new marker arrival when the next part starts", async () => {
    await seedDay("film")
    await open()
    const timing = jest.spyOn(Animated, "timing")
    await tap("Resume")
    const arrivals = () =>
      timing.mock.calls.filter(
        ([, config]) => config.duration === MARKER_ARRIVAL_MS,
      ).length
    const first = arrivals()
    expect(first).toBeGreaterThan(0)
    await next()
    expect(markerLabel()).toBe("Reflect section")
    expect(arrivals()).toBeGreaterThan(first)
  })

  it("centers the row on the close's row on a phone with a top band (R5)", async () => {
    const videoTop = (WINDOW.height - (WINDOW.width * 1920) / 1080) / 2
    await seedDay("film")
    await open()
    await tap("Resume")
    const { top, height } = markerBox()
    expect(top + height / 2).toBeCloseTo(closeTop() + 44 / 2, 5)
    expect(top + height).toBeLessThanOrEqual(videoTop)
  })

  it("puts the row at the top edge, over the picture, on an iPhone SE", async () => {
    const se = { width: 375, height: 667, scale: 2, fontScale: 1 }
    Dimensions.set({ window: se, screen: se })
    const videoTop = (se.height - (se.width * 1920) / 1080) / 2
    await seedDay("film")
    await open()
    await tap("Resume")
    const { top, height } = markerBox()
    expect(top).toBe(0)
    expect(top + height).toBeGreaterThan(videoTop)
    expect(closeTop()).toBe(0)
  })
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
  expect(buttons()).toEqual([
    "Try again",
    "Watch section",
    "Reflect section",
    "Pray section",
    "Close",
    DEV_SKIP,
  ])
  await closeRun()
  expect(getPauseExitTarget()).toEqual({ kind: "home" })
})

// The owner, 2026-10-12: the close (×) asks first, on a blurred and darkened
// screen with the run's fonts, not in a native alert.
describe("the close prompt", () => {
  /** True when a host ancestor hides the node from a screen reader. */
  function hidden(node: RenderedNode): boolean {
    for (let up = node.parent; up; up = up.parent) {
      if (
        typeof up.type === "string" &&
        up.props.accessibilityElementsHidden === true &&
        up.props.importantForAccessibility === "no-hide-descendants"
      ) {
        return true
      }
    }
    return false
  }

  /** The close (×) of the run, not the prompt's Close. */
  function closeX(): RenderedNode {
    const root = prompt()
    const [x] = renderer!.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityLabel === "Close" &&
        (root == null || !within(node, root)),
    )
    expect(x == null).toBe(false)
    return x!
  }

  it("asks before the run closes, and Cancel keeps the run where it was", async () => {
    await open()
    await tap("Begin Devotional")
    expect(prompt() == null).toBe(true)

    await tap("Close")
    expect(mockRouter.dismissTo).not.toHaveBeenCalled()
    expect(prompt() == null).toBe(false)
    expect(hasText(renderer!, CLOSE_PROMPT_TITLE)).toBe(true)
    expect(hasText(renderer!, CLOSE_PROMPT_RESUME)).toBe(true)
    expect(prompt()!.props.accessibilityViewIsModal).toBe(true)
    expect(hidden(closeX())).toBe(true)

    await tapInPrompt("Cancel")
    expect(prompt() == null).toBe(true)
    expect(mockRouter.dismissTo).not.toHaveBeenCalled()
    expect(savedDay().step).toBe("watchScreen")
    expect(pills()).toEqual(WATCH)
    expect(hidden(closeX())).toBe(false)
  })

  // The owner, 2026-10-12: the blur, the text, and the buttons fade in and out.
  it("fades in, and fades out after Cancel, taking no tap while it fades", async () => {
    await open()
    await tap("Begin Devotional")
    const timing = jest.spyOn(Animated, "timing")
    // An earlier test's spy can still hold its calls.
    timing.mockClear()
    const fades = (toValue: number) =>
      timing.mock.calls.filter(
        ([, config]) =>
          config.duration === CLOSE_PROMPT_FADE_MS &&
          config.toValue === toValue &&
          config.useNativeDriver === true,
      ).length
    const leaving = () =>
      renderer!.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props.testID === "close-prompt-leaving",
      )

    await tap("Close")
    // The fade waits two frames, so iOS draws the glass empty first.
    expect(fades(1)).toBe(0)
    await frames(2)
    expect(fades(1)).toBeGreaterThan(0)
    expect(fades(0)).toBe(0)

    await tapInPrompt("Cancel")
    expect(prompt() == null).toBe(true)
    expect(leaving().length).toBe(1)
    expect(leaving()[0]!.props.pointerEvents).toBe("none")
    expect(leaving()[0]!.props.accessibilityElementsHidden).toBe(true)
    expect(fades(0)).toBeGreaterThan(0)

    await act(async () => {
      jest.advanceTimersByTime(CLOSE_PROMPT_FADE_MS - 1)
    })
    expect(leaving().length).toBe(1)
    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(leaving().length).toBe(0)
  })

  // The owner, 2026-10-12: Close takes the same curtain and logo as Finish.
  // DailyPauseHost pops to Home under the drawn curtain.
  it("leaves for Home through the curtain at Close in the prompt", async () => {
    await open()
    await tap("Begin Devotional")
    expect(getPausePhase()).toBe("idle")
    await closeRun()
    expect(getPausePhase()).toBe("closing")
    expect(getPauseExitTarget()).toEqual({ kind: "home" })
    expect(mockRouter.dismissTo).not.toHaveBeenCalled()
    // The prompt stays up under the closing curtain, so the run never shows
    // unblurred; it goes with the run.
    await act(async () => {
      jest.advanceTimersByTime(CLOSE_PROMPT_FADE_MS * 2)
    })
    expect(prompt() == null).toBe(false)
    await closeRoute()
    await open()
    expect(prompt() == null).toBe(true)
  })

  // Under an exit's curtain a screen reader can still reach the close, and a
  // prompt there could start a second exit.
  it("opens no prompt while an exit's curtain is up", async () => {
    await open()
    await tap("Begin Devotional")
    await act(async () => requestPauseExit({ kind: "home" }))
    await tap("Close")
    expect(prompt() == null).toBe(true)
    expect(getPauseExitTarget()).toEqual({ kind: "home" })
  })

  it("puts Cancel and Close side by side, with one width", async () => {
    await open()
    await tap("Begin Devotional")
    await tap("Close")
    const [row] = renderer!.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.testID === "close-prompt-buttons",
    )
    expect(StyleSheet.flatten(row!.props.style as ViewStyle)).toMatchObject({
      flexDirection: "row",
      alignSelf: "stretch",
    })
    const cells = (row!.children ?? []).filter(
      (child): child is RenderedNode => typeof child !== "string",
    )
    expect(cells.length).toBe(2)
    for (const cell of cells) {
      expect(StyleSheet.flatten(cell.props.style as ViewStyle).flex).toBe(1)
    }
    const labels = renderer!.root
      .findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props.accessibilityRole === "button" &&
          within(node, row!),
      )
      .map((node) => node.props.accessibilityLabel)
    expect(labels).toEqual(["Cancel", "Close"])
  })

  it("says the day is finished on Share, where nothing is left to resume", async () => {
    await seedDay("prayScreen")
    await open()
    await tap("Resume")
    await waitOutPause()
    await tap("Amen")
    expect(buttons()).toContain("Browse media")

    await tap("Close")
    expect(hasText(renderer!, CLOSE_PROMPT_FINISHED)).toBe(true)
    expect(hasText(renderer!, CLOSE_PROMPT_RESUME)).toBe(false)
  })

  it("holds a playing part while it shows, and the part stays held after Cancel", async () => {
    await seedDay("film")
    await open()
    await tap("Resume")
    await videoReady()
    await frames(1)
    await tickTo(PARTS.film.startSec + 0.2)
    await frames(1)
    expect(player.playing).toBe(true)

    await tap("Close")
    expect(player.playing).toBe(false)
    await tapInPrompt("Cancel")
    expect(player.playing).toBe(false)
    expect(buttons()).toContain("Resume video")
  })

  it("does not show again when the run opens after a close with the prompt up", async () => {
    await open()
    await tap("Begin Devotional")
    await tap("Close")
    expect(prompt() == null).toBe(false)
    await closeRoute()

    await open()
    expect(prompt() == null).toBe(true)
  })

  function leavingPrompts(): number {
    return renderer!.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.testID === "close-prompt-leaving",
    ).length
  }

  // R22 (code review, 2026-10-13): no fade time under Reduce Motion.
  it("shows and leaves at once under Reduce Motion", async () => {
    mockReduceMotion = true
    await open()
    await tap("Begin Devotional")
    const timing = jest.spyOn(Animated, "timing")
    // An earlier test's spy can still hold its calls.
    timing.mockClear()
    await tap("Close")
    await frames(2)
    const shows = timing.mock.calls.filter(
      ([, config]) => config.toValue === 1 && config.useNativeDriver === true,
    )
    expect(shows.length).toBeGreaterThan(0)
    expect(shows.every(([, config]) => config.duration === 0)).toBe(true)

    await tapInPrompt("Cancel")
    await act(async () => {
      jest.advanceTimersByTime(1)
    })
    expect(leavingPrompts()).toBe(0)
    expect(prompt() == null).toBe(true)
  })

  // The prompt stays up under the closing curtain, so Cancel there does
  // nothing; the run never shows unblurred (code review, 2026-10-13).
  it("keeps the prompt up when Cancel is pressed under the exit's curtain", async () => {
    await open()
    await tap("Begin Devotional")
    await closeRun()
    await tapInPrompt("Cancel")
    expect(prompt() == null).toBe(false)
    expect(leavingPrompts()).toBe(0)
  })

  it("cancels on the VoiceOver escape gesture, as Android back does", async () => {
    await open()
    await tap("Begin Devotional")
    await tap("Close")
    const escape = prompt()!.props.onAccessibilityEscape as () => void
    await act(async () => escape())
    expect(prompt() == null).toBe(true)
    expect(leavingPrompts()).toBe(1)
    expect(mockRouter.dismissTo).not.toHaveBeenCalled()
  })
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
    expect(buttons()).toEqual([
      "Share this video",
      "Browse media",
      "Finish",
      "Close",
    ])
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
