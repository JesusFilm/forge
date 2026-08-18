/**
 * The hoisted player end to end (U6): the host owns the one player and the one
 * video view, the chrome rides in its frame, and a surface going away is what
 * decides whether a mini-player session is published.
 *
 * The real `PlaybackHost`, the real `VideoPlayer` chrome and the real adapter
 * run; only module boundaries are faked (expo-video via U1's shared stub, the
 * progress recorder's collaborators, Datadog, and the visual leaves). Slot
 * rects are seeded through the store because a jest render performs no native
 * layout pass — `PlayerSlot` is what measures them on device.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("react", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(path.dirname(r.resolve("react/package.json")))
})
jest.mock("react/jsx-runtime", () => {
  const r = require as unknown as NodeRequireLike
  const path = r("path") as NodePath
  return jest.requireActual(
    path.join(path.dirname(r.resolve("react/package.json")), "jsx-runtime.js"),
  )
})

jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").createExpoVideoMock(),
)

// Live playingChange subscription so `isPlaying` tracks the fake player the way
// it does on-device. Partial: `expo` carries more than useEvent.
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
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
      const r = require as unknown as NodeRequireLike
      const react = r("react") as {
        useState: <T>(v: T) => [T, (v: T) => void]
        useEffect: (fn: () => () => void, deps: unknown[]) => void
      }
      const [value, setValue] = react.useState(initial)
      react.useEffect(() => {
        const sub = player.addListener(event, (payload) =>
          setValue(payload as never),
        )
        return () => sub.remove()
      }, [player, event])
      return value
    },
  }
})

jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("expo-glass-effect", () => ({ GlassView: () => null }))
// The host renders the screen's back affordance, which is the app's existing
// router-owning component. expo-router is never imported unmocked in this repo.
// `push` is captured so the expand wiring is assertable end to end.
const mockRouterPush = jest.fn()
// Default: a route none of the presentation tables name, so a published
// session floats. Reassigned + re-rendered by the expand-hold suite.
let mockSegments: readonly string[] = []
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
    push: mockRouterPush,
  }),
  useSegments: () => mockSegments,
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../ui/PlatformBlur", () => ({ PlatformBlur: () => null }))
// Drivable like mockSegments: an inset change re-derives the corner layout,
// which is what the reposition glide and the expand hold guard against.
let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 }
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => mockInsets,
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
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
  getSignedInAccountId: () => "account-1",
}))

// R25's subject, drivable from a test. The real store owns a Better Auth client;
// what the mini-player store consumes is only this snapshot + subscribe pair.
jest.mock("../../../lib/authSession", () => {
  const SIGNED_IN = { status: "signedIn", user: { id: "user-1" } }
  let snapshot: unknown = SIGNED_IN
  const listeners = new Set<() => void>()
  return {
    getAuthSession: () => ({
      getSnapshot: () => snapshot,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }),
    __setSnapshot: (next: unknown) => {
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
    __reset: () => {
      snapshot = SIGNED_IN
      listeners.clear()
    },
  }
})

import { StrictMode, act } from "react"
import { Animated, Dimensions, StyleSheet } from "react-native"

import { ENDED_FADE_DURATION_MS } from "../MiniPlayerWindow"
import {
  EXIT_DURATION_MS,
  EXPAND_DURATION_MS,
  EXPAND_HOLD_TIMEOUT_MS,
  PlaybackHost,
  REPOSITION_DURATION_MS,
  SHRINK_DURATION_MS,
  shouldDrawSurface,
} from "../PlaybackHost"
import { miniPlayerCornerFrame } from "../../../lib/miniPlayer/layout"
import {
  getPlaybackRequestStore,
  type PlaybackRequest,
  type PlaybackSessionDescriptor,
} from "../../../lib/miniPlayer/playbackRequest"
import {
  getMiniPlayerStore,
  type MiniPlayerEndEvent,
} from "../../../lib/miniPlayer/store"
import type { ExpoVideoMock } from "../../../test-utils/expoVideoMock"
import { FloatingBackButton } from "../../ui/FloatingBackButton"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

jest.setTimeout(20_000)

const video = jest.requireMock("expo-video") as ExpoVideoMock
const datadog = jest.requireMock("../../../lib/datadog") as {
  datadogLog: { info: jest.Mock; warn: jest.Mock; error: jest.Mock }
  reportDatadogAction: jest.Mock
}
const auth = jest.requireMock("../../../lib/authSession") as {
  __setSnapshot: (next: unknown) => void
  __reset: () => void
}
const requestStore = getPlaybackRequestStore()
const sessionStore = getMiniPlayerStore()

const URL_A = "https://stream.mux.com/assetAAA111.m3u8"
const URL_B = "https://stream.mux.com/assetBBB222.m3u8"
const RECT = { x: 0, y: 47, width: 390, height: 219 }

const SESSION_A: PlaybackSessionDescriptor = {
  videoId: "video-a",
  videoSlug: "video-a-slug",
  title: "Video A",
  posterUrl: null,
  languageSlug: "english",
  originPattern: "watch/[slug]",
}

function makeRequest(
  overrides: Partial<PlaybackRequest> = {},
): PlaybackRequest {
  return {
    streamingUrl: URL_A,
    posterUrl: null,
    subtitleVttSrc: null,
    fullscreen: false,
    autostart: true,
    resumeAtSeconds: null,
    progressVideoId: "video-a",
    progressVideoSlug: null,
    progressLanguageSlug: "english",
    onToggleFullscreen: null,
    session: SESSION_A,
    ...overrides,
  }
}

let mounted: TestInstance | null = null

function attachSlot(
  overrides: Partial<PlaybackRequest> = {},
  rect: typeof RECT | null = RECT,
) {
  const id = requestStore.attachSlot(makeRequest(overrides))
  if (rect != null) requestStore.setSlotRect(id, rect)
  return id
}

/** A surface mounting while the host is already rendered. */
async function attachSlotInAct(
  overrides: Partial<PlaybackRequest> = {},
  rect: typeof RECT | null = RECT,
) {
  let id!: number
  await act(async () => {
    id = attachSlot(overrides, rect)
  })
  return id
}

async function detach(id: number) {
  await act(async () => {
    requestStore.detachSlot(id)
  })
}

async function renderHost(): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<PlaybackHost />)
  })
  mounted = renderer
  return renderer
}

async function startPlayback() {
  await act(async () => {
    video.__player.play()
  })
}

/**
 * Mounted video views, by component type — one per DECODER (R10). A label or
 * prop match would double-count, since findAll returns the composite node and
 * the host node it renders.
 */
function videoViews(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => (node as { type?: unknown }).type === video.VideoView,
  )
}

/** The one back affordance over the player — by its pressable, not its label,
 *  so the surrounding container does not count as a second. */
function backButtons(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) =>
      node.props.accessibilityLabel === "Go back" &&
      typeof node.props.onPress === "function",
  )
}

/** The one video view's props, which is where U9's picture-in-picture wiring
 *  lives. Throws rather than returning undefined when no view is mounted. */
function videoViewProps(renderer: TestInstance) {
  const views = videoViews(renderer)
  if (views.length !== 1)
    throw new Error(`expected exactly one video view, found ${views.length}`)
  return views[0].props as {
    allowsPictureInPicture: boolean
    startsPictureInPictureAutomatically: boolean
    onPictureInPictureStart: () => void
    onPictureInPictureStop: () => void
  }
}

/** The one black box the host draws at the owning rect (or the window corner).
 *  Absent means the surface below the host is what the viewer sees. */
function frames(renderer: TestInstance) {
  return renderer.root.findAll((node) => node.props.testID === "playback-frame")
}

/** The full view's chrome, by its always-mounted tap target rather than a
 *  control the autostart veil suppresses. */
