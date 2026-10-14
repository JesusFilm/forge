// The devotional part player (U9) over the REAL adapter and part clock. Only
// expo-video (the shared double), the asset download, and the adapter's
// telemetry and progress modules are modelled. Every render is in StrictMode.
import { StrictMode, act } from "react"
import {
  Animated,
  AppState,
  Dimensions,
  Platform,
  StyleSheet,
  processColor,
  type GestureResponderEvent,
  type ViewStyle,
} from "react-native"

import {
  DEVOTIONALS,
  type DevotionalPart,
} from "../../../lib/dailyPause/devotionals"
import {
  PART_END_GUARD_SECONDS,
  PART_START_BACKSTOP_MS,
  partTimeAt,
} from "../../../lib/dailyPause/partClock"
import { PART_FAST_RATE } from "../../../lib/dailyPause/partGestures"
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
import { pauseTestFont as font } from "../../../test-utils/dailyPause"
import { hexToRgba } from "../../../lib/color"
import { pauseColors } from "../../../lib/dailyPause/theme"
import { runVideoLayout } from "../../../lib/dailyPause/videoFrame"
import { DIP_TIMINGS } from "../../../lib/dailyPause/stepDip"
import {
  COVER_LIFT_MS,
  COVER_SETTLE_MS,
  CUE_FADE_MS,
  PartPlayer,
} from "../PartPlayer"

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").createExpoVideoMock(),
)
/* eslint-enable @typescript-eslint/no-require-imports */

// The factory owns its state, so a case can turn Liquid Glass on. Off by
// default, as on Android and before iOS 26.
jest.mock("expo-glass-effect", () => {
  const react = jest.requireActual("react")
  const state = { liquid: false }
  return {
    GlassView: (props: Record<string, unknown>) =>
      react.createElement("GlassView", props),
    isLiquidGlassAvailable: () => state.liquid,
    isGlassEffectAPIAvailable: () => true,
    __state: state,
  }
})
const mockGlass = (
  jest.requireMock("expo-glass-effect") as unknown as {
    __state: { liquid: boolean }
  }
).__state

// A live playingChange subscription, as on a device. `expo` carries more.
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

/** The bundled file resolves unless a case says it cannot be loaded. */
let mockFileFails = false
jest.mock("expo-asset", () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: async () => {
        if (mockFileFails) throw new Error("no asset")
        return { localUri: "file:///bundle/pharisee.mp4" }
      },
    }),
  },
}))
// The glyph loads its font through expo-asset, which is modelled above.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 62, bottom: 34, left: 0, right: 0 }),
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

const video = jest.requireMock("expo-video") as ExpoVideoMock
const player = video.__player
const PARTS = DEVOTIONALS.pharisee.parts
/** iPhone 17 Pro, in points. */
const WINDOW = { width: 402, height: 874, scale: 3, fontScale: 1 }
/** The mocked safe area below. */
const INSETS = { top: 62, bottom: 34 }
/** One display frame. A test's animation frame is a zero-delay timer, so one
 *  display frame runs several of them. */
const FRAME_MS = 16

let renderer: TestInstance | null = null
const platformOs = Object.getOwnPropertyDescriptor(Platform, "OS")!
let onEnded: jest.Mock
let appStateHandlers: Array<(state: string) => void> = []

// The playhead. A write is a seek by the player under test; a tick moves it
// the way playback does. `dropSeeks` models a seek the player never applies.
let position = 0
let seeks: number[] = []
let dropSeeks = false

beforeEach(() => {
  jest.useFakeTimers()
  Dimensions.set({ window: WINDOW, screen: WINDOW })
  video.__reset()
  position = 0
  seeks = []
  dropSeeks = false
  mockFileFails = false
  Object.defineProperty(player, "currentTime", {
    configurable: true,
    get: () => position,
    set: (seconds: number) => {
      if (dropSeeks) return
      position = seconds
      seeks.push(seconds)
    },
  })
  onEnded = jest.fn()
  appStateHandlers = []
  jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _event: string,
    handler: (state: string) => void,
  ) => {
    appStateHandlers.push(handler)
    return {
      remove: () => {
        appStateHandlers = appStateHandlers.filter((h) => h !== handler)
      },
    }
  }) as never)
})

afterEach(async () => {
  if (renderer) await unmount(renderer)
  renderer = null
  // Back to the double's own data property.
  delete (player as { currentTime?: number }).currentTime
  player.currentTime = 0
  delete (player as { playbackRate?: number }).playbackRate
  player.playbackRate = 1
  mockGlass.liquid = false
  Object.defineProperty(Platform, "OS", platformOs)
  jest.useRealTimers()
  jest.restoreAllMocks()
})

function element(part: DevotionalPart, active: boolean, focused = true) {
  return (
    <StrictMode>
      <PartPlayer
        devotional={DEVOTIONALS.pharisee}
        part={part}
        active={active}
        focused={focused}
        font={font}
        onEnded={onEnded}
      />
    </StrictMode>
  )
}

async function mount(part: DevotionalPart, active = true) {
  await act(async () => {
    renderer = TestRenderer.create(element(part, active))
  })
  // The bundled file resolves.
  await act(async () => {})
}

async function rerender(part: DevotionalPart, active = true, focused = true) {
  await act(async () => {
    renderer!.update(element(part, active, focused))
  })
}

async function frames(count = 1) {
  await act(async () => {
    jest.advanceTimersByTime(FRAME_MS * count)
  })
}

async function becomeReady() {
  player.status = "readyToPlay"
  await act(async () => {
    player.__emit("statusChange", { status: "readyToPlay" })
  })
}

/** Playback moves the playhead and the player reports it. */
async function tick(seconds: number) {
  position = seconds
  await act(async () => {
    player.__emit("timeUpdate", {
      currentTime: seconds,
      bufferedPosition: seconds,
      currentLiveTimestamp: null,
      currentOffsetFromLive: null,
    })
  })
}

/** Ready, seeked, playing, and past the start: the cover is down. */
async function playPast(part: DevotionalPart) {
  await becomeReady()
  await frames(1)
  await tick(PARTS[part].startSec + 0.15)
  await frames(1)
  expect(covered()).toBe(false)
}

async function emitAppState(state: string) {
  await act(async () => {
    for (const handler of [...appStateHandlers]) handler(state)
  })
}

function hostByTestId(testID: string): RenderedNode[] {
  return renderer!.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === testID,
  )
}

