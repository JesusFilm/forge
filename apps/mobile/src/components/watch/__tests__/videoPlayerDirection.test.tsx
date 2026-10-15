/**
 * VideoPlayer in a right-to-left layout (feat-695 R11, R12, KTD7). The player
 * layer stays left to right, so the seek flash shows on the tapped side; the
 * settings and feedback sheets take the app's own direction back.
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
// Mutable so a fullscreen case can give the player a side notch.
const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 }
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
}))
// The seek flash pill is glass on iOS 26 (feat-705); a host stand-in keeps the
// pill findable. `videoPlayerGlass.test.tsx` covers both branches.
jest.mock("../../../lib/liquidGlass", () => ({ canUseLiquidGlass: () => true }))
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))
// The chrome must be mounted for the settings opener to exist; the visibility
// machine has its own suite.
jest.mock("../../../hooks/useControlsVisibility", () => {
  const { Animated } = jest.requireActual("react-native")
  const { createControlsVisibleStore } = jest.requireActual(
    "../../../lib/controlsVisibility",
  )
  const opacityAnim = new Animated.Value(1)
  const visibleStore = createControlsVisibleStore(true)
  return {
    useControlsVisibility: () => ({
      controlsVisible: true,
      mounted: true,
      opacityAnim,
      visibleStore,
      hide: () => {},
      revealIfHidden: () => {},
      isVisibleNow: () => true,
      noteSeek: () => {},
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
  const { Pressable, View } = jest.requireActual("react-native")
  return {
    PlayerControls: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
      <Pressable accessibilityLabel="Settings" onPress={onOpenSettings} />
    ),
    RouteButtons: () => <View testID="route-buttons" />,
    fullscreenCaptionOffset: () => 0,
  }
})
jest.mock("../PlayerSettingsSheet", () => {
  const { Pressable } = jest.requireActual("react-native")
  return {
    PlayerSettingsSheet: ({
      onClose,
      onReportProblem,
    }: {
      onClose: () => void
      onReportProblem: () => void
    }) => (
      <>
        <Pressable
          accessibilityLabel="Report a problem with this video"
          onPress={onReportProblem}
        />
        <Pressable accessibilityLabel="Dismiss settings" onPress={onClose} />
      </>
    ),
  }
})
jest.mock("../../feedback/FeedbackModal", () => {
  const { Pressable } = jest.requireActual("react-native")
  return {
    FeedbackModal: ({ onClose }: { onClose: () => void }) => (
      <Pressable accessibilityLabel="Close feedback" onPress={onClose} />
    ),
  }
})

import { act } from "react"
import { I18nManager, StyleSheet } from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"

import { VideoPlayer } from "../VideoPlayer"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { directionAbove } from "../../../test-utils/layoutDirection"

function layoutIs(isRTL: boolean) {
  jest.spyOn(I18nManager, "getConstants").mockReturnValue({
    ...I18nManager.getConstants(),
    isRTL,
  })
  jest.replaceProperty(I18nManager, "isRTL", isRTL)
}

function hostByLabel(renderer: TestInstance, label: string): RenderedNode {
  const [node] = renderer.root.findAll(
    (n) => n.props.accessibilityLabel === label && typeof n.type === "string",
  )
  if (node == null) throw new Error(`no host node labelled ${label}`)
  return node
}

function fakePlayer(playing: boolean) {
  return {
    playing,
    currentTime: 60,
    duration: 600,
    isExternalPlaybackActive: false,
    allowsExternalPlayback: true,
    addListener: () => ({ remove: () => {} }),
    play: () => {},
    pause: () => {},
  }
}

/** `awaitingAutostart` renders the veil, with the route buttons over it. */
async function render({
  awaitingAutostart = false,
  fullscreen = false,
}: {
  awaitingAutostart?: boolean
  fullscreen?: boolean
} = {}): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <VideoPlayer
        player={fakePlayer(!awaitingAutostart) as unknown as ExpoVideoPlayer}
        isPlaying={!awaitingAutostart}
        autostart={awaitingAutostart}
        fullscreen={fullscreen}
        streamingUrl="https://stream.mux.com/abc123.m3u8"
        posterUrl={null}
        feedbackContext={null}
        cast={null}
      />,
    )
  })
  return renderer
}

afterEach(() => {
  jest.restoreAllMocks()
  Object.assign(mockInsets, { top: 0, bottom: 0, left: 0, right: 0 })
})