function hasFullViewChrome(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll(
      (node) => node.props.accessibilityLabel === "Toggle player controls",
    ).length > 0
  )
}

/** The transport control the autostart veil suppresses. The tap target above is
 *  mounted either way, so only this proves the viewer can reach playback. */
function hasTransportControls(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll(
      (node) =>
        typeof node.props.onPress === "function" &&
        ["Play", "Pause", "Replay"].includes(
          node.props.accessibilityLabel as string,
        ),
    ).length > 0
  )
}

function hasWindowChrome(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll((node) => node.props.testID === "mini-player-window")
      .length > 0
  )
}

/** The window's assistive-tech control path, which reaches the same handlers as
 *  the visible chrome without waiting on the shrink's readiness gate. */
function fireWindowAction(renderer: TestInstance, actionName: string) {
  const node = renderer.root.findAll(
    (n) => n.props.testID === "mini-player-window",
  )[0]
  const handler = node.props.onAccessibilityAction as (event: {
    nativeEvent: { actionName: string }
  }) => void
  handler({ nativeEvent: { actionName } })
}

/** R6's downward translation, read off the node the exit animates. */
function exitTranslation(renderer: TestInstance) {
  const node = renderer.root.findAll(
    (n) => n.props.testID === "playback-exit",
  )[0]
  const style = StyleSheet.flatten(node.props.style) as {
    transform?: Array<{
      translateY?: { __getValue: () => number; setValue: (v: number) => void }
    }>
  }
  const value = style.transform?.[0]?.translateY
  if (value == null) throw new Error("no exit translation on the frame")
  return value
}

function frameStyle(renderer: TestInstance) {
  const frame = renderer.root.findAll(
    (node) => node.props.testID === "playback-frame",
  )[0]
  return StyleSheet.flatten(frame.props.style) as {
    opacity?: number
    overflow?: string
    backgroundColor?: string
  }
}

function hasVeil(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll(
      (node) => node.props.accessibilityLabel === "Loading video",
    ).length > 0
  )
}

beforeEach(() => {
  video.__reset()
  auth.__reset()
  requestStore.reset()
  sessionStore.setPipHold(false)
  sessionStore.end("abandoned")
  mockRouterPush.mockClear()
  mockSegments = []
  mockInsets = { top: 0, bottom: 0, left: 0, right: 0 }
})

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  requestStore.reset()
  sessionStore.end("abandoned")
  jest.useRealTimers()
  // A stubbed Animated.timing would silently disarm every later case.
  jest.restoreAllMocks()
})

describe("the hoisted player drives the full view", () => {
  it("plays through one injected player, with the autostart veil unchanged", async () => {
    attachSlot()
    const renderer = await renderHost()

    // One video view, holding the host's player, with the chrome over it.
    expect(videoViews(renderer)).toHaveLength(1)
    expect(videoViews(renderer)[0].props.player).toBe(video.__player)
    expect(videoViews(renderer)[0].props.nativeControls).toBe(false)
    expect(hasVeil(renderer)).toBe(true)

    await startPlayback()

    expect(hasVeil(renderer)).toBe(false)
    expect(videoViews(renderer)).toHaveLength(1)
  })

  it("shows the minimize chevron over a session surface, back over the trailer", async () => {
    // The watch page's back press MINIMIZES the player into the window, so its
    // affordance is a down chevron; the series trailer's back is plain
    // navigation and keeps the back chevron.
    const backButtonsIn = (renderer: TestInstance) =>
      renderer.root.findAll(
        (node) => (node as { type?: unknown }).type === FloatingBackButton,
      )
    attachSlot()
    const renderer = await renderHost()
    let buttons = backButtonsIn(renderer)
    expect(buttons).toHaveLength(1)
    expect(buttons[0].props.icon).toBe("chevron-down")

    requestStore.reset()
    await act(async () => {
      attachSlot({ session: null, streamingUrl: URL_B })
    })
    buttons = backButtonsIn(renderer)
    expect(buttons).toHaveLength(1)
    expect(buttons[0].props.icon).toBe("chevron-back")
  })

  it("carries the screen's back affordance over the video, and drops it in fullscreen", async () => {
    const renderer = await renderHost()
    expect(backButtons(renderer)).toHaveLength(0)

    const id = await attachSlotInAct()
    // Exactly one: the screens stop drawing their own while this is up.
    expect(backButtons(renderer)).toHaveLength(1)

    await act(async () => {
      requestStore.updateSlot(id, makeRequest({ fullscreen: true }))
    })

    expect(backButtons(renderer)).toHaveLength(0)
  })

  it("draws no back affordance until the attached surface has measured itself", async () => {
    const first = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(first)
    // The expand: the screen has mounted its slot but no layout pass has run
    // yet. The screen drops its own button on rect AND slot, so a host that
    // gated on the slot alone would draw a second one in this gap.
    await attachSlotInAct({}, null)
    expect(requestStore.getSnapshot().slotId).not.toBeNull()
    expect(requestStore.getSnapshot().rect).toBeNull()

    expect(backButtons(renderer)).toHaveLength(0)

    await act(async () => {
      requestStore.setSlotRect(
        requestStore.getSnapshot().slotId as number,
        RECT,
      )
    })

    expect(backButtons(renderer)).toHaveLength(1)
  })

  it("does not re-arm the autostart veil when the viewer expands back onto a playing video", async () => {
    const first = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    expect(hasVeil(renderer)).toBe(false)

    // Back: the screen goes, the player does not. Since U7 the one view goes
    // with it into the floating window, so it is still exactly one.
    await detach(first)
    expect(videoViews(renderer)).toHaveLength(1)
    expect(video.__player.playing).toBe(true)

    // Expand: the same video takes a fresh surface.
    await attachSlotInAct()

    expect(hasVeil(renderer)).toBe(false)
    expect(videoViews(renderer)).toHaveLength(1)
    // Never re-created: every creation call carries the frozen first source.
    for (const call of video.useVideoPlayer.mock.calls)
      expect(call[0]).toBe(URL_A)
  })

  it("keeps the subtitle track null and reports a stream failure with no chrome mounted", async () => {
    attachSlot({}, null)
    const renderer = await renderHost()
    expect(videoViews(renderer)).toHaveLength(0)
    expect(hasVeil(renderer)).toBe(false)

    video.__player.subtitleTrack = {
      label: "English",
      language: "en",
    } as never
    await act(async () => {
      video.__player.__emit("availableSubtitleTracksChange")
    })
    expect(video.__player.subtitleTrack).toBeNull()

    await act(async () => {
      video.__player.__emit("statusChange", { status: "error" })
    })
    expect(requestStore.getSnapshot().loadFailed).toBe(true)
  })
})

