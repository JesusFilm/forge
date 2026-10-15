/**
 * VideoPlayer on Liquid Glass (feat-705 U4, U5). No glass may sit inside a
 * fading layer, so on the glass path the controls layer stops fading and hands
 * its fade to PlayerControls (KTD6). The fallback path keeps today's fade.
 * Jest cannot draw the material, so these cases pin the branch and its props.
 */

jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("@expo/vector-icons/MaterialIcons", () => ({
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
// Host stand-ins, so each surface is findable and its props readable.
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))
jest.mock("expo-blur", () => ({ BlurView: "BlurView" }))
jest.mock("expo-video", () => ({ VideoAirPlayButton: "VideoAirPlayButton" }))
// Each case pins the glass branch. The `mock` prefix lets jest hoist the name.
const mockGate = { glass: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
// One controls state per case. `renders` counts VideoPlayer's renders, because
// the player calls this hook once in each render.
const mockControls = {
  opacityAnim: null as unknown,
  visibleStore: null as unknown,
  mounted: true,
  renders: 0,
  visibleNow: true,
  // The hide and reveal calls, in order.
  calls: [] as string[],
}
jest.mock("../../../hooks/useControlsVisibility", () => ({
  ...jest.requireActual("../../../hooks/useControlsVisibility"),
  useControlsVisibility: () => {
    mockControls.renders += 1
    return {
      controlsVisible: true,
      mounted: mockControls.mounted,
      opacityAnim: mockControls.opacityAnim,
      visibleStore: mockControls.visibleStore,
      hide: () => {
        mockControls.calls.push("hide")
      },
      revealIfHidden: () => {
        mockControls.calls.push("reveal")
      },
      isVisibleNow: () => mockControls.visibleNow,
      noteInteraction: () => {},
      isPlaying: true,
    }
  },
}))
jest.mock("../../../hooks/useEndedPosterFade", () => {
  const { Animated } = jest.requireActual("react-native")
  const posterFade = new Animated.Value(1)
  return { useEndedPosterFade: () => ({ ended: false, posterFade }) }
})
jest.mock("../../../hooks/useErrorRecovery", () => ({
  useErrorRecovery: () => () => {},
}))
const mockMotion = { reduce: false }
jest.mock("../../../hooks/useReduceMotion", () => ({
  useReduceMotion: () => mockMotion.reduce,
}))
jest.mock("../PlayerLoadingVeil", () => ({ PlayerLoadingVeil: () => null }))
jest.mock("../SubtitleOverlay", () => ({ SubtitleOverlay: () => null }))
// The real route buttons, so the veil row's glass is visible to the test.
jest.mock("../PlayerControls", () => {
  const { View } = jest.requireActual("react-native")
  return {
    ...jest.requireActual("../PlayerControls"),
    PlayerControls: (props: Record<string, unknown>) => (
      <View testID="player-controls" {...{ received: props }} />
    ),
  }
})
jest.mock("../PlayerSettingsSheet", () => ({ PlayerSettingsSheet: () => null }))
jest.mock("../../feedback/FeedbackModal", () => ({ FeedbackModal: () => null }))

import { act } from "react"
import {
  Animated,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"
import type { VideoPlayer as ExpoVideoPlayer } from "expo-video"

import { VideoPlayer } from "../VideoPlayer"
import { DOUBLE_TAP_MS } from "../../../lib/tapSeek"
import {
  createControlsVisibleStore,
  type ControlsVisibleStore,
} from "../../../lib/controlsVisibility"
import {
  TestRenderer,
  pressableByLabel,
  unmount,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

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

// Unmounted after each case, so a failed case leaves no timer running.
let mounted: TestInstance | null = null

async function render({
  awaitingAutostart = false,
}: { awaitingAutostart?: boolean } = {}): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <VideoPlayer
        player={fakePlayer(!awaitingAutostart) as unknown as ExpoVideoPlayer}
        isPlaying={!awaitingAutostart}
        autostart={awaitingAutostart}
        streamingUrl="https://stream.mux.com/abc123.m3u8"
        posterUrl={null}
        feedbackContext={null}
        cast={null}
      />,
    )
  })
  mounted = renderer
  return renderer
}

function opacityOf(n: RenderedNode): unknown {
  if (typeof n.type !== "string") return undefined
  return StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>)?.opacity
}

function ancestors(node: RenderedNode): RenderedNode[] {
  const chain: RenderedNode[] = []
  for (let at = node.parent ?? null; at != null; at = at.parent ?? null) {
    chain.push(at)
  }
  return chain
}

function hostByTestId(renderer: TestInstance, testID: string): RenderedNode {
  const [node] = renderer.root.findAll(
    (n) => n.props.testID === testID && typeof n.type === "string",
  )
  if (node == null) throw new Error(`no host node with testID ${testID}`)
  return node
}

function visibleStore(): ControlsVisibleStore {
  return mockControls.visibleStore as ControlsVisibleStore
}

