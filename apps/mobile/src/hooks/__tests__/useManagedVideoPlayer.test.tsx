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

beforeEach(() => {
  jest.clearAllMocks()
  resetExpoVideoMock()
  appStateHandlers = []
  liveRenderers = []
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

    // TODAY the departing flush is attributed to "unmount" because it rides the
    // recorder re-key's effect cleanup. That misattribution is exactly what U5
    // re-keys onto an explicit signal — this pins the current reason so the
    // change is deliberate rather than incidental.
    expect(flushTriggers()).toEqual(["unmount"])
    expect(qoeSessions()).toHaveLength(2)
    expect(qoeSessions()[0].finalize).toHaveBeenCalledWith("abandoned")
  })

  it("flushes with 'background' and pauses when the app backgrounds", async () => {
    const { player } = await render()

    await sendAppState("background")

    expect(flushTriggers()).toEqual(["background"])
    expect(player.pause).toHaveBeenCalledTimes(1)
  })

  it("pauses on an 'inactive' transition", async () => {
    const { player } = await render()

    await sendAppState("inactive")

    // The discriminating case. 'inactive' is iOS's control-centre/app-switcher
    // state AND, on Android, is NOT what picture-in-picture reports — entering
    // picture-in-picture arrives as 'background'. After U5 this pause must
    // become conditional on the picture-in-picture latch; today it is
    // unconditional, and this is the only scenario that separates the two.
    expect(player.pause).toHaveBeenCalledTimes(1)
    expect(flushTriggers()).toEqual(["background"])
  })

  it("flushes with 'end' when playback reaches the end", async () => {
    const { player } = await render()

    await act(async () => {
      player.emit("playToEnd")
    })

    expect(flushTriggers()).toEqual(["end"])
  })
})