describe("admission (R1, R20)", () => {
  it("publishes no session when the viewer backs out before playback starts", async () => {
    const id = attachSlot()
    await renderHost()

    await detach(id)

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(requestStore.getSnapshot().request).toBeNull()
  })

  it("publishes no session when the video ran to its end in the full view", async () => {
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    video.__player.currentTime = 600
    video.__player.duration = 600

    // No window owns the frame, so there is no session to mark ended — the
    // ending has to survive as a fact until this surface goes away.
    await act(async () => {
      video.__player.__emit("playToEnd")
    })
    expect(sessionStore.getSnapshot().session).toBeNull()

    await detach(id)

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(requestStore.getSnapshot().request).toBeNull()
    expect(videoViews(renderer)).toHaveLength(0)
  })

  it("publishes a session again once the viewer plays on past that ending", async () => {
    const id = attachSlot()
    await renderHost()
    await startPlayback()
    await act(async () => {
      video.__player.__emit("playToEnd")
    })
    // Seek back and play on: the video is being watched again, not finished.
    await act(async () => {
      video.__player.pause()
    })
    await act(async () => {
      video.__player.play()
    })
    video.__player.currentTime = 42

    await detach(id)

    expect(sessionStore.getSnapshot().session?.positionSeconds).toBe(42)
  })

  it("publishes a session carrying the video identity and position", async () => {
    const id = attachSlot()
    await renderHost()
    await startPlayback()
    video.__player.currentTime = 137.5
    video.__player.duration = 1800

    await detach(id)

    expect(sessionStore.getSnapshot().session).toMatchObject({
      videoId: "video-a",
      videoSlug: "video-a-slug",
      title: "Video A",
      languageSlug: "english",
      positionSeconds: 137.5,
      durationSeconds: 1800,
      phase: "playing",
    })
  })

  it("carries the same identity and position shape for a slug-keyed local file", async () => {
    const id = attachSlot({
      streamingUrl: "file:///offline/downloaded-slug/video.mp4",
      progressVideoId: null,
      progressVideoSlug: "downloaded-slug",
      progressLanguageSlug: null,
      session: {
        videoId: null,
        videoSlug: "downloaded-slug",
        title: "A downloaded video",
        posterUrl: null,
        languageSlug: null,
        originPattern: "watch/[slug]",
      },
    })
    await renderHost()
    await startPlayback()
    video.__player.currentTime = 12
    video.__player.duration = 300

    await detach(id)

    expect(sessionStore.getSnapshot().session).toMatchObject({
      videoId: null,
      videoSlug: "downloaded-slug",
      positionSeconds: 12,
      durationSeconds: 300,
      phase: "playing",
    })
  })

  it("keeps the started fact when the record's id arrives mid-playback", async () => {
    // The seed path: playback starts before GET_VIDEO_BY_SLUG resolves, so the
    // descriptor names the video by slug alone and gains the id later. That
    // flip must not wipe admission's started fact — play, pause, back is
    // exactly the paused continue-watching window R1 promises.
    const id = attachSlot({ session: { ...SESSION_A, videoId: null } })
    await renderHost()
    await startPlayback()
    await act(async () => {
      requestStore.updateSlot(id, makeRequest())
    })
    await act(async () => {
      video.__player.pause()
    })
    video.__player.currentTime = 25

    await detach(id)

    expect(sessionStore.getSnapshot().session).toMatchObject({
      videoId: "video-a",
      positionSeconds: 25,
      phase: "playing",
    })
  })

  it("publishes nothing while a back gesture is uncommitted, and publishes once it commits", async () => {
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    video.__player.currentTime = 30

    // A released swipe-back never unmounts the screen. Nothing about the full
    // view changes: it still owns the player and the video view.
    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(requestStore.getSnapshot().slotId).toBe(id)
    expect(videoViews(renderer)).toHaveLength(1)

    await detach(id)

    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")
  })
})

describe("a surface that owns the player before its stream resolves", () => {
  const SESSION_B: PlaybackSessionDescriptor = {
    ...SESSION_A,
    videoId: "video-b",
    videoSlug: "video-b-slug",
    title: "Video B",
  }

  it("draws nothing of another route's video into the owning rect", async () => {
    // The series trailer, playing through this same one player.
    attachSlot({ session: null, streamingUrl: URL_B })
    const renderer = await renderHost()
    await startPlayback()
    expect(videoViews(renderer)).toHaveLength(1)

    // The episode the viewer tapped: its seed carries no playbackId, so the
    // watch screen mounts with no source. Without a slot of its own the
    // trailer stayed current and the host painted it over the watch screen.
    const watch = await attachSlotInAct({ streamingUrl: null })

    expect(requestStore.getSnapshot().slotId).toBe(watch)
    expect(videoViews(renderer)).toHaveLength(0)
    expect(hasFullViewChrome(renderer)).toBe(false)
    // No opaque black box over the poster the screen paints beneath it.
    expect(frames(renderer)).toHaveLength(0)
    // The way out survives: the screen drops its own on the same predicate.
    expect(backButtons(renderer)).toHaveLength(1)
  })

  it("keeps its slot and its player across an Up Next source gap", async () => {
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    video.__player.currentTime = 42
    const replacesBefore = video.__player.replaceAsync.mock.calls.length

    // Up Next replaces the route in place, so the screen drops its video and
    // the SAME mounted slot republishes with no source. Unmounting the slot
    // there reads as a committed back press and shrinks the outgoing video.
    await act(async () => {
      requestStore.updateSlot(
        id,
        makeRequest({ streamingUrl: null, session: SESSION_B }),
      )
    })

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(requestStore.getSnapshot().slotId).toBe(id)
    expect(videoViews(renderer)).toHaveLength(0)
    // The player keeps what it holds: a null never reaches it as a swap.
    expect(video.__player.replaceAsync).toHaveBeenCalledTimes(replacesBefore)
    expect(video.__player.currentTime).toBe(42)

    await act(async () => {
      requestStore.updateSlot(
        id,
        makeRequest({ streamingUrl: URL_B, session: SESSION_B }),
      )
    })
    await act(async () => {
      video.__settleReplace()
    })

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(requestStore.getSnapshot().slotId).toBe(id)
    expect(video.__player.replaceAsync).toHaveBeenLastCalledWith(URL_B)
    expect(videoViews(renderer)).toHaveLength(1)
  })

  it("publishes no session when it goes while the player runs another video", async () => {
    attachSlot({ session: null, streamingUrl: URL_B })
    await renderHost()
    await startPlayback()
    const watch = await attachSlotInAct({ streamingUrl: null })

    await detach(watch)

    // `hasPlaybackStarted` reads through the applied-source gate below, and
    // the missing source refuses independently — two guards, one regression.
    expect(video.__player.playing).toBe(true)
    expect(sessionStore.getSnapshot().session).toBeNull()
  })

  it("publishes no session for a source-bearing back-out mid-handover", async () => {
    // The trailer beneath, playing and APPLIED to the player.
    attachSlot({ session: null, streamingUrl: URL_B })
    await renderHost()
    await startPlayback()

    // The tapped episode resolves its URL and the swap starts. The viewer
    // backs out before the new stream's first frame — a multi-second window
    // on low bandwidth. The live `playing` read describes the TRAILER.
    const watch = await attachSlotInAct({ streamingUrl: URL_A })
    expect(video.__player.replaceAsync).toHaveBeenCalledWith(URL_A)

    await detach(watch)

    expect(video.__player.playing).toBe(true)
    expect(sessionStore.getSnapshot().session).toBeNull()
  })

  it("still publishes once the swap has applied the new source", async () => {
    // The protective half of the same fallback: after the apply, a swap that
    // kept `playing` true throughout emitted no playing-change edge, and the
    // arriving video must not be denied its window for that.
    attachSlot({ session: null, streamingUrl: URL_B })
    await renderHost()
    await startPlayback()
    const watch = await attachSlotInAct({ streamingUrl: URL_A })
    await act(async () => {
      video.__settleReplace()
    })
    video.__player.currentTime = 3

    await detach(watch)

    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")
  })

  it("keeps the floating video's surface when the expand has no source yet", async () => {
    const first = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    video.__player.currentTime = 30
    await detach(first)
    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")

    // R4: the expanded screen names the SAME video, so the player is already
    // holding it. Blanking the surface here would be a black flash mid-expand.
    await attachSlotInAct({ streamingUrl: null })

    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")
    expect(videoViews(renderer)).toHaveLength(1)
    expect(video.__player.currentTime).toBe(30)
    expect(video.__player.playing).toBe(true)
  })
})

