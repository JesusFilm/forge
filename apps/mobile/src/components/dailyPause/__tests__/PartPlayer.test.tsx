// The devotional part player (U9) over the REAL adapter and part clock. Only
// expo-video (the shared double), the asset download, and the adapter's
// telemetry and progress modules are modelled. Every render is in StrictMode.
import { StrictMode, act } from "react"
import {
  AppState,
  Dimensions,
  StyleSheet,
  type Animated,
  type ViewStyle,
} from "react-native"

import {
  DEVOTIONALS,
  type DevotionalPart,
} from "../../../lib/dailyPause/devotionals"
import type { PauseFace } from "../../../lib/dailyPause/fonts"
import {
  PART_END_GUARD_SECONDS,
  PART_START_BACKSTOP_MS,
} from "../../../lib/dailyPause/partClock"
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
import { devotionalVideoFrame } from "../CloseButton"
import { PartPlayer } from "../PartPlayer"

/* eslint-disable @typescript-eslint/no-require-imports */
jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").createExpoVideoMock(),
)
/* eslint-enable @typescript-eslint/no-require-imports */

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

jest.mock("expo-asset", () => ({
  Asset: {
    fromModule: () => ({
      downloadAsync: async () => ({ localUri: "file:///bundle/pharisee.mp4" }),
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
/** One display frame. A test's animation frame is a zero-delay timer, so one
 *  display frame runs several of them. */
const FRAME_MS = 16
const font = (face: PauseFace) => ({ fontFamily: face })

let renderer: TestInstance | null = null
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
  jest.useRealTimers()
  jest.restoreAllMocks()
})

function element(part: DevotionalPart, active: boolean) {
  return (
    <StrictMode>
      <PartPlayer
        devotional={DEVOTIONALS.pharisee}
        part={part}
        active={active}
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

async function rerender(part: DevotionalPart, active = true) {
  await act(async () => {
    renderer!.update(element(part, active))
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
    expect(props.allowsVideoFrameAnalysis).toBe(false)
    expect(props.nativeControls).toBe(false)
    expect(
      Object.keys(props).filter((name) => /PictureInPicture/.test(name)),
    ).toEqual([])
    expect(player.timeUpdateEventInterval).toBe(0.25)
  })
})

describe("the progress bar (R12, R24)", () => {
  it("sits in the top letterbox and fills with the projected time", async () => {
    await mount("film")
    await playPast("film")

    const [bar] = hostByTestId("part-progress")
    const style = StyleSheet.flatten(bar!.props.style as ViewStyle)
    const videoTop = devotionalVideoFrame(WINDOW.width, WINDOW.height).top
    expect(style.height).toBe(3)
    expect((style.top as number) + 3).toBeLessThanOrEqual(videoTop)

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
