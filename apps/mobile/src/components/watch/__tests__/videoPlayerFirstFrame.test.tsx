// feat-785 KTD19: the release check times the first video frame by waiting
// for `player-first-frame`, so the view must appear only once playback
// starts, not when the autostart veil lifts for another reason.

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
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => false,
}))
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
jest.mock("../PlayerControls", () => ({
  PlayerControls: () => null,
  RouteButtons: () => null,
  fullscreenCaptionOffset: () => 0,
}))
jest.mock("../SeekFlashPill", () => ({ SeekFlashPill: () => null }))

import { act } from "react"
import { StyleSheet } from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"

import { VideoPlayer } from "../VideoPlayer"
import {
  TestRenderer,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const FIRST_FRAME = "player-first-frame"

function fakePlayer() {
  return {
    playing: false,
    currentTime: 0,
    duration: 600,
    isExternalPlaybackActive: false,
    allowsExternalPlayback: true,
    addListener: () => ({ remove: () => {} }),
    play: () => {},
    pause: () => {},
  }
}

const player = fakePlayer() as unknown as ExpoVideoPlayer

function element({
  isPlaying = false,
  loadFailed = false,
}: {
  isPlaying?: boolean
  loadFailed?: boolean
}) {
  return (
    <VideoPlayer
      player={player}
      isPlaying={isPlaying}
      loadFailed={loadFailed}
      autostart
      streamingUrl="https://stream.mux.com/abc123.m3u8"
      posterUrl={null}
    />
  )
}

function firstFrameNodes(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll(
    (n) => typeof n.type === "string" && n.props.testID === FIRST_FRAME,
  )
}

async function render(props: {
  isPlaying?: boolean
  loadFailed?: boolean
}): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element(props))
  })
  return renderer
}

describe("the first-frame testID (KTD19)", () => {
  it("is absent while the autostarting player waits to play", async () => {
    const renderer = await render({})

    expect(firstFrameNodes(renderer)).toHaveLength(0)
    await unmount(renderer)
  })

  it("appears once playback starts, and draws nothing over the video", async () => {
    const renderer = await render({})
    await act(async () => {
      renderer.update(element({ isPlaying: true }))
    })

    const nodes = firstFrameNodes(renderer)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].props.pointerEvents).toBe("none")
    expect(StyleSheet.flatten(nodes[0].props.style)).toEqual(
      StyleSheet.absoluteFill,
    )
    await unmount(renderer)
  })

  it("is absent when a load failure lifts the veil", async () => {
    const renderer = await render({ loadFailed: true })

    expect(firstFrameNodes(renderer)).toHaveLength(0)
    await unmount(renderer)
  })
})