/** The props the host passed to PlayerControls. */
function controlsProps(renderer: TestInstance): Record<string, unknown> {
  return hostByTestId(renderer, "player-controls").props.received as Record<
    string,
    unknown
  >
}

/** The layer directly above PlayerControls, which fades it on the fallback. */
function controlsLayer(renderer: TestInstance): RenderedNode {
  const layer = ancestors(hostByTestId(renderer, "player-controls")).find(
    (n) => typeof n.type === "string",
  )
  if (layer == null) throw new Error("no controls layer")
  return layer
}

/** `count` taps at x 40 on a 300 pt wide player, inside one double-tap window. */
async function tapLeft(renderer: TestInstance, count: 1 | 2) {
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
    for (let i = 0; i < count; i += 1) {
      tap.onPressIn()
      tap.onPress({ nativeEvent: { locationX: 40 } })
    }
  })
}

/** Moves fake timers on; the cases that call it turn fake timers on. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

afterEach(async () => {
  if (mounted != null) await unmount(mounted)
  mounted = null
})

beforeEach(() => {
  mockGate.glass = true
  // Mid-fade, so a layer that applies the value shows a number that is not 1.
  mockControls.opacityAnim = new Animated.Value(0.5)
  mockControls.visibleStore = createControlsVisibleStore(true)
  mockControls.mounted = true
  mockControls.renders = 0
  mockControls.visibleNow = true
  mockControls.calls = []
  mockMotion.reduce = false
})

describe("the controls layer (feat-705 U4, KTD6)", () => {
  it("does not fade on the glass path, and hands its fade and visible value to the controls", async () => {
    const renderer = await render()

    expect(opacityOf(controlsLayer(renderer))).toBeUndefined()
    const props = controlsProps(renderer)
    expect(props.fade).toBe(mockControls.opacityAnim)
    expect(props.visibleStore).toBe(mockControls.visibleStore)
  })

  it("keeps today's fade on the fallback path, and gives the controls no fade of their own", async () => {
    mockGate.glass = false
    const renderer = await render()

    expect(opacityOf(controlsLayer(renderer))).toBe(0.5)
    expect(controlsProps(renderer).fade).toBeUndefined()
    // No glass to dissolve, so the controls do not re-render on hide start.
    expect(controlsProps(renderer).visibleStore).toBeUndefined()
  })

  // KTD5: the value changes at hide start; only its readers may re-render.
  it("does not re-render when the published visible value changes", async () => {
    await render()
    const before = mockControls.renders

    await act(async () => {
      visibleStore().set(false)
    })
    expect(mockControls.renders).toBe(before)
  })

  it("shows the veil's route-button glass while the chrome is hidden", async () => {
    visibleStore().set(false)
    const renderer = await render({ awaitingAutostart: true })

    expect(
      renderer.root.findAll((n) => n.props.testID === "player-controls"),
    ).toHaveLength(0)
    const glass = renderer.root.findAll((n) => n.type === "GlassView")
    // AirPlay: this player has no cast wiring.
    expect(glass).toHaveLength(1)
    expect(glass[0]!.props.glassEffectStyle).toMatchObject({
      style: "regular",
    })
  })
})

function pillText(renderer: TestInstance): RenderedNode {
  const [text] = renderer.root.findAll(
    (n) => n.props.children === "10s" && typeof n.type === "string",
  )
  if (text == null) throw new Error("no seek flash text")
  return text
}

/** The host view that fades the pill's icon and label. */
function pillLabelLayer(renderer: TestInstance): RenderedNode {
  const layer = ancestors(pillText(renderer)).find(
    (n) => typeof n.type === "string" && opacityOf(n) != null,
  )
  if (layer == null) throw new Error("no fading layer in the pill")
  return layer
}

function pillGlassStyle(renderer: TestInstance): Record<string, unknown> {
  const glass = ancestors(pillText(renderer)).find(
    (n) => n.type === "GlassView",
  )
  if (glass == null) throw new Error("no glass on the pill")
  return glass.props.glassEffectStyle as Record<string, unknown>
}

function hasSeekFlash(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll((n) => n.props.testID === "seek-flash").length > 0
  )
}

describe("the seek flash pill (feat-705 U5, R5)", () => {
  it("shows glass with no fading layer above it", async () => {
    const renderer = await render()
    await tapLeft(renderer, 2)

    const chain = ancestors(pillText(renderer))
    const glassAt = chain.findIndex((n) => n.type === "GlassView")
    expect(glassAt).toBeGreaterThan(-1)
    const glass = chain[glassAt]!
    expect(glass.props.glassEffectStyle).toMatchObject({ style: "regular" })
    // The fill would cover the glass.
    expect(
      StyleSheet.flatten(glass.props.style as StyleProp<ViewStyle>)
        ?.backgroundColor,
    ).toBeUndefined()
    // Only the label's own view fades, inside the glass.
    expect(chain.slice(glassAt).every((n) => opacityOf(n) == null)).toBe(true)
    expect(opacityOf(pillLabelLayer(renderer))).toBe(1)
    // It never takes a tap from the video beneath it.
    expect(hostByTestId(renderer, "seek-flash").props.pointerEvents).toBe(
      "none",
    )
  })

  it("keeps today's dark fill on the fallback path", async () => {
    mockGate.glass = false
    const renderer = await render()
    await tapLeft(renderer, 2)

    expect(renderer.root.findAll((n) => n.type === "GlassView")).toHaveLength(0)
    const filled = ancestors(pillText(renderer)).filter(
      (n) =>
        typeof n.type === "string" &&
        StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>)
          ?.backgroundColor === "rgba(0, 0, 0, 0.55)",
    )
    expect(filled).toHaveLength(1)
  })
})