function covered(): boolean {
  return hostByTestId("part-cover").length > 0
}

function cueShown(): boolean {
  return hostByTestId("part-paused-cue").length > 0
}

function hasAncestor(node: RenderedNode, ancestor: RenderedNode): boolean {
  for (let up = node.parent; up; up = up.parent) {
    if (up === ancestor) return true
  }
  return false
}

/** Every opacity a host ancestor of the cue's glass sets. */
function glassAncestorOpacities(): unknown[] {
  const [glass] = hostByTestId("part-paused-cue-glass")
  const faded: unknown[] = []
  for (let up = glass!.parent; up; up = up.parent) {
    if (typeof up.type !== "string") continue
    const opacity = StyleSheet.flatten(up.props.style as ViewStyle)?.opacity
    if (opacity != null) faded.push(opacity)
  }
  return faded
}

/** The one pressable inside the paused cue. */
function cueButton(): RenderedNode {
  const [cue] = hostByTestId("part-paused-cue")
  const buttons = renderer!.root.findAll(
    (node) =>
      typeof node.props.onPress === "function" && hasAncestor(node, cue!),
  )
  expect(buttons.length).toBeGreaterThan(0)
  return buttons[0]!
}

function hostButtons(): string[] {
  return renderer!.root
    .findAll(
      (node) =>
        typeof node.type === "string" &&
        node.props.accessibilityRole === "button",
    )
    .map((node) => node.props.accessibilityLabel as string)
}

async function tap(label: string) {
  await press(pressableByLabel(renderer!, label))
}

describe("the start of a part (KTD8)", () => {
  it("sends the seek on readiness and holds the cover until the part has started", async () => {
    await mount("film")
    await frames(10)

    expect(covered()).toBe(true)
    expect(seeks).toEqual([])
    expect(player.play).not.toHaveBeenCalled()

    await becomeReady()
    // The file is the player's first source, so no swap comes before it.
    expect(player.replaceAsync).not.toHaveBeenCalled()
    expect(seeks).toEqual([PARTS.film.startSec])

    await frames(1)
    expect(player.play).toHaveBeenCalledTimes(1)
    expect(player.muted).toBe(false)
    expect(covered()).toBe(true)

    // A stale frame can trail the seek, so time must move first.
    await tick(PARTS.film.startSec + 0.05)
    await frames(1)
    expect(covered()).toBe(true)

    await tick(PARTS.film.startSec + 0.15)
    await frames(1)
    expect(covered()).toBe(false)
  })

  it("keeps the cover and plays nothing while the seek has not landed", async () => {
    dropSeeks = true
    await mount("teaching")
    await becomeReady()
    await frames(60)

    expect(position).toBe(0)
    expect(covered()).toBe(true)
    expect(player.play).not.toHaveBeenCalled()
  })

  it("releases a part that never starts into Try again after the backstop", async () => {
    dropSeeks = true
    await mount("teaching")
    await becomeReady()

    await act(async () => {
      jest.advanceTimersByTime(PART_START_BACKSTOP_MS - 100)
    })
    expect(hostButtons()).not.toContain("Try again")

    await act(async () => {
      jest.advanceTimersByTime(200)
    })
    expect(hostButtons()).toContain("Try again")
    expect(covered()).toBe(true)

    // The next attempt's seek lands, and the part plays. StrictMode runs the
    // new player's first effect twice, so the one seek can arrive twice.
    dropSeeks = false
    await tap("Try again")
    await frames(1)
    expect(hostButtons()).not.toContain("Try again")
    expect([...new Set(seeks)]).toEqual([PARTS.teaching.startSec])
    expect(player.play).toHaveBeenCalledTimes(1)
  })
})