describe("expanding back onto the floating video (R4)", () => {
  // The URL the watch route publishes on a FRESH mount is not always the string
  // the player already holds: `playerSource` walks
  // `offlineSource ?? activeVariant?.hls ?? video?.streamingUrl ?? seedStreamingUrl`,
  // and a remounted screen resolves that chain from a different starting state
  // (group-scoped session provider gone, `returnPartialData` cache entry, no
  // seed on the window's push). Two different strings, one video.
  const VARIANT_URL = "https://stream.mux.com/assetAAA111.m3u8"
  const CANONICAL_URL = "https://cdn.example.org/life-of-jesus/en/master.m3u8"

  function watchRequest(
    overrides: Partial<PlaybackRequest> = {},
  ): Partial<PlaybackRequest> {
    return {
      streamingUrl: VARIANT_URL,
      progressVideoId: "video-a",
      progressLanguageSlug: "english",
      session: {
        videoId: "video-a",
        videoSlug: "life-of-jesus-gospel-of-john",
        title: "Life of Jesus",
        posterUrl: null,
        languageSlug: "english",
        originPattern: "watch/[slug]",
      },
      ...overrides,
    }
  }

  async function floatOneVideo() {
    const first = attachSlot(watchRequest())
    const renderer = await renderHost()
    await startPlayback()
    video.__player.currentTime = 30
    video.__player.duration = 11000
    await detach(first)
    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")
    return renderer
  }

  it("adopts the live player when the expanded screen names the same video", async () => {
    await floatOneVideo()
    const replacesBefore = video.__player.replaceAsync.mock.calls.length
    datadog.datadogLog.info.mockClear()
    datadog.reportDatadogAction.mockClear()

    // The expand: same video, a source string the Mux-id compare cannot absorb,
    // and no language yet because the fresh provider has not picked a variant.
    await attachSlotInAct(
      watchRequest({
        streamingUrl: CANONICAL_URL,
        progressLanguageSlug: null,
        session: {
          ...(watchRequest().session as PlaybackSessionDescriptor),
          languageSlug: null,
        },
      }),
    )

    // No reload: position survives, and neither of the two signals a reload
    // leaves behind (a closed quality session, a re-applied autostart) fires.
    expect(video.__player.replaceAsync).toHaveBeenCalledTimes(replacesBefore)
    expect(video.__player.currentTime).toBe(30)
    expect(video.__player.playing).toBe(true)
    expect(datadog.datadogLog.info).not.toHaveBeenCalledWith(
      "video.qoe",
      expect.anything(),
    )
    expect(datadog.reportDatadogAction).not.toHaveBeenCalledWith(
      "autostart_applied",
      expect.anything(),
    )
    // And the session it expanded onto is still the one playing.
    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")
  })

  it("gives a PAUSED expand its controls rather than the autostart veil", async () => {
    const renderer = await floatOneVideo()
    // Paused in the window, which is where a viewer pauses before expanding.
    await act(async () => {
      video.__player.pause()
    })

    // The adoption emits no new sourceLoad, so nothing here would ever clear a
    // veil this mount armed — the viewer would wait out the whole timeout.
    await attachSlotInAct(watchRequest())

    expect(hasVeil(renderer)).toBe(false)
    expect(hasTransportControls(renderer)).toBe(true)
    // Expanding is not a play command: the video stays where the viewer left it.
    expect(video.__player.playing).toBe(false)
    expect(video.__player.currentTime).toBe(30)
  })

  it("still swaps when the viewer changes the dub on the expanded screen", async () => {
    await floatOneVideo()
    const replacesBefore = video.__player.replaceAsync.mock.calls.length
    await attachSlotInAct(
      watchRequest({
        streamingUrl: CANONICAL_URL,
        progressLanguageSlug: null,
        session: {
          ...(watchRequest().session as PlaybackSessionDescriptor),
          languageSlug: null,
        },
      }),
    )

    // A named language that differs is a real dub switch, not a remount's
    // half-resolved guess: it must reach the player.
    await act(async () => {
      requestStore.updateSlot(
        requestStore.getSnapshot().slotId as number,
        makeRequest(
          watchRequest({
            streamingUrl: "https://stream.mux.com/assetSPA999.m3u8",
            progressLanguageSlug: "spanish",
            session: {
              ...(watchRequest().session as PlaybackSessionDescriptor),
              languageSlug: "spanish",
            },
          }),
        ),
      )
    })

    expect(video.__player.replaceAsync).toHaveBeenCalledTimes(
      replacesBefore + 1,
    )
    expect(video.__player.replaceAsync).toHaveBeenLastCalledWith(
      "https://stream.mux.com/assetSPA999.m3u8",
    )
  })
})

describe("a change of signed-in subject (R25)", () => {
  it("ends the session, stops playback, and accepts no write for the previous subject", async () => {
    // The EXPANDED state: a session is live AND a screen still holds the
    // player. This is the case the teardown does not cover — the host stays
    // mounted, so only an explicit stop ends playback.
    const first = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    video.__player.currentTime = 60
    video.__player.duration = 600
    await detach(first)
    await attachSlotInAct()
    // Anti-vacuous: the session was tagged with the subject, which is only
    // possible because the host attached the auth source.
    expect(sessionStore.getSnapshot().session?.accountId).toBe("user-1")
    expect(video.__player.playing).toBe(true)
    const endings: MiniPlayerEndEvent[] = []
    const unsubscribe = sessionStore.onEnd((event) => endings.push(event))

    await act(async () => {
      auth.__setSnapshot({ status: "signedOut", user: null })
    })

    expect(endings.map((e) => e.reason)).toEqual(["abandoned"])
    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(video.__player.playing).toBe(false)
    expect(video.__player.pause).toHaveBeenCalled()

    // Nothing is written for the subject that left.
    sessionStore.publishPosition({ positionSeconds: 999, durationSeconds: 600 })
    expect(sessionStore.getSnapshot().session).toBeNull()
    // The window is gone with it; the full view keeps its own surface.
    expect(videoViews(renderer)).toHaveLength(1)
    unsubscribe()
  })

  it("keeps watching the subject through StrictMode's double effect cycle", async () => {
    // Both the attach and the playback-facts source null module state in their
    // cleanup. If either setup failed to restore it, no session would publish
    // (facts) or none would carry a subject (attach) — so this one render
    // covers both.
    const id = attachSlot()
    await act(async () => {
      mounted = TestRenderer.create(
        <StrictMode>
          <PlaybackHost />
        </StrictMode>,
      )
    })
    await startPlayback()
    await detach(id)

    expect(sessionStore.getSnapshot().session?.accountId).toBe("user-1")

    await act(async () => {
      auth.__setSnapshot({ status: "signedOut", user: null })
    })

    expect(sessionStore.getSnapshot().session).toBeNull()
  })

  it("releases the player when the subject changes while the video floats", async () => {
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(id)
    expect(sessionStore.getSnapshot().session?.accountId).toBe("user-1")
    expect(requestStore.getSnapshot().request).not.toBeNull()

    await act(async () => {
      auth.__setSnapshot({ status: "signedIn", user: { id: "user-2" } })
    })

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(requestStore.getSnapshot().request).toBeNull()
    expect(videoViews(renderer)).toHaveLength(0)
    expect(video.__player.playing).toBe(false)
  })
})