type TimingCall = {
  value: unknown
  config: Animated.TimingAnimationConfig
  finish: () => void
}

describe("the seek flash pill's exit (owner, 2026-10-16)", () => {
  let timings: TimingCall[] = []

  beforeEach(() => {
    jest.useFakeTimers()
    timings = []
    // Each fade waits for its `finish`, so a case can end it at a chosen time.
    jest.spyOn(Animated, "timing").mockImplementation((value, config) => {
      let done: Animated.EndCallback | undefined
      timings.push({
        value,
        config,
        finish: () => done?.({ finished: true }),
      })
      return {
        start: (callback?: Animated.EndCallback) => {
          done = callback
        },
        stop: () => {},
        reset: () => {},
      }
    })
  })
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it("appears at full opacity, holds for 600 ms, then fades the label as the glass dissolves", async () => {
    const renderer = await render()
    await tapLeft(renderer, 2)
    expect(opacityOf(pillLabelLayer(renderer))).toBe(1)
    expect(pillGlassStyle(renderer)).toMatchObject({ style: "regular" })

    await advance(599)
    expect(timings).toHaveLength(0)
    expect(pillGlassStyle(renderer)).toMatchObject({ style: "regular" })

    await advance(1)
    expect(timings).toHaveLength(1)
    expect(timings[0]!.config).toMatchObject({ toValue: 0, duration: 250 })
    expect(pillGlassStyle(renderer)).toMatchObject({
      style: "none",
      animate: true,
      animationDuration: 0.25,
    })
    expect(hasSeekFlash(renderer)).toBe(true)

    await act(async () => timings[0]!.finish())
    expect(hasSeekFlash(renderer)).toBe(false)
  })

  it("shows a new pill at full opacity during a fade, and the old fade does not end it", async () => {
    const renderer = await render()
    await tapLeft(renderer, 2)
    await advance(600)
    const [oldFade] = timings

    await tapLeft(renderer, 2)
    expect(opacityOf(pillLabelLayer(renderer))).toBe(1)
    expect(pillGlassStyle(renderer)).toMatchObject({ style: "regular" })

    await act(async () => oldFade!.finish())
    expect(hasSeekFlash(renderer)).toBe(true)
  })

  it("leaves at once with Reduce Motion on", async () => {
    mockMotion.reduce = true
    const renderer = await render()
    await tapLeft(renderer, 2)

    await advance(600)

    expect(timings).toHaveLength(0)
    expect(hasSeekFlash(renderer)).toBe(false)
  })

  it("fades the whole pill on the fallback path", async () => {
    mockGate.glass = false
    const renderer = await render()
    await tapLeft(renderer, 2)
    expect(opacityOf(pillLabelLayer(renderer))).toBe(1)

    await advance(600)
    expect(timings).toHaveLength(1)
    await act(async () => timings[0]!.finish())
    expect(hasSeekFlash(renderer)).toBe(false)
  })
})

describe("a tap on the video (owner, 2026-10-16)", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it("seeks on a double tap over hidden chrome and keeps the chrome hidden", async () => {
    mockControls.visibleNow = false
    const renderer = await render()

    await tapLeft(renderer, 2)
    expect(hasSeekFlash(renderer)).toBe(true)
    await advance(DOUBLE_TAP_MS * 3)

    expect(mockControls.calls).toEqual([])
  })

  it("reveals hidden chrome only when the double-tap window ends", async () => {
    mockControls.visibleNow = false
    const renderer = await render()

    await tapLeft(renderer, 1)
    expect(mockControls.calls).toEqual([])
    await advance(DOUBLE_TAP_MS - 1)
    expect(mockControls.calls).toEqual([])
    await advance(1)

    expect(mockControls.calls).toEqual(["reveal"])
    expect(hasSeekFlash(renderer)).toBe(false)
  })

  it("hides visible chrome when the double-tap window ends", async () => {
    const renderer = await render()

    await tapLeft(renderer, 1)
    await advance(DOUBLE_TAP_MS)

    expect(mockControls.calls).toEqual(["hide"])
  })

  it("leaves visible chrome up on a double tap", async () => {
    const renderer = await render()

    await tapLeft(renderer, 2)
    expect(hasSeekFlash(renderer)).toBe(true)
    await advance(DOUBLE_TAP_MS * 3)

    expect(mockControls.calls).toEqual([])
  })
})
