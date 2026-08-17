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
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
    push: jest.fn(),
  }),
  // A route none of the presentation tables name, so a published session
  // floats. U7's own suite owns the window's behaviour there.
  useSegments: () => [],
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../ui/PlatformBlur", () => ({ PlatformBlur: () => null }))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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
import { StyleSheet } from "react-native"

import { ENDED_FADE_DURATION_MS } from "../MiniPlayerWindow"
import { PlaybackHost } from "../PlaybackHost"
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
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

jest.setTimeout(20_000)

const video = jest.requireMock("expo-video") as ExpoVideoMock
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

function hasWindowChrome(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll((node) => node.props.testID === "mini-player-window")
      .length > 0
  )
}

function frameStyle(renderer: TestInstance) {
  const frame = renderer.root.findAll(
    (node) => node.props.testID === "playback-frame",
  )[0]
  return StyleSheet.flatten(frame.props.style) as { opacity?: number }
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