describe("native picture-in-picture (U9: R13, R15, R24)", () => {
  /** The floating state: playback started, the surface went away. */
  async function floatingWindow() {
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(id)
    return renderer
  }

  async function enterPip(renderer: TestInstance) {
    await act(async () => {
      videoViewProps(renderer).onPictureInPictureStart()
    })
  }

  async function exitPip(renderer: TestInstance) {
    await act(async () => {
      videoViewProps(renderer).onPictureInPictureStop()
    })
  }

  it("wires the view's own callbacks to the latch, both ways", async () => {
    const renderer = await floatingWindow()
    expect(videoViewProps(renderer).allowsPictureInPicture).toBe(true)
    expect(sessionStore.getSnapshot().pipHold).toBe(false)

    await enterPip(renderer)
    expect(sessionStore.getSnapshot().pipHold).toBe(true)

    await exitPip(renderer)
    expect(sessionStore.getSnapshot().pipHold).toBe(false)
  })

  it("arms automatic entry only while playing, and keeps it armed under the hold", async () => {
    attachSlot()
    const renderer = await renderHost()
    // R13 is about playback CONTINUING: pressing Home over a video that never
    // started must not open an OS window at all.
    expect(videoViewProps(renderer).startsPictureInPictureAutomatically).toBe(
      false,
    )

    await startPlayback()
    expect(videoViewProps(renderer).startsPictureInPictureAutomatically).toBe(
      true,
    )

    // Paused INSIDE the OS window: expo-video re-elects a candidate on every
    // params change, and an unelected view is never re-parented back out.
    await enterPip(renderer)
    await act(async () => {
      video.__player.pause()
    })
    expect(videoViewProps(renderer).startsPictureInPictureAutomatically).toBe(
      true,
    )
  })

  it("hides the window's chrome without unmounting its video view", async () => {
    const renderer = await floatingWindow()
    expect(hasWindowChrome(renderer)).toBe(true)
    expect(videoViews(renderer)).toHaveLength(1)

    await enterPip(renderer)

    // KTD16: chrome-only. The view stays mounted, in the same one position.
    expect(hasWindowChrome(renderer)).toBe(false)
    expect(videoViews(renderer)).toHaveLength(1)
    expect(frameStyle(renderer).opacity).toBe(0)

    await exitPip(renderer)
    expect(hasWindowChrome(renderer)).toBe(true)
    expect(videoViews(renderer)).toHaveLength(1)
  })

  it("issues no unmount for a dismiss requested under the hold, and promotes it on release", async () => {
    const renderer = await floatingWindow()
    await enterPip(renderer)

    await act(async () => {
      sessionStore.requestDismiss()
    })

    // AE12: the dismissal is recorded, and nothing about the view changes.
    expect(sessionStore.getSnapshot().dismissal).toBe("deferred")
    expect(videoViews(renderer)).toHaveLength(1)
    expect(videoViews(renderer)[0].props.player).toBe(video.__player)
    expect(hasWindowChrome(renderer)).toBe(false)

    await exitPip(renderer)

    expect(sessionStore.getSnapshot().dismissal).toBe("exiting")
    expect(videoViews(renderer)).toHaveLength(1)
  })

  it("holds the surface through a fade that completes mid-window", async () => {
    jest.useFakeTimers()
    const renderer = await floatingWindow()

    // R21's crossfade starts here, on the mounted chrome, and its Animated
    // completion keeps running after the hold unmounts that chrome.
    await act(async () => {
      video.__player.__emit("playToEnd")
    })
    expect(sessionStore.getSnapshot().session?.endedCause).toBe("playToEnd")

    await enterPip(renderer)
    await act(async () => {
      jest.advanceTimersByTime(ENDED_FADE_DURATION_MS + 100)
    })

    // The completion landed, and the surface it would release is still up.
    expect(videoViews(renderer)).toHaveLength(1)

    // Released now, not mid-window: the remounted chrome reports the fade it
    // was mounted already-ended for.
    await exitPip(renderer)
    expect(videoViews(renderer)).toHaveLength(0)
  })

  it("holds the surface through a failure that arrives mid-window", async () => {
    const renderer = await floatingWindow()
    await enterPip(renderer)

    await act(async () => {
      video.__player.__emit("statusChange", { status: "error" })
    })

    expect(sessionStore.getSnapshot().session?.endedCause).toBe("failure")
    expect(videoViews(renderer)).toHaveLength(1)

    // R22 swaps to the poster outright, so the release lands the moment the
    // chrome comes back — after the window is gone, never during it.
    await exitPip(renderer)
    expect(videoViews(renderer)).toHaveLength(0)
  })

  it("an ended window has no video view, so nothing can arm the latch", async () => {
    const renderer = await floatingWindow()

    await act(async () => {
      video.__player.__emit("statusChange", { status: "error" })
    })

    // Structural: the window persists as a thumbnail (R22) with no surface, so
    // there is no view to carry the props or fire the start callback.
    expect(sessionStore.getSnapshot().session).not.toBeNull()
    expect(hasWindowChrome(renderer)).toBe(true)
    expect(videoViews(renderer)).toHaveLength(0)
    expect(sessionStore.getSnapshot().pipHold).toBe(false)
  })

  it("holds the surface through a session ending that is not a dismissal", async () => {
    const renderer = await floatingWindow()
    await enterPip(renderer)

    // R25's subject change and the adapter's safety nets clear the session
    // outright — no exit animation, and no dismissal to defer.
    await act(async () => {
      sessionStore.end("abandoned")
    })

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(videoViews(renderer)).toHaveLength(1)

    await exitPip(renderer)

    expect(videoViews(renderer)).toHaveLength(0)
  })

  it("mounts nothing for a hold with no live request (the SDUI latch entry)", async () => {
    jest.useFakeTimers()
    // A watch video floats, then is dismissed: its request dies UNHELD.
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(id)
    await act(async () => {
      sessionStore.requestDismiss()
    })
    await act(async () => {
      jest.advanceTimersByTime(EXIT_DURATION_MS + 1000)
    })
    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(requestStore.getSnapshot().request).toBeNull()
    expect(videoViews(renderer)).toHaveLength(0)

    // Later an SDUI screen's OWN view enters the OS window — same global
    // latch. The dead request must not come back as a phantom second player
    // drawing a black frame at the corner.
    await act(async () => {
      sessionStore.setPipHold(true)
    })

    expect(videoViews(renderer)).toHaveLength(0)
    expect(frames(renderer)).toHaveLength(0)

    await act(async () => {
      sessionStore.setPipHold(false)
    })
  })

  it("releases the latch when the host tears the view down", async () => {
    const renderer = await floatingWindow()
    await enterPip(renderer)
    expect(sessionStore.getSnapshot().pipHold).toBe(true)

    await act(async () => {
      renderer.unmount()
    })
    mounted = null

    // A stranded hold would exempt every adapter in the app from the
    // background pause, with no view left to ever release it.
    expect(sessionStore.getSnapshot().pipHold).toBe(false)
  })
})

describe("the ended window's replay (R27)", () => {
  async function endedWindow() {
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(id)
    await act(async () => {
      video.__player.__emit("playToEnd")
    })
    expect(sessionStore.getSnapshot().session?.phase).toBe("ended")
    return renderer
  }

  it("leaves the window ended when the player refuses the call", async () => {
    const renderer = await endedWindow()
    video.__player.play.mockImplementationOnce(() => {
      throw new Error("native player already released")
    })

    await act(async () => {
      fireWindowAction(renderer, "playPause")
    })

    // A window that says "playing" over a player that never started offers no
    // replay control to try again with.
    expect(sessionStore.getSnapshot().session?.phase).toBe("ended")
    expect(sessionStore.getSnapshot().session?.endedCause).toBe("playToEnd")
  })

  it("marks the window playing when the call lands", async () => {
    const renderer = await endedWindow()

    await act(async () => {
      fireWindowAction(renderer, "playPause")
    })

    expect(sessionStore.getSnapshot().session?.phase).toBe("playing")
    expect(video.__player.play).toHaveBeenCalled()
  })
})

