/**
 * Behavioural net over the one expo-video lifecycle adapter, written BEFORE the
 * mini player re-keys it (U2 guards U5). These render the real VideoPlayer with
 * the real adapter and mock only the edges: expo-video, the recorder, and the
 * QoE session. What they pin is which trigger and which reason each lifecycle
 * edge produces — the thing the re-key is allowed to change only deliberately.
 *
 * Two AppState listeners exist in one render: the adapter's (pause/resume,
 * registered first) and VideoPlayer's own (an autostart retry that ignores
 * anything but "active"). `sendAppState` broadcasts to both, exactly as the real
 * AppState does, and every assertion is on an outcome only one of them can
 * produce.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../test-utils/expoVideoMock").expoVideoModuleMock(),
)
// Partial on purpose: VideoPlayer's subtree reaches other `expo` exports, and a
// full replacement only survives while no child needs one.
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  const { useEffect, useState } = require("react")
  return {
    ...actual,
    // Subscribe for real against the fake player's registry so a test can drive
    // playing state with `player.emit("playingChange", …)`.
    useEvent: (
      player: {
        addListener: (
          n: string,
          cb: (p: unknown) => void,
        ) => { remove: () => void }
      },
      name: string,
      initial: unknown,
    ) => {
      const [value, setValue] = useState(initial)
      useEffect(() => {
        const sub = player.addListener(name, (payload: unknown) => {
          setValue(payload)
        })
        return () => sub.remove()
      }, [player, name])
      return value
    },
  }
})
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-blur", () => {
  const { View } = require("react-native")
  return { BlurView: View }
})
jest.mock("expo-linear-gradient", () => {
  const { View } = require("react-native")
  return { LinearGradient: View }
})
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: View }
})
jest.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: jest.fn(() => Promise.resolve("")),
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))
// The recorder's own deps reach SecureStore/AsyncStorage at import; the adapter
// only threads them into the factory, which is mocked below.
jest.mock("../../lib/watchProgress/store", () => ({
  applyLocalProgress: jest.fn(),
  bufferProgressIntent: jest.fn(),
}))
jest.mock("../../lib/watchProgress/signInPrompt", () => ({
  noteSignedOutPlaybackStop: jest.fn(),
}))
jest.mock("../../lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({ drainIntents: jest.fn() }),
  getSignedInAccountId: () => "account-1",
}))
jest.mock("../../lib/watchProgress/recorder", () => ({
  createProgressRecorder: jest.fn(() => ({
    flush: jest.fn(),
    onTick: jest.fn(),
  })),
}))
jest.mock("../../lib/videoQoe", () => ({
  createVideoQoeSession: jest.fn(() => ({
    onFirstPlaying: jest.fn(() => null),
    onRebuffer: jest.fn(),
    onError: jest.fn(),
    onTimeUpdate: jest.fn(),
    finalize: jest.fn(() => null),
  })),
  shouldCountRebuffer: jest.fn(() => false),
}))

import { act } from "react"
import { AppState, type AppStateStatus } from "react-native"

import { VideoPlayer } from "../../components/watch/VideoPlayer"
import {
  lastFakePlayer,
  resetExpoVideoMock,
  type FakePlayer,
} from "../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import { createProgressRecorder } from "../../lib/watchProgress/recorder"
import { createVideoQoeSession } from "../../lib/videoQoe"
import { useManagedVideoPlayer } from "../useManagedVideoPlayer"
import {
  resetPictureInPictureLatch,
  setPictureInPictureActive,
} from "../../lib/miniPlayer/pipLatch"

type RecorderSpy = { flush: jest.Mock; onTick: jest.Mock }
type QoeSpy = { finalize: jest.Mock }

const createRecorderMock = createProgressRecorder as unknown as jest.Mock
const createQoeMock = createVideoQoeSession as unknown as jest.Mock

const EPISODE_ONE = "https://stream.test/one.m3u8"
const EPISODE_TWO = "https://stream.test/two.m3u8"

/** Every AppState handler registered by the current render, in order. */
let appStateHandlers: ((state: AppStateStatus) => void)[] = []

/** Broadcast like the real AppState: every live listener sees the transition. */
async function sendAppState(state: AppStateStatus) {
  await act(async () => {
    for (const handler of [...appStateHandlers]) handler(state)
  })
}

/** Drive the adapter's playing state, which it mirrors into its resume latch. */
async function setPlaying(player: FakePlayer, isPlaying: boolean) {
  await act(async () => {
    player.playing = isPlaying
    player.emit("playingChange", { isPlaying })
  })
}