// Review #5: a file that could not be loaded left a black part with no way on.
describe("a video file that cannot be loaded", () => {
  it("offers Try again, and a tap loads the file and plays the part", async () => {
    mockFileFails = true
    await mount("film")
    expect(hostButtons()).toContain("Try again")
    expect(covered()).toBe(true)

    mockFileFails = false
    await tap("Try again")
    await act(async () => {})
    expect(hostButtons()).not.toContain("Try again")
    await becomeReady()
    await frames(2)
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it("stays quiet while the part waits behind the Reflect screen", async () => {
    mockFileFails = true
    await mount("prayer", false)
    expect(hostButtons()).not.toContain("Try again")
    expect(covered()).toBe(true)
  })
})

describe("the end of a part (KTD8)", () => {
  it("raises the cover, mutes, and pauses at the end minus the guard, and the run advances once", async () => {
    await mount("film")
    await playPast("film")
    player.pause.mockClear()
    const stopAt = PARTS.film.endSec - PART_END_GUARD_SECONDS

    // Inside the last stretch, a per-frame read of the player decides.
    await tick(stopAt - 1)
    await frames(5)
    position = stopAt - 0.02
    await frames(1)
    expect(covered()).toBe(false)
    expect(onEnded).not.toHaveBeenCalled()

    // The playhead passes the stop between two ticks.
    position = stopAt + 0.01
    await frames(1)

    expect(covered()).toBe(true)
    expect(player.muted).toBe(true)
    expect(player.pause).toHaveBeenCalledTimes(1)
    expect(player.playing).toBe(false)
    expect(onEnded).toHaveBeenCalledTimes(1)

    await tick(stopAt + 0.1)
    await frames(30)
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it("leads from the film's end to the teaching part with no frame of the step card range", async () => {
    await mount("film")
    await playPast("film")
    const filmStop = PARTS.film.endSec - PART_END_GUARD_SECONDS
    await tick(filmStop - 1)
    position = filmStop
    await frames(1)
    expect(onEnded).toHaveBeenCalledTimes(1)

    // The run moves on, and the cover renders. A seek flushes the frames the
    // player has queued, so it is not sent in the commit that adds the cover.
    await rerender("teaching")
    expect(covered()).toBe(true)
    expect(seeks).toEqual([PARTS.film.startSec])

    // Then the same player seeks straight past the card, and plays.
    await frames(1)
    expect(seeks).toEqual([PARTS.film.startSec, PARTS.teaching.startSec])
    await frames(1)
    expect(player.play).toHaveBeenCalledTimes(2)
    expect(player.muted).toBe(false)

    // The card fades out until 62.3 s, under the cover.
    await tick(62.267)
    await frames(1)
    expect(covered()).toBe(true)

    await tick(62.3)
    await frames(1)
    expect(covered()).toBe(false)
  })
})

// The owner, 2026-10-13: no step cuts to the next. A part fades in from its
// cover and fades to it, inside the run's step dip.
describe("the cover's fade", () => {
  const realTiming = Animated.timing
  beforeEach(() => {
    // Jest's native driver ends after one frame at the start value, so these
    // tests step the same timings on the JS driver.
    jest
      .spyOn(Animated, "timing")
      .mockImplementation((value, config) =>
        realTiming(value, { ...config, useNativeDriver: false }),
      )
  })
  afterEach(() => {
    jest.mocked(Animated.timing).mockRestore()
  })

  function coverOpacity(testID: string): number {
    const [cover] = hostByTestId(testID)
    return StyleSheet.flatten(cover!.props.style as ViewStyle).opacity as number
  }

  it("covers a new part fully from its first render", async () => {
    await mount("film")
    expect(coverOpacity("part-cover")).toBe(1)
  })

  it("lifts the cover over a part that starts, then removes it", async () => {
    await mount("film")
    await playPast("film")
    const half = coverOpacity("part-cover-leaving")
    expect(half).toBeGreaterThan(0)
    expect(half).toBeLessThanOrEqual(1)
    await act(async () => {
      jest.advanceTimersByTime(COVER_LIFT_MS / 2)
    })
    expect(coverOpacity("part-cover-leaving")).toBeLessThan(half)
    await act(async () => {
      jest.advanceTimersByTime(COVER_LIFT_MS)
    })
    expect(hostByTestId("part-cover-leaving")).toHaveLength(0)
    expect(covered()).toBe(false)
  })

  /** Plays the part past its lift, then lets it reach its stop. */
  async function stopPart(part: DevotionalPart) {
    await playPast(part)
    await act(async () => {
      jest.advanceTimersByTime(COVER_LIFT_MS * 2)
    })
    const stopAt = PARTS[part].endSec - PART_END_GUARD_SECONDS
    await tick(stopAt - 1)
    await frames(5)
    position = stopAt + 0.01
    await frames(1)
  }

  it("settles the cover over the still frame of a part that stops", async () => {
    await mount("film")
    await stopPart("film")
    expect(covered()).toBe(true)
    expect(player.playing).toBe(false)
    expect(coverOpacity("part-cover")).toBeLessThan(0.5)
    await act(async () => {
      jest.advanceTimersByTime(COVER_SETTLE_MS)
    })
    expect(coverOpacity("part-cover")).toBe(1)
  })

  // Code review, 2026-10-13: the end of each dip renders the run again, and
  // that render reversed a lift that was still running.
  it("keeps lifting when the run renders again during the lift", async () => {
    await mount("film")
    await playPast("film")
    await act(async () => {
      jest.advanceTimersByTime(COVER_LIFT_MS / 4)
    })
    const before = coverOpacity("part-cover-leaving")
    await rerender("film")
    await act(async () => {
      jest.advanceTimersByTime(COVER_LIFT_MS / 4)
    })
    expect(coverOpacity("part-cover-leaving")).toBeLessThan(before)
  })

  // With Reduce Motion every dip is quick, so the step changes before the
  // settle ends. The next part must still wait behind a full cover.
  it("covers the next part fully when the run moves on during the settle", async () => {
    await mount("teaching")
    await stopPart("teaching")
    await act(async () => {
      jest.advanceTimersByTime(DIP_TIMINGS.jump.swapMs)
    })
    expect(coverOpacity("part-cover")).toBeLessThan(1)

    await rerender("prayer", false)
    expect(coverOpacity("part-cover")).toBe(1)
    await act(async () => {
      jest.advanceTimersByTime(COVER_SETTLE_MS)
    })
    expect(coverOpacity("part-cover")).toBe(1)
  })
})

// Review #6: a screen pushed above the run, such as a watch page from a push
// tap, left the part playing under it, so two soundtracks played at once.
describe("a screen above the run", () => {
  it("holds the part like an interruption, and only a tap resumes it", async () => {
    await mount("film")
    await playPast("film")
    await tick(30)
    expect(player.playing).toBe(true)

    await rerender("film", true, false)
    expect(player.playing).toBe(false)
    // The part does not move on while the screen above it is open.
    await frames(600)
    expect(onEnded).not.toHaveBeenCalled()

    await rerender("film", true, true)
    expect(player.playing).toBe(false)
    expect(cueShown()).toBe(true)
    await tap("Resume video")
    expect(player.playing).toBe(true)
    expect(position).toBe(30)
  })
})

describe("the viewer's tap (R14, AE5)", () => {
  it("pauses the part, and a second tap resumes it from the same position", async () => {
    await mount("film")
    await playPast("film")
    await tick(30)

    await tap("Pause video")
    expect(player.playing).toBe(false)
    expect(cueShown()).toBe(true)
    expect(covered()).toBe(false)

    // A long pause does not move the part on.
    await frames(600)
    expect(onEnded).not.toHaveBeenCalled()

    await tap("Resume video")
    expect(player.playing).toBe(true)
    expect(cueShown()).toBe(false)
    expect(position).toBe(30)
    expect(seeks).toEqual([PARTS.film.startSec])
  })

  // The owner, 2026-10-09: a play triangle in a translucent disc replaces the
  // "Paused · Tap to resume" line, so the cue needs no text.
  it("shows a play triangle in a disc at the center of the picture, with no text", async () => {
    await mount("film")
    await playPast("film")
    await tap("Pause video")

    const [cue] = hostByTestId("part-paused-cue")
    const cueStyle = StyleSheet.flatten(cue!.props.style as ViewStyle)
    const { frame } = runVideoLayout(WINDOW.width, WINDOW.height, INSETS)
    const cueHeight = Number(cueStyle.height)
    expect(Number(cueStyle.top) + cueHeight / 2).toBeCloseTo(
      frame.top + frame.height / 2,
      5,
    )

    const [disc] = hostByTestId("part-paused-cue-disc")
    const discStyle = StyleSheet.flatten(disc!.props.style as ViewStyle)
    expect(discStyle.width).toBe(cueHeight)
    expect(discStyle.borderRadius).toBe(cueHeight / 2)
    expect(String(discStyle.backgroundColor)).toMatch(/^rgba\(.*, 0\.\d+\)$/)

    const glyphs = renderer!.root.findAll(
      (node) =>
        node.props.name === "play" && typeof node.props.size === "number",
    )
    expect(glyphs.length).toBeGreaterThan(0)
    const texts = renderer!.root.findAll(
      (node) =>
        node.type === "Text" &&
        typeof node.props.children === "string" &&
        /paused|resume/i.test(node.props.children),
    )
    expect(texts.length).toBe(0)
    // A screen reader still hears what a tap does.
    expect(hostButtons()).toContain("Resume video")
  })

  it("resumes at a tap on the disc itself", async () => {
    await mount("film")
    await playPast("film")
    await tap("Pause video")
    expect(player.playing).toBe(false)

    await press(cueButton())
    expect(player.playing).toBe(true)
    expect(cueShown()).toBe(false)
  })

  // The owner, 2026-10-14: the cue fades in as it fades out.
  it("fades the disc in when the viewer pauses", async () => {
    await mount("film")
    await playPast("film")
    const timing = jest.spyOn(Animated, "timing")
    await tap("Pause video")
    const [disc] = hostByTestId("part-paused-cue-fade")
    expect(StyleSheet.flatten(disc!.props.style as ViewStyle).opacity).toBe(0)

    await frames(2)
    const fadesIn = timing.mock.calls.filter(
      ([, config]) => config.duration === CUE_FADE_MS && config.toValue === 1,
    )
    expect(fadesIn).toHaveLength(1)
    expect(fadesIn[0]![1].useNativeDriver).toBe(true)
  })

  // The owner, 2026-10-09: the cue fades out instead of vanishing.
  it("fades the disc out after a resume, takes no tap while it fades, then unmounts", async () => {
    await mount("film")
    await playPast("film")
    await tap("Pause video")
    await frames(2)
    const timing = jest.spyOn(Animated, "timing")

    await tap("Resume video")
    const [leaving] = hostByTestId("part-paused-cue-leaving")
    expect(leaving!.props.pointerEvents).toBe("none")
    expect(hostByTestId("part-paused-cue-fade").length).toBe(1)
    const fades = timing.mock.calls.filter(
      ([, config]) => config.duration === CUE_FADE_MS && config.toValue === 0,
    )
    expect(fades).toHaveLength(1)
    expect(fades[0]![1].useNativeDriver).toBe(true)

    await act(async () => {
      jest.advanceTimersByTime(CUE_FADE_MS)
    })
    expect(hostByTestId("part-paused-cue-leaving").length).toBe(0)
    expect(cueShown()).toBe(false)
  })

  // iOS keeps the faded native opacity on a reused view, so a new pause needs
  // a new view (code review, 2026-10-12). That view fades in from clear.
  it("brings the cue back on a new view, fading in, when the viewer pauses again during the fade", async () => {
    await mount("film")
    await playPast("film")
    await tap("Pause video")
    await frames(2)
    await tap("Resume video")
    const [fading] = hostByTestId("part-paused-cue-leaving")
    const [fadingDisc] = hostByTestId("part-paused-cue-fade")

    await tap("Pause video")
    expect(cueShown()).toBe(true)
    expect(hostByTestId("part-paused-cue-leaving").length).toBe(0)
    const [cue] = hostByTestId("part-paused-cue")
    const [disc] = hostByTestId("part-paused-cue-fade")
    expect(cue === fading).toBe(false)
    expect(disc === fadingDisc).toBe(false)
    expect(StyleSheet.flatten(disc!.props.style as ViewStyle).opacity).toBe(0)
    await act(async () => {
      jest.advanceTimersByTime(CUE_FADE_MS * 2)
    })
    expect(cueShown()).toBe(true)
  })

  // Before 2026-10-12 the cue faded over the next part after a jump while paused.
  it("drops the cue at once when the run moves to another part while paused", async () => {
    await mount("film")
    await playPast("film")
    await tap("Pause video")
    expect(cueShown()).toBe(true)

    await rerender("prayer")
    expect(cueShown()).toBe(false)
    expect(hostByTestId("part-paused-cue-leaving").length).toBe(0)
  })

  // The owner, 2026-10-09: where iOS has Liquid Glass, the cue is a native
  // glass button, like the run's pills.
  describe("with Liquid Glass", () => {
    beforeEach(() => {
      mockGlass.liquid = true
      Object.defineProperty(Platform, "OS", { get: () => "ios" })
    })

    it("draws the cue on native glass, and a tap on it resumes", async () => {
      await mount("film")
      await playPast("film")
      await tap("Pause video")
      await frames(2)

      expect(hostByTestId("part-paused-cue-disc").length).toBe(0)
      const [glass] = hostByTestId("part-paused-cue-glass")
      expect(glass!.type).toBe("GlassView")
      expect(glass!.props).toMatchObject({
        glassEffectStyle: { style: "regular" },
        colorScheme: "dark",
      })
      const glassStyle = StyleSheet.flatten(glass!.props.style as ViewStyle)
      expect(glassStyle.borderRadius).toBe(Number(glassStyle.width) / 2)
      const glyphs = renderer!.root.findAll(
        (node) => node.props.name === "play" && hasAncestor(node, glass!),
      )
      expect(glyphs.length).toBeGreaterThan(0)

      await press(cueButton())
      expect(player.playing).toBe(true)
      expect(cueShown()).toBe(false)
    })

    // GlassView draws no material under an ancestor that sets an opacity.
    it("sets no opacity on any ancestor of the glass, paused or fading", async () => {
      await mount("film")
      await playPast("film")
      await tap("Pause video")
      expect(glassAncestorOpacities()).toEqual([])

      await tap("Resume video")
      expect(hostByTestId("part-paused-cue-leaving").length).toBe(1)
      expect(glassAncestorOpacities()).toEqual([])
    })

    // The owner, 2026-10-14: the glass fades in too. iOS animates no glass
    // change in the frame that first draws it, so the change waits two frames.
    it("lets the glass arrive through its own native animation, two frames after it mounts", async () => {
      await mount("film")
      await playPast("film")
      await tap("Pause video")
      const [mounted] = hostByTestId("part-paused-cue-glass")
      expect(mounted!.props.glassEffectStyle).toMatchObject({ style: "none" })

      await frames(2)
      const [arrived] = hostByTestId("part-paused-cue-glass")
      expect(arrived!.props.glassEffectStyle).toEqual({
        style: "regular",
        animate: true,
        animationDuration: CUE_FADE_MS / 1000,
      })
      expect(glassAncestorOpacities()).toEqual([])
    })

    it("lets the glass leave through its own native animation, and fades only the glyph", async () => {
      await mount("film")
      await playPast("film")
      await tap("Pause video")
      await frames(2)
      const [shown] = hostByTestId("part-paused-cue-glass")
      expect(shown!.props.glassEffectStyle).toMatchObject({ style: "regular" })

      await tap("Resume video")
      const [glass] = hostByTestId("part-paused-cue-glass")
      expect(glass!.props.glassEffectStyle).toEqual({
        style: "none",
        animate: true,
        animationDuration: CUE_FADE_MS / 1000,
      })
      const [glyph] = hostByTestId("part-paused-cue-glyph")
      expect(hasAncestor(glyph!, glass!)).toBe(true)

      await act(async () => {
        jest.advanceTimersByTime(CUE_FADE_MS)
      })
      expect(hostByTestId("part-paused-cue-glass").length).toBe(0)
    })
  })
})

describe("an interruption (R26, KTD9)", () => {
  it("holds the part through a background, with the cue, until a tap", async () => {
    await mount("teaching")
    await playPast("teaching")
    await tick(100)

    await emitAppState("background")
    expect(player.playing).toBe(false)
    expect(cueShown()).toBe(true)

    player.play.mockClear()
    await emitAppState("active")
    await frames(30)
    expect(player.play).not.toHaveBeenCalled()
    expect(player.playing).toBe(false)
    expect(cueShown()).toBe(true)

    await tap("Resume video")
    expect(player.playing).toBe(true)
    expect(cueShown()).toBe(false)
    expect(position).toBe(100)
  })

  it("shows the cue for a pause the viewer did not cause, such as an audio interruption", async () => {
    await mount("film")
    await playPast("film")
    expect(cueShown()).toBe(false)

    // The audio session stops the player; the app stays in front.
    await act(async () => {
      player.playing = false
      player.__emit("playingChange", { isPlaying: false })
    })

    expect(cueShown()).toBe(true)
    expect(hostButtons()).toContain("Resume video")
  })
})

describe("a part change in the middle of playback", () => {
  // Only the developer Skip changes the part before its end; the old part's
  // sound must not run on under the next step.
  it.each<[DevotionalPart, boolean]>([
    ["teaching", true],
    ["prayer", false],
  ])(
    "mutes and pauses the player at once (to %s, active %s)",
    async (next, active) => {
      await mount("film")
      await playPast("film")
      expect(player.muted).toBe(false)
      player.pause.mockClear()

      await rerender(next, active)

      expect(player.muted).toBe(true)
      expect(player.pause).toHaveBeenCalled()
      expect(covered()).toBe(true)
    },
  )
})

describe("between parts", () => {
  it("holds the next part paused and covered, then plays it when the run reaches it", async () => {
    await mount("prayer", false)
    await becomeReady()
    await frames(30)

    expect(seeks).toEqual([PARTS.prayer.startSec])
    expect(player.play).not.toHaveBeenCalled()
    expect(covered()).toBe(true)
    expect(hostButtons()).toEqual([])
    expect(hostByTestId("part-progress")).toHaveLength(0)

    await rerender("prayer", true)
    await frames(1)
    expect(player.play).toHaveBeenCalledTimes(1)
    await tick(PARTS.prayer.startSec + 0.15)
    await frames(1)
    expect(covered()).toBe(false)
  })
})

describe("the video view (KTD7)", () => {
  it("fits the whole frame, with no Live Text, no picture-in-picture, and no native controls", async () => {
    await mount("film")
    const props = video.VideoView.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >

    expect(props.contentFit).toBe("contain")
    // The view is the picture's own box, below the bar (the owner, 2026-10-14).
    const { frame } = runVideoLayout(WINDOW.width, WINDOW.height, INSETS)
    expect(StyleSheet.flatten(props.style as ViewStyle)).toMatchObject({
      position: "absolute",
      top: frame.top,
      left: frame.left,
      width: frame.width,
      height: frame.height,
    })
    expect(props.allowsVideoFrameAnalysis).toBe(false)
    // The picture's foot fades into the run's ground, under the bar.
    const [fade] = hostByTestId("part-bottom-fade")
    const fadeStyle = StyleSheet.flatten(fade!.props.style as ViewStyle)
    expect(fade!.props.pointerEvents).toBe("none")
    expect(
      (fadeStyle.top as number) + (fadeStyle.height as number),
    ).toBeCloseTo(frame.top + frame.height, 5)
    expect(fadeStyle.left).toBe(frame.left)
    expect(fadeStyle.width).toBe(frame.width)
    // The native view takes processed colors.
    expect((fade!.props.colors as unknown[]).at(-1)).toBe(
      processColor(pauseColors.background),
    )
    // The picture's top edge fades from the ground too (the owner,
    // 2026-10-14), and the markers sit over that fade.
    const [top] = hostByTestId("part-top-fade")
    const topStyle = StyleSheet.flatten(top!.props.style as ViewStyle)
    expect(top!.props.pointerEvents).toBe("none")
    expect(topStyle.top).toBe(frame.top)
    expect(topStyle.left).toBe(frame.left)
    expect(topStyle.width).toBe(frame.width)
    expect((top!.props.colors as unknown[])[0]).toBe(
      processColor(pauseColors.background),
    )
    expect((top!.props.colors as unknown[]).at(-1)).toBe(
      processColor(hexToRgba(pauseColors.background, 0)),
    )
    const { rowTop } = runVideoLayout(WINDOW.width, WINDOW.height, INSETS)
    expect(frame.top + (topStyle.height as number)).toBeGreaterThan(rowTop + 44)
    expect(props.nativeControls).toBe(false)
    expect(
      Object.keys(props).filter((name) => /PictureInPicture/.test(name)),
    ).toEqual([])
    expect(player.timeUpdateEventInterval).toBe(0.25)
  })
})

describe("the progress bar (R12, R24)", () => {
  it("sits on the picture's bottom edge and fills with the projected time", async () => {
    await mount("film")
    await playPast("film")

    const [bar] = hostByTestId("part-progress")
    const [track] = hostByTestId("part-progress-track")
    const style = StyleSheet.flatten(bar!.props.style as ViewStyle)
    const trackStyle = StyleSheet.flatten(track!.props.style as ViewStyle)
    const layout = runVideoLayout(WINDOW.width, WINDOW.height, INSETS)
    expect(trackStyle.height).toBe(3)
    // The line sits on the picture's bottom edge (the owner, 2026-10-14).
    const lineTop = (style.top as number) + (trackStyle.marginTop as number)
    expect(lineTop).toBe(layout.barTop)
    expect(lineTop + 3).toBeCloseTo(layout.frame.top + layout.frame.height, 5)
    // A full 44 pt touch strip, far from the marker row at the top, that ends
    // at the bottom safe area, clear of the home indicator.
    expect(style.height).toBe(44)
    expect(style.top as number).toBeGreaterThan(layout.rowTop + 44)
    expect((style.top as number) + 44).toBe(WINDOW.height - INSETS.bottom)

    // Ten seconds with no tick: the projection carries the fill.
    await act(async () => {
      jest.advanceTimersByTime(10_000)
    })
    const [fill] = renderer!.root.findAll(
      (node) => node.props.testID === "part-progress-fill",
    )
    const transform = StyleSheet.flatten(fill!.props.style as ViewStyle)
      .transform as unknown as [{ scaleX: Animated.Value }]
    const scale = (
      transform[0].scaleX as unknown as { __getValue(): number }
    ).__getValue()
    const stopAt = PARTS.film.endSec - PART_END_GUARD_SECONDS
    expect(scale).toBeCloseTo(10.15 / (stopAt - PARTS.film.startSec), 2)
    expect(hasText(renderer!, "Paused")).toBe(false)
  })
})

// The owner, 2026-10-14: a tap or a drag on the bar seeks, as on the app's
// Explore clips. A seek stays inside the part, so the skipped range after it
// never shows (KTD8).
describe("the timeline", () => {
  let touchClock = 1000
  /** One finger, with the history PanResponder derives its gesture from. */
  function touchAt(x: number, previousX = x): GestureResponderEvent {
    touchClock += 16
    return {
      nativeEvent: { touches: [], changedTouches: [], locationX: x, pageX: x },
      touchHistory: {
        numberActiveTouches: 1,
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: touchClock,
        touchBank: [
          {
            touchActive: true,
            startPageX: previousX,
            startPageY: 0,
            startTimeStamp: touchClock - 32,
            currentPageX: x,
            currentPageY: 0,
            currentTimeStamp: touchClock,
            previousPageX: previousX,
            previousPageY: 0,
            previousTimeStamp: touchClock - 16,
          },
        ],
      },
    } as unknown as GestureResponderEvent
  }

  type BarHandlers = {
    onLayout: (e: unknown) => void
    onStartShouldSetResponder: (e: GestureResponderEvent) => boolean
    onResponderGrant: (e: GestureResponderEvent) => void
    onResponderMove: (e: GestureResponderEvent) => void
    onResponderRelease: (e: GestureResponderEvent) => void
    onResponderTerminate: (e: GestureResponderEvent) => void
    onAccessibilityAction: (e: unknown) => void
  }

  function bar(): RenderedNode {
    const [node] = hostByTestId("part-progress")
    return node!
  }

  async function laidOut(): Promise<BarHandlers> {
    const handlers = bar().props as BarHandlers
    await act(async () => {
      handlers.onLayout({
        nativeEvent: {
          layout: { x: 0, y: 0, width: WINDOW.width, height: 44 },
        },
      })
    })
    return bar().props as BarHandlers
  }

  async function grant(x: number) {
    const handlers = await laidOut()
    await act(async () => {
      expect(handlers.onStartShouldSetResponder(touchAt(x))).toBe(true)
      handlers.onResponderGrant(touchAt(x))
    })
  }

  async function moveTo(x: number, from: number) {
    await act(async () => {
      ;(bar().props as BarHandlers).onResponderMove(touchAt(x, from))
    })
  }

  async function release(x: number) {
    await act(async () => {
      ;(bar().props as BarHandlers).onResponderRelease(touchAt(x))
    })
  }

  function fill(): number {
    const [node] = renderer!.root.findAll(
      (n) => n.props.testID === "part-progress-fill",
    )
    const transform = StyleSheet.flatten(node!.props.style as ViewStyle)
      .transform as unknown as [{ scaleX: { __getValue(): number } }]
    return transform[0].scaleX.__getValue()
  }

  it("takes no touch until the part shows", async () => {
    await mount("film")
    expect(bar().props.pointerEvents).toBe("none")
    expect(bar().props.accessible).toBe(false)
    await playPast("film")
    expect(bar().props.pointerEvents).toBe("auto")
    expect(bar().props.accessible).toBe(true)
    expect(bar().props.accessibilityRole).toBe("adjustable")
  })

  it("seeks to the tapped place inside the part, and plays on", async () => {
    await mount("film")
    await playPast("film")
    const x = WINDOW.width / 4
    await grant(x)
    await release(x)
    expect(seeks.at(-1)).toBeCloseTo(partTimeAt(0.25, PARTS.film), 3)
    expect(fill()).toBeCloseTo(0.25, 3)
    expect(player.playing).toBe(true)
  })

  it("drags with a thumb and a time pill, and seeks only when the finger lifts", async () => {
    await mount("film")
    await playPast("film")
    const seeksBefore = seeks.length
    const from = WINDOW.width * 0.2
    const to = WINDOW.width * 0.6
    await grant(from)
    await moveTo(to, from)
    expect(hostByTestId("part-progress-thumb")).toHaveLength(1)
    expect(hostByTestId("part-scrub-pill")).toHaveLength(1)
    // Above the bar, where the finger does not cover it.
    const [pill] = hostByTestId("part-scrub-pill")
    const pillStyle = StyleSheet.flatten(pill!.props.style as ViewStyle)
    expect(pillStyle.bottom as number).toBeGreaterThan(24)
    expect(pillStyle.top).toBeUndefined()
    // 0.6 of the film part's 46 s, start to stop.
    expect(hasText(renderer!, "0:27 / 0:46")).toBe(true)
    expect(seeks.length).toBe(seeksBefore)
    // The part plays on under the drag, and the fill stays with the finger.
    await frames(10)
    expect(fill()).toBeCloseTo(0.6, 3)

    await release(to)
    expect(seeks.at(-1)).toBeCloseTo(partTimeAt(0.6, PARTS.film), 3)
    expect(hostByTestId("part-progress-thumb")).toHaveLength(0)
    expect(hostByTestId("part-scrub-pill")).toHaveLength(0)
  })

  it("shows the playing place again when the system takes the drag", async () => {
    await mount("film")
    await playPast("film")
    const seeksBefore = seeks.length
    await grant(WINDOW.width * 0.8)
    await act(async () => {
      ;(bar().props as BarHandlers).onResponderTerminate(touchAt(0))
    })
    expect(seeks.length).toBe(seeksBefore)
    expect(fill()).toBeLessThan(0.05)
  })

  it("ends the part when the seek reaches its stop, as if it played out", async () => {
    await mount("film")
    await playPast("film")
    await grant(WINDOW.width)
    await release(WINDOW.width)
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(covered()).toBe(true)
    expect(player.playing).toBe(false)
    // No seek ever lands past the stop.
    const stopAt = PARTS.film.endSec - PART_END_GUARD_SECONDS
    expect(Math.max(...seeks)).toBeLessThanOrEqual(stopAt)
  })

  it("keeps a held part held when the viewer seeks", async () => {
    await mount("film")
    await playPast("film")
    await tap("Pause video")
    expect(player.playing).toBe(false)
    await grant(WINDOW.width / 2)
    await release(WINDOW.width / 2)
    expect(seeks.at(-1)).toBeCloseTo(partTimeAt(0.5, PARTS.film), 3)
    expect(player.playing).toBe(false)
    expect(cueShown()).toBe(true)
  })

  async function reachStop() {
    const stopAt = PARTS.film.endSec - PART_END_GUARD_SECONDS
    await tick(stopAt - 1)
    await frames(5)
    position = stopAt + 0.01
    await frames(1)
  }

  // As on Explore's clips: the release, not the stop, decides what happens.
  it("waits at the stop under a dragging finger, and seeks where it lifts", async () => {
    await mount("film")
    await playPast("film")
    await grant(WINDOW.width * 0.2)
    await reachStop()
    expect(onEnded).not.toHaveBeenCalled()
    expect(player.playing).toBe(false)
    expect(player.muted).toBe(true)
    expect(covered()).toBe(false)

    await release(WINDOW.width * 0.2)
    expect(seeks.at(-1)).toBeCloseTo(partTimeAt(0.2, PARTS.film), 3)
    expect(player.playing).toBe(true)
    expect(player.muted).toBe(false)
    await frames(5)
    expect(onEnded).not.toHaveBeenCalled()
  })

  it("ends a waiting part when the drag lifts at the end", async () => {
    await mount("film")
    await playPast("film")
    await grant(WINDOW.width * 0.2)
    await reachStop()
    await moveTo(WINDOW.width, WINDOW.width * 0.2)
    await release(WINDOW.width)
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(covered()).toBe(true)
  })

  // Home, a lock, or a call takes the touch: nothing may play unseen (KTD9).
  it("holds a waiting part when the system takes the drag, and a tap ends it", async () => {
    await mount("film")
    await playPast("film")
    await grant(WINDOW.width * 0.2)
    await reachStop()
    await act(async () => {
      ;(bar().props as BarHandlers).onResponderTerminate(touchAt(0))
    })
    expect(onEnded).not.toHaveBeenCalled()
    expect(player.playing).toBe(false)
    expect(cueShown()).toBe(true)

    // The tap ends the part at its stop and plays nothing past it (KTD8).
    const plays = player.play.mock.calls.length
    await tap("Resume video")
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(covered()).toBe(true)
    expect(player.play.mock.calls.length).toBe(plays)
    expect(player.playing).toBe(false)
  })

  it("keeps a part held when a hold comes while it waits at the stop", async () => {
    await mount("film")
    await playPast("film")
    await grant(WINDOW.width * 0.2)
    await reachStop()
    // A screen above the run takes the focus under the finger.
    await rerender("film", true, false)
    await release(WINDOW.width * 0.2)
    expect(seeks.at(-1)).toBeCloseTo(partTimeAt(0.2, PARTS.film), 3)
    expect(player.playing).toBe(false)
    expect(cueShown()).toBe(true)
    expect(onEnded).not.toHaveBeenCalled()

    // Only the viewer's tap resumes it.
    await rerender("film", true, true)
    await tap("Resume video")
    expect(player.playing).toBe(true)
  })

  it("never seeks the next part with a drag that began over the last one", async () => {
    await mount("film")
    await playPast("film")
    await grant(WINDOW.width * 0.2)
    const stale = bar().props as BarHandlers
    await rerender("teaching")
    await playPast("teaching")
    // The new part's bar starts with no drag.
    expect(hostByTestId("part-progress-thumb")).toHaveLength(0)
    const seeksBefore = seeks.length
    await act(async () => {
      stale.onResponderRelease(touchAt(WINDOW.width * 0.6))
    })
    expect(seeks.length).toBe(seeksBefore)
    expect(player.playing).toBe(true)
  })

  it("steps 5 s for a screen reader", async () => {
    await mount("film")
    await playPast("film")
    const handlers = await laidOut()
    await act(async () => {
      handlers.onAccessibilityAction({
        nativeEvent: { actionName: "increment" },
      })
    })
    expect(seeks.at(-1)).toBeCloseTo(PARTS.film.startSec + 0.15 + 5, 1)
  })
})

// The owner, 2026-10-14: as on Instagram, a hold on either side of the
// picture plays the part at 2x until the finger lifts.
describe("the 2x hold", () => {
  type Surface = {
    onPressIn: (e: { nativeEvent: { pageX: number } }) => void
    onLongPress: () => void
    onPressOut: () => void
  }
  function surface(label = "Pause video"): Surface {
    return pressableByLabel(renderer!, label).props as unknown as Surface
  }

  async function holdAt(x: number, label = "Pause video") {
    await act(async () => {
      surface(label).onPressIn({ nativeEvent: { pageX: x } })
    })
    await act(async () => {
      surface(label).onLongPress()
    })
  }

  async function lift(label = "Pause video") {
    await act(async () => {
      surface(label).onPressOut()
    })
  }

  function fastCue(): boolean {
    return hostByTestId("part-fast-cue").length > 0
  }

  it.each([
    ["left", 20],
    ["right", WINDOW.width - 20],
  ])(
    "plays at 2x while the %s side is held, and at 1x when it lifts",
    async (_side, x) => {
      await mount("film")
      await playPast("film")
      await holdAt(x)
      expect(player.playbackRate).toBe(PART_FAST_RATE)
      expect(fastCue()).toBe(true)
      // Below the marker row, which sits over the picture.
      const [cue] = hostByTestId("part-fast-cue")
      const { rowTop } = runVideoLayout(WINDOW.width, WINDOW.height, INSETS)
      expect(
        StyleSheet.flatten(cue!.props.style as ViewStyle).top as number,
      ).toBeGreaterThanOrEqual(rowTop + 44)
      await lift()
      expect(player.playbackRate).toBe(1)
      expect(fastCue()).toBe(false)
      // The lift is not a tap: the part plays on.
      expect(player.playing).toBe(true)
    },
  )

  it("works as a tap for a long press in the middle", async () => {
    await mount("film")
    await playPast("film")
    await holdAt(WINDOW.width / 2)
    expect(player.playbackRate).toBe(1)
    expect(player.playing).toBe(true)
    await lift()
    expect(player.playing).toBe(false)
    expect(cueShown()).toBe(true)
  })

  it("still pauses on a short tap on a side", async () => {
    await mount("film")
    await playPast("film")
    await act(async () => {
      surface().onPressIn({ nativeEvent: { pageX: 20 } })
    })
    await lift()
    await tap("Pause video")
    expect(player.playing).toBe(false)
    expect(player.playbackRate).toBe(1)
  })

  it("moves the bar twice as fast while held", async () => {
    await mount("film")
    await playPast("film")
    const fillValue = () => {
      const [node] = renderer!.root.findAll(
        (n) => n.props.testID === "part-progress-fill",
      )
      const transform = StyleSheet.flatten(node!.props.style as ViewStyle)
        .transform as unknown as [{ scaleX: { __getValue(): number } }]
      return transform[0].scaleX.__getValue()
    }
    await holdAt(20)
    const before = fillValue()
    await act(async () => {
      jest.advanceTimersByTime(1000)
    })
    const length =
      PARTS.film.endSec - PART_END_GUARD_SECONDS - PARTS.film.startSec
    expect(fillValue() - before).toBeCloseTo(2 / length, 2)
  })

  it("ends the 2x play on an interruption, a part change, and the stop", async () => {
    await mount("film")
    await playPast("film")
    await holdAt(20)
    expect(player.playbackRate).toBe(PART_FAST_RATE)
    // An audio interruption pauses the player. The 1x rate waits for the
    // resume, because on iOS a rate write starts a paused player.
    player.playing = false
    await act(async () => {
      player.__emit("playingChange", { isPlaying: false })
    })
    expect(fastCue()).toBe(false)

    await tap("Resume video")
    expect(player.playbackRate).toBe(1)
    await holdAt(20)
    expect(player.playbackRate).toBe(PART_FAST_RATE)
    await rerender("teaching")
    expect(player.playbackRate).toBe(1)
  })

  /** As on iOS: a rate write starts a paused player (VideoPlayer.swift). */
  function startOnRateWrite(): { starts: number } {
    const counts = { starts: 0 }
    let nativeRate = player.playbackRate
    Object.defineProperty(player, "playbackRate", {
      configurable: true,
      get: () => nativeRate,
      set: (next: number) => {
        nativeRate = next
        if (player.playing || next === 0) return
        counts.starts += 1
        player.playing = true
        player.__emit("playingChange", { isPlaying: true })
      },
    })
    return counts
  }

  it("keeps a part held when an interruption ends the 2x play", async () => {
    await mount("film")
    await playPast("film")
    startOnRateWrite()
    await holdAt(20)
    expect(player.playbackRate).toBe(PART_FAST_RATE)
    // The app goes to the background under the finger.
    player.playing = false
    await act(async () => {
      player.__emit("playingChange", { isPlaying: false })
    })
    await lift("Resume video")
    expect(player.playing).toBe(false)
    expect(cueShown()).toBe(true)

    await tap("Resume video")
    expect(player.playing).toBe(true)
    expect(player.playbackRate).toBe(1)
  })

  it("sets the 1x rate before it plays, as iOS plays at the last rate", async () => {
    await mount("film")
    await playPast("film")
    await holdAt(20)
    player.playing = false
    await act(async () => {
      player.__emit("playingChange", { isPlaying: false })
    })
    const ratesAtPlay: number[] = []
    const playImpl = player.play.getMockImplementation()!
    player.play.mockImplementation(() => {
      ratesAtPlay.push(player.playbackRate)
      playImpl()
    })
    try {
      await tap("Resume video")
    } finally {
      player.play.mockImplementation(playImpl)
    }
    expect(ratesAtPlay).toEqual([1])
  })

  it("applies the 1x rate when the player goes on by itself", async () => {
    await mount("film")
    await playPast("film")
    await holdAt(20)
    player.playing = false
    await act(async () => {
      player.__emit("playingChange", { isPlaying: false })
    })
    player.playing = true
    await act(async () => {
      player.__emit("playingChange", { isPlaying: true })
    })
    expect(player.playbackRate).toBe(1)
  })

  it("writes no rate to a paused player when the part changes", async () => {
    await mount("film")
    await playPast("film")
    await tap("Pause video")
    const counts = startOnRateWrite()
    await rerender("teaching")
    expect(counts.starts).toBe(0)
    expect(player.playing).toBe(false)
  })

  it("writes no rate when a player at 2x pauses itself before a part change", async () => {
    await mount("film")
    await playPast("film")
    await holdAt(20)
    const counts = startOnRateWrite()
    // The native player has paused, and its playingChange has not come yet.
    player.playing = false
    await rerender("teaching")
    expect(counts.starts).toBe(0)
    expect(player.playing).toBe(false)
  })

  it("takes no 2x hold while the part is paused: the hold is a tap", async () => {
    await mount("film")
    await playPast("film")
    await tap("Pause video")
    await holdAt(20, "Resume video")
    expect(player.playbackRate).toBe(1)
    expect(fastCue()).toBe(false)
    expect(player.playing).toBe(false)
    await lift("Resume video")
    expect(player.playing).toBe(true)
    expect(player.playbackRate).toBe(1)
  })

  it("ends the 2x play when the part reaches its stop", async () => {
    await mount("film")
    await playPast("film")
    await holdAt(20)
    const stopAt = PARTS.film.endSec - PART_END_GUARD_SECONDS
    await tick(stopAt - 1)
    await frames(5)
    position = stopAt + 0.01
    await frames(1)
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(player.playbackRate).toBe(1)
  })
})