describe("the ended session after an expand (R21, R27)", () => {
  async function floatThenExpand() {
    const first = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    video.__player.currentTime = 30
    video.__player.duration = 600
    await detach(first)
    expect(sessionStore.getSnapshot().session?.phase).toBe("playing")
    await attachSlotInAct()
    return renderer
  }

  it("marks the surviving session ended when the video finishes full screen", async () => {
    const renderer = await floatThenExpand()

    await act(async () => {
      video.__player.__emit("playToEnd")
    })

    // The session survived the expand, so it must end WITH the video — a
    // 'playing' phase here re-floats a paused final frame on the pop and
    // keeps every hero yielded to a finished video.
    expect(sessionStore.getSnapshot().session?.phase).toBe("ended")
    expect(sessionStore.getSnapshot().session?.endedCause).toBe("playToEnd")

    // The pop serves R21's ended window off the retained request.
    await detach(requestStore.getSnapshot().slotId as number)
    expect(sessionStore.getSnapshot().session?.phase).toBe("ended")
    expect(requestStore.getSnapshot().request).not.toBeNull()
    expect(hasWindowChrome(renderer)).toBe(true)
  })

  it("floats a playing window again when the viewer replays past the ending", async () => {
    await floatThenExpand()
    await act(async () => {
      video.__player.__emit("playToEnd")
    })
    expect(sessionStore.getSnapshot().session?.phase).toBe("ended")

    // R27's full-view replay: seek back and play on. The pop's merge must
    // reset the phase, or the window mounts 'ended' over live audio and the
    // heroes un-yield into a second decoder.
    await act(async () => {
      video.__player.pause()
    })
    await act(async () => {
      video.__player.play()
    })
    video.__player.currentTime = 40

    await detach(requestStore.getSnapshot().slotId as number)

    expect(sessionStore.getSnapshot().session).toMatchObject({
      phase: "playing",
      endedCause: null,
      positionSeconds: 40,
    })
  })
})

describe("the frame transition (KTD17: shrink and its reverse)", () => {
  it("turns a mid-flight shrink around into a grow when the full view returns", async () => {
    jest.useFakeTimers()
    const first = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    // A silent driver holds the shrink mid-flight, as a busy UI thread can.
    const timingSpy = jest.spyOn(Animated, "timing").mockReturnValue({
      start: () => {},
      stop: () => {},
      reset: () => {},
    } as never)
    await detach(first)
    // Mid-shrink the frame is unclipped so the video may overdraw its box —
    // and paints nothing of its own: an instant black corner box would
    // front-run the arriving surface.
    expect(frameStyle(renderer).overflow).toBe("visible")
    expect(frameStyle(renderer).backgroundColor).toBe("transparent")
    // The shrink is VISIBLE, anchored at the player rect it departs from: the
    // untransformed first frame is then the previous frame, so the native
    // driver's late transform attach has nothing to flash (the device bug).
    expect(frameStyle(renderer)).toMatchObject({ left: RECT.x, top: RECT.y })
    timingSpy.mockClear()

    // Fast back-then-forward: the full view owns the rect again while the
    // shrink never completed — the surface turns around and grows, visibly.
    await attachSlotInAct()

    const growCall = timingSpy.mock.calls.find(
      ([, config]) =>
        (config as { duration?: number }).duration === EXPAND_DURATION_MS,
    )
    expect(growCall).toBeDefined()
    // The frame already sits at the rect; the transform carries the motion.
    expect(frameStyle(renderer)).toMatchObject({ left: RECT.x, top: RECT.y })
  })

  it("grows out of the corner on expand, and settles clipped at the rect", async () => {
    jest.useFakeTimers()
    const timingSpy = jest.spyOn(Animated, "timing")
    const first = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(first)
    // The shrink runs VISIBLY, anchored at the departing player rect.
    expect(frameStyle(renderer)).toMatchObject({ left: RECT.x, top: RECT.y })
    const shrinkNode = timingSpy.mock.calls.find(
      ([, config]) =>
        (config as { duration?: number }).duration === SHRINK_DURATION_MS,
    )?.[0] as { setValue: (v: number) => void } | undefined
    expect(shrinkNode).toBeDefined()
    // Armed after the shrink started, so only the settle's park can trip it.
    const parkSpy = jest.spyOn(
      shrinkNode as { setValue: (v: number) => void },
      "setValue",
    )
    await act(async () => {
      jest.advanceTimersByTime(SHRINK_DURATION_MS + 300)
    })
    // The settled window: the frame swapped to corner geometry, clipped and
    // painting its own box again — no fade, the window is simply there.
    expect(frameStyle(renderer).overflow).toBe("hidden")
    expect(frameStyle(renderer).backgroundColor).not.toBe("transparent")
    expect(frameStyle(renderer)).not.toMatchObject({ left: RECT.x })
    // Parked at the ramp's IDENTITY end before the style detached: the native
    // driver leaves the last driven value stuck on the view, and a frozen
    // corner-target transform black-boxes the settled window on device.
    expect(parkSpy).toHaveBeenCalledWith(0)
    expect(sessionStore.getSnapshot().session).not.toBeNull()

    // The expand: the remounted screen measures its rect.
    await attachSlotInAct()

    // In flight: the frame is the full rect, the motion node still carries
    // the corner-anchored transform — a blink into place is the regression.
    expect(frameStyle(renderer).overflow).toBe("visible")
    expect(frameStyle(renderer)).toMatchObject({ left: RECT.x, top: RECT.y })

    await act(async () => {
      jest.advanceTimersByTime(EXPAND_DURATION_MS + 300)
    })
    expect(frameStyle(renderer).overflow).toBe("hidden")
  })
})

describe("shouldDrawSurface (R21, R27)", () => {
  it("redraws in the same render a replay clears the ended cause", () => {
    // The window hides its thumbnail imperatively in a child effect; waiting
    // for the parent's surfaceReleased round-trip leaves a black frame.
    expect(
      shouldDrawSurface({
        pipHeld: false,
        hasSurfaceVideo: true,
        hasRect: false,
        endedCause: null,
        surfaceReleased: true,
      }),
    ).toBe(true)
  })

  it("keeps the surface released for a still-ended window", () => {
    expect(
      shouldDrawSurface({
        pipHeld: false,
        hasSurfaceVideo: true,
        hasRect: false,
        endedCause: "playToEnd",
        surfaceReleased: true,
      }),
    ).toBe(false)
  })

  it("never releases under the hold, never draws with no surface video", () => {
    expect(
      shouldDrawSurface({
        pipHeld: true,
        hasSurfaceVideo: false,
        hasRect: false,
        endedCause: "playToEnd",
        surfaceReleased: true,
      }),
    ).toBe(true)
    expect(
      shouldDrawSurface({
        pipHeld: false,
        hasSurfaceVideo: false,
        hasRect: true,
        endedCause: null,
        surfaceReleased: false,
      }),
    ).toBe(false)
  })
})

describe("the expand wiring (R4)", () => {
  it("pushes the watch route with the encoded slug", async () => {
    const id = attachSlot({
      session: { ...SESSION_A, videoSlug: "día-1" },
    })
    const renderer = await renderHost()
    await startPlayback()
    await detach(id)

    await act(async () => {
      fireWindowAction(renderer, "activate")
    })

    // The REAL host callback: a wrong prefix or a dropped encodeURIComponent
    // here would ship with every prop-level suite green.
    expect(mockRouterPush).toHaveBeenCalledWith(
      `/watch/${encodeURIComponent("día-1")}`,
    )
  })
})