function qoeSessions(): QoeSpy[] {
  return createQoeMock.mock.results.map((result) => result.value as QoeSpy)
}

/** Every flush trigger seen this test, in order — the reason vocabulary. */
function flushTriggers(): unknown[] {
  return createRecorderMock.mock.results
    .flatMap((result) => (result.value as RecorderSpy)?.flush.mock.calls ?? [])
    .map((call) => call[0])
}

function element(props: { streamingUrl: string; videoId: string }) {
  return (
    <VideoPlayer
      streamingUrl={props.streamingUrl}
      posterUrl={null}
      progressIdentity={{ videoId: props.videoId, languageSlug: "english" }}
    />
  )
}

/** Rendered this test, so afterEach can tear down the adapter's timers. */
let liveRenderers: TestInstance[] = []

async function render(
  props = { streamingUrl: EPISODE_ONE, videoId: "video-1" },
): Promise<{ renderer: TestInstance; player: FakePlayer }> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element(props))
  })
  liveRenderers.push(renderer)
  return { renderer, player: lastFakePlayer() }
}

type Handle = ReturnType<typeof useManagedVideoPlayer>

/**
 * Renders the adapter alone, so a test can call the explicit end signal the
 * hook returns. VideoPlayer does not expose it — the surfaces that drive it
 * are the root host and the window, which arrive in U6 and U7.
 */
async function renderWithHandle(): Promise<{
  renderer: TestInstance
  hook: { current: Handle | null }
}> {
  const hook: { current: Handle | null } = { current: null }
  const Probe = () => {
    hook.current = useManagedVideoPlayer(EPISODE_ONE, undefined, {
      progress: { videoId: "video-1", languageSlug: "english" },
    })
    return null
  }

  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<Probe />)
  })
  liveRenderers.push(renderer)
  return { renderer, hook }
}

beforeEach(() => {
  jest.clearAllMocks()
  resetExpoVideoMock()
  appStateHandlers = []
  liveRenderers = []
  // Module scope: the latch outlives any one render, so a test that sets it
  // would otherwise leak into the next.
  resetPictureInPictureLatch()
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((event, handler) => {
      if (event === "change")
        appStateHandlers.push(handler as (state: AppStateStatus) => void)
      return {
        remove: () => {
          appStateHandlers = appStateHandlers.filter((h) => h !== handler)
        },
      } as ReturnType<typeof AppState.addEventListener>
    })
})

afterEach(async () => {
  // The adapter arms a 1s stall-watchdog interval and VideoPlayer arms an
  // autostart veil timeout. A test that asserts mid-life leaves both running,
  // which jest reports as an open handle and which can bleed across suites.
  for (const renderer of liveRenderers) {
    await act(async () => {
      try {
        renderer.unmount()
      } catch {
        // Already unmounted by the test itself.
      }
    })
  }
  liveRenderers = []
  jest.restoreAllMocks()
})