/** Two taps inside the double-tap window at `x` on a 300 pt wide player. */
async function doubleTapAt(renderer: TestInstance, x: number) {
  const tap = pressableByLabel(renderer, "Toggle player controls")
    .props as unknown as {
    onLayout: (e: unknown) => void
    onPressIn: () => void
    onPress: (e: unknown) => void
  }
  await act(async () => {
    tap.onLayout({
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 200 } },
    })
  })
  await act(async () => {
    tap.onPressIn()
    tap.onPress({ nativeEvent: { locationX: x } })
    tap.onPressIn()
    tap.onPress({ nativeEvent: { locationX: x } })
  })
}

function seekFlashStyle(renderer: TestInstance): Record<string, unknown> {
  const [flash] = renderer.root.findAll(
    (n) => n.props.testID === "seek-flash" && typeof n.type === "string",
  )
  if (flash == null) throw new Error("no seek flash view")
  return StyleSheet.flatten(flash.props.style as never) as Record<
    string,
    unknown
  >
}

describe("the double-tap seek flash (feat-695 R12)", () => {
  it("shows a left-side rewind at the physical left, inside a left-to-right layer", async () => {
    layoutIs(true)
    const renderer = await render()
    // The left third of the player.
    await doubleTapAt(renderer, 40)

    const [label] = renderer.root.findAll(
      (n) => n.props.children === "10s" && typeof n.type === "string",
    )
    let inFlash = false
    for (let n = label?.parent; n != null; n = n.parent) {
      if (n.props.testID === "seek-flash") inFlash = true
    }
    expect(inFlash).toBe(true)
    // The positioned view around the pill, which carries the side.
    const [flash] = renderer.root.findAll(
      (n) => n.props.testID === "seek-flash" && typeof n.type === "string",
    )
    if (flash == null) throw new Error("no seek flash view")
    expect(StyleSheet.flatten(flash.props.style as never)).toMatchObject({
      left: 12,
    })
    expect(directionAbove(flash)).toBe("ltr")
    await unmount(renderer)
  })
})

describe("the double-tap seek flash's edge", () => {
  it("sits 12 pt in from the right edge, in line with the fullscreen button", async () => {
    layoutIs(false)
    const renderer = await render()
    await doubleTapAt(renderer, 260)
    const style = seekFlashStyle(renderer)
    expect(style).toMatchObject({ right: 12 })
    expect(style.left).toBeUndefined()
    await unmount(renderer)
  })

  it.each([
    { side: "left", x: 40 },
    { side: "right", x: 260 },
  ])(
    "clears a $side side notch in fullscreen, as the fullscreen bar does",
    async ({ side, x }) => {
      layoutIs(false)
      Object.assign(mockInsets, { left: 59, right: 47 })
      const renderer = await render({ fullscreen: true })
      await doubleTapAt(renderer, x)
      expect(seekFlashStyle(renderer)).toMatchObject(
        side === "left" ? { left: 59 } : { right: 47 },
      )
      await unmount(renderer)
    },
  )

  it("keeps the 12 pt edge inline, where the page already clears the notch", async () => {
    layoutIs(false)
    Object.assign(mockInsets, { left: 59, right: 47 })
    const renderer = await render()
    await doubleTapAt(renderer, 40)
    expect(seekFlashStyle(renderer)).toMatchObject({ left: 12 })
    await unmount(renderer)
  })
})

describe("the autostart veil's route buttons (feat-695 R11)", () => {
  it.each([
    { layout: "right-to-left", isRTL: true, expected: "rtl" },
    { layout: "left-to-right", isRTL: false, expected: "ltr" },
  ])(
    "lay out in the app's own direction in a $layout layout",
    async ({ isRTL, expected }) => {
      layoutIs(isRTL)
      const renderer = await render({ awaitingAutostart: true })
      const hosts = renderer.root.findAll(
        (n) => n.props.testID === "route-buttons" && typeof n.type === "string",
      )
      expect(hosts).toHaveLength(1)
      expect(directionAbove(hosts[0]!)).toBe(expected)
      await unmount(renderer)
    },
  )
})

describe("the player's sheets (feat-695 R11)", () => {
  it.each([
    { layout: "right-to-left", isRTL: true, expected: "rtl" },
    { layout: "left-to-right", isRTL: false, expected: "ltr" },
  ])(
    "lay out in the app's own direction in a $layout layout",
    async ({ isRTL, expected }) => {
      layoutIs(isRTL)
      const renderer = await render()

      await press(pressableByLabel(renderer, "Settings"))
      expect(directionAbove(hostByLabel(renderer, "Dismiss settings"))).toBe(
        expected,
      )

      await press(
        pressableByLabel(renderer, "Report a problem with this video"),
      )
      await press(pressableByLabel(renderer, "Dismiss settings"))
      expect(directionAbove(hostByLabel(renderer, "Close feedback"))).toBe(
        expected,
      )
      await unmount(renderer)
    },
  )
})