describe("the resting corner across route and layout changes (R4/R7)", () => {
  async function setSegments(
    renderer: TestInstance,
    segments: readonly string[],
  ) {
    mockSegments = segments
    await act(async () => {
      renderer.update(<PlaybackHost />)
    })
  }

  async function setInsets(
    renderer: TestInstance,
    insets: { top: number; bottom: number; left: number; right: number },
  ) {
    mockInsets = insets
    await act(async () => {
      renderer.update(<PlaybackHost />)
    })
  }

  function repositionCall(spy: jest.SpyInstance) {
    return spy.mock.calls.find(
      ([, config]) =>
        (config as { duration?: number }).duration === REPOSITION_DURATION_MS,
    )
  }

  /** The window's on-screen top edge: frame geometry plus the drag offset. */
  function frameVisualTop(renderer: TestInstance) {
    const style = frameStyle(renderer) as {
      top?: number
      transform?: Array<{ translateY?: { __getValue: () => number } }>
    }
    const dragY = style.transform?.find(
      (entry) => entry.translateY != null,
    )?.translateY
    if (style.top == null || dragY == null)
      throw new Error("no positioned frame")
    return style.top + dragY.__getValue()
  }

  /** A settled floating window at a tab root, where the corner frame reserves
   *  the tab bar's height. */
  async function floatAtTabRoot() {
    mockSegments = ["(tabs)"]
    jest.useFakeTimers()
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(id)
    await act(async () => {
      jest.advanceTimersByTime(SHRINK_DURATION_MS + 300)
    })
    return renderer
  }

  /** The same window moved into a TOP corner: bottomRight -> bottomLeft ->
   *  topRight. The snap is JS-driven, so the timers have to run it out before
   *  the drag offset is measurable. */
  async function floatInATopCorner() {
    const renderer = await floatAtTabRoot()
    await act(async () => {
      fireWindowAction(renderer, "moveToCorner")
    })
    await act(async () => {
      fireWindowAction(renderer, "moveToCorner")
    })
    await act(async () => {
      jest.advanceTimersByTime(400)
    })
    return renderer
  }

  it("glides a top-corner window when a header route lifts that corner", async () => {
    const renderer = await floatInATopCorner()
    const topBefore = frameVisualTop(renderer)
    const timingSpy = jest.spyOn(Animated, "timing")

    // The header routes are the app's only chrome.top change. They move a TOP
    // corner's target while the default corner stays put, so a glide armed off
    // the default frame alone teleports the window down a header's height.
    await setSegments(renderer, ["video", "[sectionKey]"])

    const call = repositionCall(timingSpy)
    expect(call).toBeDefined()
    // The ramp starts where the window already is. The drag rides the frame
    // ABOVE it, so the from-rect must be the old position minus that drag.
    expect(frameVisualTop(renderer)).toBe(topBefore)

    // The ramp's FAR end must be where the settle parks the window: `to` is
    // otherwise unobservable, and aiming it at the corner target instead of
    // the base frame flings the window off screen for the whole 260ms.
    const ramp = (call as unknown as [Animated.Value, unknown])[0]
    const motionNode = renderer.root.findAll(
      (n) => n.props.testID === "playback-motion",
    )[0]
    const rampY = (
      StyleSheet.flatten(motionNode.props.style) as {
        transform?: Array<{ translateY?: { __getValue: () => number } }>
      }
    ).transform?.find((entry) => entry.translateY != null)?.translateY
    expect(rampY).toBeDefined()
    await act(async () => {
      ramp.setValue(1)
    })
    const rampEnd = frameVisualTop(renderer) + rampY!.__getValue()

    await act(async () => {
      jest.advanceTimersByTime(REPOSITION_DURATION_MS + 300)
    })
    expect(frameVisualTop(renderer)).toBe(rampEnd)
    expect(frameVisualTop(renderer)).toBeGreaterThan(topBefore)
  })

  it("lands directly when the header route leaves the occupied corner alone", async () => {
    const renderer = await floatAtTabRoot()
    const topBefore = frameVisualTop(renderer)
    const timingSpy = jest.spyOn(Animated, "timing")

    // The SAME header push over a BOTTOM corner. chrome.top moves only the top
    // edge, so this corner's target is unchanged and the window must not
    // animate — the glide follows the corner, not the layout object. Green on
    // both sides by design: layoutConfig really does change here, so a widened
    // "any layout change glides" predicate turns this red.
    await setSegments(renderer, ["video", "[sectionKey]"])

    expect(repositionCall(timingSpy)).toBeUndefined()
    expect(frameVisualTop(renderer)).toBe(topBefore)
    await act(async () => {
      jest.advanceTimersByTime(REPOSITION_DURATION_MS + 300)
    })
    expect(frameVisualTop(renderer)).toBe(topBefore)
  })

  it("lands directly when the chrome changes mid-snap", async () => {
    const renderer = await floatAtTabRoot()
    const timingSpy = jest.spyOn(Animated, "timing")

    // The corner is recorded when the snap STARTS, so for its 180ms the drag
    // node is still behind the recorded rest. Gliding from a rest the window
    // has not reached yet moves it twice.
    await act(async () => {
      fireWindowAction(renderer, "moveToCorner")
    })
    await act(async () => {
      fireWindowAction(renderer, "moveToCorner")
    })
    await setSegments(renderer, ["video", "[sectionKey]"])

    expect(repositionCall(timingSpy)).toBeUndefined()
  })

  it("keeps one corner height when a push removes the tab bar", async () => {
    const renderer = await floatAtTabRoot()
    const topAtTabRoot = frameVisualTop(renderer)
    const timingSpy = jest.spyOn(Animated, "timing")

    // Series/mission pages carry no tab bar, but the bottom reservation is
    // constant (owner decision 2026-08-19): the window neither drops into
    // the freed space nor animates — it simply stays put.
    await setSegments(renderer, ["series", "[slug]"])
    expect(frameVisualTop(renderer)).toBe(topAtTabRoot)
    expect(repositionCall(timingSpy)).toBeUndefined()
    await act(async () => {
      jest.advanceTimersByTime(REPOSITION_DURATION_MS + 300)
    })
    expect(frameVisualTop(renderer)).toBe(topAtTabRoot)
  })

  it("glides to the re-derived corner when the layout itself changes", async () => {
    const renderer = await floatAtTabRoot()
    const topBefore = frameVisualTop(renderer)
    const timingSpy = jest.spyOn(Animated, "timing")

    // A real layout change (a safe-area inset shift) still re-derives the
    // corner. The move rides the from-anchored ramp: the first committed
    // frame stays at the old corner — never a teleport.
    await setInsets(renderer, { top: 0, bottom: 34, left: 0, right: 0 })
    expect(frameVisualTop(renderer)).toBe(topBefore)
    expect(repositionCall(timingSpy)).toBeDefined()

    await act(async () => {
      jest.advanceTimersByTime(REPOSITION_DURATION_MS + 300)
    })
    expect(frameVisualTop(renderer)).toBeLessThan(topBefore)
  })

  it("holds the on-screen frame from the tap until the grow consumes it", async () => {
    const renderer = await floatAtTabRoot()
    const topAtTabRoot = frameVisualTop(renderer)

    await act(async () => {
      fireWindowAction(renderer, "activate")
    })
    expect(mockRouterPush).toHaveBeenCalled()
    // A layout re-derivation landing mid-push must not move the window —
    // the tap pinned the frame the viewer is watching until the grow.
    mockInsets = { top: 0, bottom: 34, left: 0, right: 0 }
    await setSegments(renderer, ["watch", "[slug]"])
    expect(frameVisualTop(renderer)).toBe(topAtTabRoot)

    // The rect arrives: the grow runs and the frame sits at the rect.
    const timingSpy = jest.spyOn(Animated, "timing")
    await attachSlotInAct()
    const growCall = timingSpy.mock.calls.find(
      ([, config]) =>
        (config as { duration?: number }).duration === EXPAND_DURATION_MS,
    )
    expect(growCall).toBeDefined()
    expect(frameStyle(renderer)).toMatchObject({ left: RECT.x, top: RECT.y })
    await act(async () => {
      jest.advanceTimersByTime(EXPAND_DURATION_MS + 300)
    })
    expect(frameStyle(renderer)).toMatchObject({ left: RECT.x, top: RECT.y })
  })

  it("drops a stale hold once the push window has passed", async () => {
    const renderer = await floatAtTabRoot()
    const topAtTabRoot = frameVisualTop(renderer)

    await act(async () => {
      fireWindowAction(renderer, "activate")
    })
    mockInsets = { top: 0, bottom: 34, left: 0, right: 0 }
    await setSegments(renderer, ["watch", "[slug]"])
    expect(frameVisualTop(renderer)).toBe(topAtTabRoot)

    await act(async () => {
      jest.advanceTimersByTime(EXPAND_HOLD_TIMEOUT_MS + 100)
    })
    // The expand never completed. A later layout change re-derives from the
    // LIVE config; the dead tap must not pin the window forever.
    await setInsets(renderer, { top: 0, bottom: 60, left: 0, right: 0 })
    await act(async () => {
      jest.advanceTimersByTime(REPOSITION_DURATION_MS + 300)
    })
    expect(frameVisualTop(renderer)).toBeLessThan(topAtTabRoot)
  })
})

