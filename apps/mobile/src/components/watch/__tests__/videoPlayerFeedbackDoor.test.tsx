/**
 * The player door (U6, KTD5) in VideoPlayer: the settings sheet's report row
 * captures the video and its position AT THE TAP, the settings sheet closes
 * first, and the feedback modal mounts only from that sheet's `onClose`.
 *
 * Both sheets are stubs that log their mount order and expose the callbacks
 * VideoPlayer wires; their own behaviour lives in `PlayerSettingsSheet.test.tsx`
 * and `FeedbackModal.test.tsx`. What jest CANNOT see is the native side of that
 * order — two UIKit presentations — which stays a simulator check.
 */

// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isInternetReachable: true }),
}))
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
}))
// The chrome must be mounted for the settings opener to exist; the visibility
// machine has its own suite.
jest.mock("../../../hooks/useControlsVisibility", () => {
  const { Animated } = jest.requireActual("react-native")
  const opacityAnim = new Animated.Value(1)
  return {
    useControlsVisibility: () => ({
      controlsVisible: true,
      mounted: true,
      opacityAnim,
      hide: () => {},
      revealIfHidden: () => {},
      isVisibleNow: () => true,
      noteInteraction: () => {},
      isPlaying: true,
    }),
  }
})
jest.mock("../../../hooks/useEndedPosterFade", () => {
  const { Animated } = jest.requireActual("react-native")
  const posterFade = new Animated.Value(1)
  return { useEndedPosterFade: () => ({ ended: false, posterFade }) }
})
jest.mock("../../../hooks/useErrorRecovery", () => ({
  useErrorRecovery: () => () => {},
}))
jest.mock("../PlayerLoadingVeil", () => ({ PlayerLoadingVeil: () => null }))
jest.mock("../SubtitleOverlay", () => ({ SubtitleOverlay: () => null }))
jest.mock("../PlayerControls", () => {
  const { Pressable } = jest.requireActual("react-native")
  return {
    PlayerControls: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
      <Pressable accessibilityLabel="Settings" onPress={onOpenSettings} />
    ),
    RouteButtons: () => null,
    fullscreenCaptionOffset: () => 0,
  }
})

const mockEvents: string[] = []
const mockFeedbackProps: Array<{ context: unknown; onClose: () => void }> = []

// The stub splits what the real row does in one press — report, then close —
// so the test can prove the modal mounts from `onClose` and not from the
// report callback.
jest.mock("../PlayerSettingsSheet", () => {
  const { useEffect } = jest.requireActual("react")
  const { Pressable } = jest.requireActual("react-native")
  return {
    PlayerSettingsSheet: ({
      onClose,
      onReportProblem,
    }: {
      onClose: () => void
      onReportProblem: () => void
    }) => {
      useEffect(() => {
        mockEvents.push("settings:mount")
        return () => {
          mockEvents.push("settings:unmount")
        }
      }, [])
      return (
        <>
          <Pressable
            accessibilityLabel="Report a problem with this video"
            onPress={onReportProblem}
          />
          <Pressable accessibilityLabel="Dismiss settings" onPress={onClose} />
        </>
      )
    },
  }
})
jest.mock("../../feedback/FeedbackModal", () => {
  const { useEffect } = jest.requireActual("react")
  const { Pressable } = jest.requireActual("react-native")
  return {
    FeedbackModal: (props: { context: unknown; onClose: () => void }) => {
      mockFeedbackProps.push(props)
      // Render time, not mount time: within ONE commit React renders the new
      // child before it runs the old child's cleanup, so only this entry can
      // tell a same-commit swap from a later commit.
      mockEvents.push("feedback:render")
      useEffect(() => {
        mockEvents.push("feedback:mount")
        return () => {
          mockEvents.push("feedback:unmount")
        }
      }, [])
      return (
        <Pressable
          accessibilityLabel="Close feedback"
          onPress={props.onClose}
        />
      )
    },
  }
})

import { act } from "react"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"

import { VideoPlayer, type VideoPlayerCast } from "../VideoPlayer"
import type { CastPlayback } from "../../../hooks/useCastPlayback"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const MUX_URL = "https://stream.mux.com/abc123.m3u8"
const VIDEO = { title: "JESUS", slug: "jesus", languageSlug: "english" }
const TAP_POSITION = 4324

type FakePlayer = {
  playing: boolean
  currentTime: number
  duration: number
  isExternalPlaybackActive: boolean
  allowsExternalPlayback: boolean
  addListener: () => { remove: () => void }
  play: () => void
  pause: () => void
}

function fakePlayer(currentTime = TAP_POSITION): FakePlayer {
  return {
    playing: true,
    currentTime,
    duration: 7620,
    isExternalPlaybackActive: false,
    allowsExternalPlayback: true,
    addListener: () => ({ remove: () => {} }),
    play: () => {},
    pause: () => {},
  }
}

function castFixture(position: number | null): VideoPlayerCast {
  const playback = {
    state: { phase: "active", deviceName: "Living room" },
    deviceName: "Living room",
    devicesAvailable: true,
    remotePlayerState: "playing",
    position,
    duration: 7620,
    load: () => {},
    play: () => {},
    pause: () => {},
    seekTo: () => {},
    end: () => {},
    reset: () => {},
  } satisfies CastPlayback
  return {
    playback,
    onCastPress: () => {},
    resolveMediaAt: () => null,
    recovery: null,
  }
}