describe("useManagedVideoPlayer lifecycle", () => {
  it("registers both AppState listeners, so a broadcast reaches the adapter", async () => {
    await render()
    // Pins the premise the other AppState assertions rest on. If this drops to
    // one, an outcome below could be attributed to the wrong listener.
    expect(appStateHandlers).toHaveLength(2)
  })

  it("flushes once with 'unmount' and finalizes the session once on unmount", async () => {
    const { renderer } = await render()
    const sessionsBefore = qoeSessions()

    await act(async () => {
      renderer.unmount()
    })

    expect(flushTriggers()).toEqual(["unmount"])
    expect(sessionsBefore[0].finalize).toHaveBeenCalledTimes(1)
    expect(sessionsBefore[0].finalize).toHaveBeenCalledWith("abandoned")
  })

  it("flushes the departing video and opens a new session on an episode swap", async () => {
    const { renderer } = await render()
    expect(qoeSessions()).toHaveLength(1)

    await act(async () => {
      renderer.update(
        element({ streamingUrl: EPISODE_TWO, videoId: "video-2" }),
      )
    })

    // U2 recorded "unmount" here, because the departing flush rides the
    // recorder re-key's effect cleanup and that was the only word available.
    // U5 gives the cleanup the reason that actually applies. The flush still
    // happens THERE — only the departing recorder holds the departing
    // position — but it now says what really happened.
    expect(flushTriggers()).toEqual(["swap"])
    expect(qoeSessions()).toHaveLength(2)
    expect(qoeSessions()[0].finalize).toHaveBeenCalledWith("replaced")
  })

  it("reports a dismiss as dismissed, not abandoned", async () => {
    const { renderer, hook } = await renderWithHandle()

    await act(async () => {
      hook.current?.endSession("dismissed")
    })

    expect(flushTriggers()).toEqual(["dismiss"])
    expect(qoeSessions()[0].finalize).toHaveBeenCalledWith("dismissed")

    // The teardown net must not overwrite the named reason afterwards. This is
    // the whole point of R16/R17: before U5, unmounting after a dismiss filed
    // the session as an abandonment.
    await act(async () => {
      renderer.unmount()
    })
    expect(flushTriggers()).toEqual(["dismiss"])
    expect(qoeSessions()[0].finalize).toHaveBeenCalledTimes(1)
  })

  it("maps each named end onto its own progress trigger", async () => {
    for (const [reason, trigger] of [
      ["ended", "end"],
      ["dismissed", "dismiss"],
      ["signout", "signout"],
      ["failed", "dismiss"],
    ] as const) {
      jest.clearAllMocks()
      resetExpoVideoMock()
      appStateHandlers = []
      liveRenderers = []
      const { hook } = await renderWithHandle()

      await act(async () => {
        hook.current?.endSession(reason)
      })

      expect(flushTriggers()).toEqual([trigger])
      expect(qoeSessions()[0].finalize).toHaveBeenCalledWith(reason)
    }
  })

  it("flushes with 'background' and pauses when the app backgrounds", async () => {
    const { player } = await render()

    await sendAppState("background")

    expect(flushTriggers()).toEqual(["background"])
    expect(player.pause).toHaveBeenCalledTimes(1)
  })

  it("does NOT pause on an 'inactive' transition (U5 inverted this)", async () => {
    const { player } = await render()

    await sendAppState("inactive")

    // U2 recorded the opposite, because the adapter paused on anything that
    // was not "active". 'inactive' is iOS's app-switcher / control-centre /
    // call-banner blip, which the viewer swipes straight back out of.
    expect(player.pause).not.toHaveBeenCalled()
    expect(flushTriggers()).toEqual([])
  })

  it("does NOT pause on 'inactive' while picture-in-picture is active", async () => {
    setPictureInPictureActive(true)
    const { player } = await render()

    await sendAppState("inactive")

    expect(player.pause).not.toHaveBeenCalled()
  })

  it("does NOT pause on 'background' while picture-in-picture is active (R13)", async () => {
    // The case that matters on Android, which reports picture-in-picture ENTRY
    // as 'background'. Pausing here stops the video the system just handed to
    // the floating OS window.
    setPictureInPictureActive(true)
    const { player } = await render()

    await sendAppState("background")

    expect(player.pause).not.toHaveBeenCalled()
    expect(flushTriggers()).toEqual([])
  })

  it("still pauses on 'background' when picture-in-picture is not active", async () => {
    setPictureInPictureActive(false)
    const { player } = await render()

    await sendAppState("background")

    expect(player.pause).toHaveBeenCalledTimes(1)
  })

  it("resumes on the following 'active' when the app left while playing", async () => {
    // The anti-vacuous companion for the two cases below: without it, an
    // adapter that never resumed at all would satisfy both of them.
    const { player } = await render()
    await setPlaying(player, true)

    await sendAppState("background")
    await sendAppState("active")

    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it("does NOT resume a video the viewer paused after the last departure", async () => {
    const { player } = await render()
    await setPlaying(player, true)
    // The first round trip stamps the resume latch true.
    await sendAppState("background")
    await sendAppState("active")
    expect(player.play).toHaveBeenCalledTimes(1)

    // The viewer pauses, then an 'inactive' blip arrives (control centre, a
    // call banner, Face ID). It does not pause, but it IS a departure, so it
    // must re-stamp the latch — 'active' trusts the latch unconditionally.
    await setPlaying(player, false)
    await sendAppState("inactive")
    await sendAppState("active")

    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it("does NOT resume a paused video after a picture-in-picture departure (R13)", async () => {
    // Same defect through the other non-pausing branch. Android reports
    // picture-in-picture ENTRY as 'background', which never reaches the pause.
    setPictureInPictureActive(true)
    const { player } = await render()
    await setPlaying(player, true)
    await sendAppState("background")
    await sendAppState("active")
    expect(player.play).toHaveBeenCalledTimes(1)

    await setPlaying(player, false)
    await sendAppState("background")
    await sendAppState("active")

    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it("flushes with 'end' when playback reaches the end", async () => {
    const { player } = await render()

    await act(async () => {
      player.emit("playToEnd")
    })

    expect(flushTriggers()).toEqual(["end"])
  })
})