describe("the dismissal exit (R6)", () => {
  async function dismiss() {
    await act(async () => {
      sessionStore.requestDismiss()
    })
  }

  it("slides the whole window out: the frame rides the exit wrapper", async () => {
    jest.useFakeTimers()
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(id)
    await dismiss()

    // The exit must translate the frame ITSELF — box, chrome and video leave
    // together. With the wrapper inside the frame, the contents slid away
    // while the stationary black box stayed behind and then blinked out.
    const exit = renderer.root.findAll(
      (node) => node.props.testID === "playback-exit",
    )[0] as unknown as {
      findAll(
        predicate: (node: { props: { testID?: unknown } }) => boolean,
      ): unknown[]
    }
    expect(
      exit.findAll((node) => node.props.testID === "playback-frame").length,
    ).toBeGreaterThan(0)
  })

  it("clears the dismissed session when the exit animation never reports back", async () => {
    jest.useFakeTimers()
    const id = attachSlot()
    await renderHost()
    await startPlayback()
    await detach(id)

    // The one driver state jest cannot reach on its own: its mocked native
    // animations always settle (measured 2026-08-18, react-native 0.86.2), so
    // a driver that goes silent has to be stood up here.
    jest.spyOn(Animated, "timing").mockReturnValue({
      start: () => {},
      stop: () => {},
      reset: () => {},
    } as never)

    await dismiss()
    expect(sessionStore.getSnapshot().dismissal).toBe("exiting")

    await act(async () => {
      jest.advanceTimersByTime(EXIT_DURATION_MS + 1000)
    })

    expect(sessionStore.getSnapshot().session).toBeNull()
  })

  it("puts the exit translation back when a mounted slot survives the dismissal", async () => {
    jest.useFakeTimers()
    // The series trailer beneath the episode: session-less, so it is refused
    // while the window lives and takes the player back the moment it goes.
    // That is what keeps this host mounted across a completed dismissal.
    attachSlot({ session: null, streamingUrl: URL_B })
    const watch = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(watch)
    expect(sessionStore.getSnapshot().session).not.toBeNull()

    await dismiss()
    // SYNTHETIC: stands in for the position the native driver leaves the node
    // at on device. A native-driven value never moves in jest (measured
    // 2026-08-18, react-native 0.86.2), so the animation cannot strand it here.
    await act(async () => {
      exitTranslation(renderer).setValue(600)
    })
    await act(async () => {
      jest.advanceTimersByTime(EXIT_DURATION_MS + 1000)
    })

    expect(sessionStore.getSnapshot().session).toBeNull()
    expect(requestStore.getSnapshot().request?.streamingUrl).toBe(URL_B)
    expect(exitTranslation(renderer).__getValue()).toBe(0)
  })

  it("slides the exit from the corner the window occupies", async () => {
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(id)
    // Park the window in a TOP corner — reachable by drag-snap and by the
    // moveToCorner accessibility action (bottomRight -> bottomLeft -> topRight).
    await act(async () => {
      fireWindowAction(renderer, "moveToCorner")
    })
    await act(async () => {
      fireWindowAction(renderer, "moveToCorner")
    })
    const timingSpy = jest.spyOn(Animated, "timing")

    await dismiss()

    // Measured from the OCCUPIED corner: the default-corner distance stops a
    // top-corner window mid-screen, fully visible, then blinks it out.
    const { width, height } = Dimensions.get("window")
    const top = miniPlayerCornerFrame(
      {
        screen: { width, height },
        insets: { top: 0, right: 0, bottom: 0, left: 0 },
        chrome: { top: 0, bottom: 0 },
      },
      "topRight",
    )
    const exitCall = timingSpy.mock.calls.find(
      ([, config]) =>
        (config as { duration?: number }).duration === EXIT_DURATION_MS,
    )
    expect(exitCall).toBeDefined()
    expect(
      (exitCall?.[1] as { toValue: number }).toValue,
    ).toBeGreaterThanOrEqual(height - top.y)
  })

  it("goes inert while the exit runs, so a second tap cannot expand it", async () => {
    jest.useFakeTimers()
    const id = attachSlot()
    const renderer = await renderHost()
    await startPlayback()
    await detach(id)
    mockRouterPush.mockClear()

    await dismiss()
    expect(sessionStore.getSnapshot().dismissal).toBe("exiting")
    const windowNode = renderer.root.findAll(
      (n) => n.props.testID === "mini-player-window",
    )[0]
    // Touches: dismiss and expand are adjacent taps on a small surface, and a
    // regret-tap chasing the departing window would push a route the exit
    // then clears the session under.
    expect(windowNode.props.pointerEvents).toBe("none")

    // Assistive tech takes the same rule from the handler itself.
    await act(async () => {
      fireWindowAction(renderer, "activate")
    })

    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it("animates a second dismissal after the first has completed", async () => {
    jest.useFakeTimers()
    attachSlot({ session: null, streamingUrl: URL_B })
    const first = attachSlot()
    await renderHost()
    await startPlayback()
    await detach(first)
    await dismiss()
    await act(async () => {
      jest.advanceTimersByTime(EXIT_DURATION_MS + 1000)
    })
    expect(sessionStore.getSnapshot().session).toBeNull()

    const second = await attachSlotInAct()
    await startPlayback()
    await detach(second)
    expect(sessionStore.getSnapshot().session).not.toBeNull()

    await dismiss()
    expect(sessionStore.getSnapshot().dismissal).toBe("exiting")
    await act(async () => {
      jest.advanceTimersByTime(EXIT_DURATION_MS + 1000)
    })

    expect(sessionStore.getSnapshot().session).toBeNull()
  })
})

describe("replacement (R12)", () => {
  it("replaces the published session when a second video opens", async () => {
    const first = attachSlot()
    await renderHost()
    await startPlayback()
    video.__player.currentTime = 90
    await detach(first)
    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-a")

    const endings: MiniPlayerEndEvent[] = []
    const unsubscribe = sessionStore.onEnd((event) => endings.push(event))
    const second = await attachSlotInAct({
      streamingUrl: URL_B,
      progressVideoId: "video-b",
      session: {
        ...SESSION_A,
        videoId: "video-b",
        videoSlug: "video-b-slug",
        title: "Video B",
      },
    })
    await act(async () => {
      video.__settleReplace()
    })

    expect(endings.map((e) => e.reason)).toEqual(["replaced"])
    expect(endings[0].session.videoId).toBe("video-a")
    expect(sessionStore.getSnapshot().session).toBeNull()

    await startPlayback()
    video.__player.currentTime = 5
    await detach(second)

    expect(sessionStore.getSnapshot().session?.videoId).toBe("video-b")
    // Still one player: the second video swapped into it rather than making one,
    // so every creation call still carries the first video's frozen source.
    expect(video.__player.replaceAsync).toHaveBeenCalledWith(URL_B)
    for (const call of video.useVideoPlayer.mock.calls)
      expect(call[0]).toBe(URL_A)
    unsubscribe()
  })
})