type Options = {
  player?: FakePlayer
  feedbackContext?: typeof VIDEO | null
  cast?: VideoPlayerCast | null
}

function element(options: Options) {
  return (
    <VideoPlayer
      player={(options.player ?? fakePlayer()) as unknown as ExpoVideoPlayer}
      isPlaying
      streamingUrl={MUX_URL}
      posterUrl={null}
      feedbackContext={
        options.feedbackContext === undefined ? VIDEO : options.feedbackContext
      }
      cast={options.cast ?? null}
    />
  )
}

async function render(options: Options = {}) {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element(options))
  })
  return renderer
}

/** Opens settings, taps the report row, then lets the settings sheet close. */
async function openDoor(renderer: TestInstance) {
  await press(pressableByLabel(renderer, "Settings"))
  await press(pressableByLabel(renderer, "Report a problem with this video"))
  await press(pressableByLabel(renderer, "Dismiss settings"))
}

function latestContext(): unknown {
  return mockFeedbackProps.at(-1)?.context
}

beforeEach(() => {
  mockEvents.length = 0
  mockFeedbackProps.length = 0
})

describe("close-then-open (KTD5)", () => {
  it("mounts the feedback modal only after the settings sheet has gone", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Settings"))
    await press(pressableByLabel(renderer, "Report a problem with this video"))
    // The report callback alone opens nothing: the settings sheet is still up.
    expect(mockEvents).toEqual(["settings:mount"])

    await press(pressableByLabel(renderer, "Dismiss settings"))
    // The modal's FIRST render lands after the settings sheet's cleanup: a
    // later commit, not the one that removed the sheet.
    expect(mockEvents).toEqual([
      "settings:mount",
      "settings:unmount",
      "feedback:render",
      "feedback:mount",
    ])
    await unmount(renderer)
  })

  it("opens nothing when the settings sheet closes without a report", async () => {
    const renderer = await render()
    await press(pressableByLabel(renderer, "Settings"))
    await press(pressableByLabel(renderer, "Dismiss settings"))
    expect(mockEvents).toEqual(["settings:mount", "settings:unmount"])
    expect(mockFeedbackProps).toHaveLength(0)
    await unmount(renderer)
  })

  it("never re-opens the settings sheet when the feedback modal closes", async () => {
    const renderer = await render()
    await openDoor(renderer)
    await press(pressableByLabel(renderer, "Close feedback"))
    expect(mockEvents.filter((e) => e !== "feedback:render")).toEqual([
      "settings:mount",
      "settings:unmount",
      "feedback:mount",
      "feedback:unmount",
    ])
    await unmount(renderer)
  })
})

describe("captured context (R2/KD8/AE1)", () => {
  it("presets the kind and attaches title, slug, dub and the tap position", async () => {
    const renderer = await render()
    await openDoor(renderer)
    expect(latestContext()).toEqual({
      kind: "BROKEN",
      video: { ...VIDEO, positionSeconds: TAP_POSITION },
    })
    await unmount(renderer)
  })

  it("reads the position at the tap, not when the sheet closes or later", async () => {
    const player = fakePlayer(TAP_POSITION)
    const renderer = await render({ player })
    await press(pressableByLabel(renderer, "Settings"))
    await press(pressableByLabel(renderer, "Report a problem with this video"))
    // Playback continues under the sheet (R2); the report must not follow it.
    player.currentTime = TAP_POSITION + 90
    await press(pressableByLabel(renderer, "Dismiss settings"))
    player.currentTime = TAP_POSITION + 180
    await act(async () => {
      renderer.update(element({ player }))
    })
    const video = (latestContext() as { video: { positionSeconds: number } })
      .video
    expect(video.positionSeconds).toBe(TAP_POSITION)
    await unmount(renderer)
  })

  it("carries no video when the surface described none", async () => {
    // The series trailer dock publishes no session; the door still opens on
    // step two, with nothing to tag.
    const renderer = await render({ feedbackContext: null })
    await openDoor(renderer)
    expect(latestContext()).toEqual({ kind: "BROKEN", video: null })
    await unmount(renderer)
  })
})

describe("position while casting (KTD5)", () => {
  it("takes the receiver's playhead over the frozen local one", async () => {
    const player = fakePlayer(TAP_POSITION)
    const renderer = await render({ player, cast: castFixture(600) })
    await openDoor(renderer)
    const video = (latestContext() as { video: { positionSeconds: number } })
      .video
    expect(video.positionSeconds).toBe(600)
    await unmount(renderer)
  })

  it("carries no position when the receiver has not reported one", async () => {
    // The local player still holds a number here — the position the viewer
    // LEFT when casting began — and the report must not name that frame.
    const player = fakePlayer(TAP_POSITION)
    const renderer = await render({ player, cast: castFixture(null) })
    await openDoor(renderer)
    const video = (
      latestContext() as { video: { positionSeconds?: number | null } }
    ).video
    expect(video.positionSeconds ?? null).toBeNull()
    expect(video).toMatchObject(VIDEO)
    await unmount(renderer)
  })
})
