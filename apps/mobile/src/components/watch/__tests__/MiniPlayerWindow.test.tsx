/**
 * The floating window (U7).
 *
 * Two layers of render here. Most cases drive `MiniPlayerWindow` directly,
 * because its behaviour is its props. The last two describe blocks mount the
 * real `PlaybackHost` around it, because the position feed and the Android
 * back handler only exist once the host is wired.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").expoVideoModuleMock(),
)
// Partial, and `useEvent` subscribes for real so the host's playing flag moves.
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  const { useEffect, useState } = require("react")
  return {
    ...actual,
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
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: View }
})
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}))
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
jest.mock("../../../lib/watchProgress/recorder", () => ({
  createProgressRecorder: jest.fn(() => ({
    flush: jest.fn(),
    onTick: jest.fn(),
  })),
}))
jest.mock("../../../lib/videoQoe", () => ({
  createVideoQoeSession: jest.fn(() => ({
    onFirstPlaying: jest.fn(() => null),
    onRebuffer: jest.fn(),
    onError: jest.fn(),
    onTimeUpdate: jest.fn(),
    finalize: jest.fn(() => null),
  })),
  shouldCountRebuffer: jest.fn(() => false),
}))
// Loud, not inert: every host render injects its own, so reaching a singleton
// is a defect in the test rather than a fallback.
jest.mock("../../../lib/miniPlayer", () => ({
  getMiniPlayerStore: () => {
    throw new Error("MiniPlayerWindow test reached the singleton store")
  },
  getMiniPlayerSheets: () => {
    throw new Error("MiniPlayerWindow test reached the singleton sheet counter")
  },
  registerSessionEnd: () => () => {},
}))

import { act } from "react"
import {
  Animated,
  BackHandler,
  Dimensions,
  PanResponder,
  Platform,
} from "react-native"
import type {
  GestureResponderEvent,
  PanResponderGestureState,
} from "react-native"

import {
  DISMISS_LABEL,
  FAILURE_LABEL,
  MINI_PLAYER_ACTION_DISMISS,
  MINI_PLAYER_ACTION_MOVE,
  MINI_PLAYER_ACTION_PLAY_PAUSE,
  MINI_PLAYER_EXPAND_TARGET,
  MINI_PLAYER_KEEPALIVE_SLOT,
  MINI_PLAYER_POSITION_FILL,
  MINI_PLAYER_POSITION_INDICATOR,
  MINI_PLAYER_POSTER,
  MINI_PLAYER_POSTER_FADE_MS,
  MINI_PLAYER_POSTER_FALLBACK,
  MINI_PLAYER_POSTER_IMAGE,
  MINI_PLAYER_REVEAL_RELEASE_MS,
  MINI_PLAYER_WINDOW_SLOT,
  MiniPlayerWindow,
  PAUSE_LABEL,
  PLAY_LABEL,
  type MiniPlayerWindowProps,
  type MiniPlayerWindowVideo,
} from "../MiniPlayerWindow"
import { PlaybackHost } from "../PlaybackHost"
import {
  DEFAULT_CORNER,
  allowedCorners,
  cornerOrigin,
  miniPlayerSize,
  snapCorner,
} from "../../../lib/miniPlayer/layout"
import { createVideoQoeSession } from "../../../lib/videoQoe"
import { createSessionEndRegistry } from "../../../lib/miniPlayer/endRegistry"
import {
  isPictureInPictureActive,
  resetPictureInPictureLatch,
  setPictureInPictureActive,
} from "../../../lib/miniPlayer/pipLatch"
import { windowHoldsSurface } from "../../../lib/miniPlayer/presentation"
import {
  createMiniPlayerStore,
  type MiniPlayerStore,
} from "../../../lib/miniPlayer/store"
import {
  createSheetCounter,
  type SheetCounter,
} from "../../../lib/miniPlayer/suppression"
import {
  makeFakePlayer,
  resetExpoVideoMock,
  type FakePlayer,
} from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const SCREEN = { width: 390, height: 844 }
const CHROME = { top: 47, bottom: 83, left: 0, right: 0 }
/** The same numbers the safe-area mock above returns. */
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 }
/** PlaybackHost's own tab bar stand-in. Read here, not imported, so a changed
 *  constant fails rather than silently agreeing with itself. */
const IOS_TAB_BAR_HEIGHT = 49
const SIZE = miniPlayerSize(SCREEN.width)
const STREAM = "https://stream.test/one.m3u8"
const POSTER = "https://images.test/poster.jpg"
const HOME_SEGMENTS = ["(tabs)", "index"] as const
const WATCH_SEGMENTS = ["watch", "[slug]"] as const

const VIDEO: MiniPlayerWindowVideo = {
  videoId: "video-1",
  videoSlug: "birth-of-jesus",
  title: "The Birth of Jesus",
  posterUrl: POSTER,
  positionSeconds: 30,
  durationSeconds: 120,
}

/** react-test-renderer instances carry a `type`; the shared type omits it. */
type AnyNode = { type?: unknown; props: Record<string, unknown> }

function findAll(
  renderer: TestInstance,
  predicate: (node: AnyNode) => boolean,
): AnyNode[] {
  return renderer.root.findAll((node) =>
    predicate(node as unknown as AnyNode),
  ) as unknown as AnyNode[]
}

/**
 * HOST nodes only. A composite element and the host it renders both carry the
 * same props, so "exactly one" is only meaningful against the host layer.
 */
function hostsWithTestID(renderer: TestInstance, testID: string): AnyNode[] {
  return findAll(
    renderer,
    (node) => typeof node.type === "string" && node.props.testID === testID,
  )
}

function windowNodes(renderer: TestInstance): AnyNode[] {
  return hostsWithTestID(renderer, MINI_PLAYER_WINDOW_SLOT)
}

function keepAliveNodes(renderer: TestInstance): AnyNode[] {
  return hostsWithTestID(renderer, MINI_PLAYER_KEEPALIVE_SLOT)
}

function videoSurfaces(renderer: TestInstance): AnyNode[] {
  return findAll(renderer, (node) => node.props.testID === "expo-video-view")
}

/** The window's own accessible root, wherever it is in the tree. */
function windowRoot(renderer: TestInstance): AnyNode {
  const nodes = windowNodes(renderer)
  expect(nodes).toHaveLength(1)
  return nodes[0]
}

/** Every pressable that names itself — the visible control set. */
function controlLabels(renderer: TestInstance): string[] {
  const labels = findAll(
    renderer,
    (node) =>
      typeof node.props.onPress === "function" &&
      typeof node.props.accessibilityLabel === "string",
  ).map((node) => node.props.accessibilityLabel as string)
  return [...new Set(labels)].sort()
}

/** A pressable by testID. The HOST node keeps the testID but not `onPress`. */
function pressableByTestID(renderer: TestInstance, testID: string): AnyNode {
  const matches = findAll(
    renderer,
    (node) =>
      node.props.testID === testID && typeof node.props.onPress === "function",
  )
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]
}

function pressableByLabel(renderer: TestInstance, label: string): AnyNode {
  const matches = findAll(
    renderer,
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )
  expect(matches.length).toBeGreaterThan(0)
  return matches[0]
}

type AnimatedNumber = { __getValue: () => number }

function isAnimatedNumber(value: unknown): value is AnimatedNumber {
  return (
    typeof value === "object" &&
    value != null &&
    typeof (value as AnimatedNumber).__getValue === "function"
  )
}

/** The window's live origin, read off the animated transform it renders. */
function windowOrigin(renderer: TestInstance): { x: number; y: number } {
  for (const node of findAll(
    renderer,
    (node) => node.props.testID === MINI_PLAYER_WINDOW_SLOT,
  )) {
    const style = node.props.style
    const entries = Array.isArray(style) ? style : [style]
    for (const entry of entries) {
      const transform = (entry as { transform?: unknown })?.transform
      if (!Array.isArray(transform)) continue
      const x = transform.find(
        (item) => (item as { translateX?: unknown }).translateX != null,
      ) as { translateX: unknown } | undefined
      const y = transform.find(
        (item) => (item as { translateY?: unknown }).translateY != null,
      ) as { translateY: unknown } | undefined
      if (isAnimatedNumber(x?.translateX) && isAnimatedNumber(y?.translateY)) {
        return {
          x: x.translateX.__getValue(),
          y: y.translateY.__getValue(),
        }
      }
    }
  }
  throw new Error("MiniPlayerWindow rendered no animated transform")
}

function posterOpacity(renderer: TestInstance): number {
  for (const node of findAll(
    renderer,
    (node) => node.props.testID === MINI_PLAYER_POSTER,
  )) {
    const entries = Array.isArray(node.props.style)
      ? node.props.style
      : [node.props.style]
    for (const entry of entries) {
      const opacity = (entry as { opacity?: unknown })?.opacity
      if (isAnimatedNumber(opacity)) return opacity.__getValue()
    }
  }
  throw new Error("MiniPlayerWindow rendered no poster layer")
}

const noopGesture = {} as GestureResponderEvent

function gesture(dx: number, dy: number): PanResponderGestureState {
  return { dx, dy } as PanResponderGestureState
}

/**
 * What a real `PanResponder.create` hands back. The stub returns jest.fn values
 * under these names so a test can prove the RENDERED root carries them — the
 * one line that makes the window draggable is a props spread, and the config
 * callbacks below are reachable whether or not that spread exists.
 */
const PAN_HANDLER_NAMES = [
  "onStartShouldSetResponder",
  "onMoveShouldSetResponder",
  "onResponderGrant",
  "onResponderMove",
  "onResponderRelease",
  "onResponderTerminate",
] as const

let live: TestInstance[] = []
let panConfig: Parameters<typeof PanResponder.create>[0]
let panHandlers: Record<string, jest.Mock>
let createSpy: jest.SpyInstance

let animatedValueCount = 0
let realAnimatedValue: typeof Animated.Value

/** How many `new Animated.Value(...)` the component built this test. */
function animatedValuesBuilt(): number {
  return animatedValueCount
}

/** Count constructions through the namespace the component reads. */
function countAnimatedValues() {
  animatedValueCount = 0
  realAnimatedValue = Animated.Value
  class CountingValue extends realAnimatedValue {
    constructor(value: number) {
      super(value)
      animatedValueCount += 1
    }
  }
  Object.defineProperty(Animated, "Value", {
    value: CountingValue,
    writable: true,
    configurable: true,
  })
}

function restoreAnimatedValues() {
  Object.defineProperty(Animated, "Value", {
    value: realAnimatedValue,
    writable: true,
    configurable: true,
  })
}

let onExpand: jest.Mock
let onDismiss: jest.Mock
let onPlayPause: jest.Mock
let onEnded: jest.Mock
let onFailure: jest.Mock

async function renderWindow(overrides: Partial<MiniPlayerWindowProps> = {}) {
  const { player: injected, ...rest } = overrides
  const player = (injected ??
    makeFakePlayer({ playing: true })) as unknown as FakePlayer
  // Defaulted from the presentation, which is what the host publishes when
  // picture-in-picture is not holding it. A test that needs the two to disagree
  // passes `holdsSurface` explicitly.
  const element = (extra: Partial<MiniPlayerWindowProps>) => {
    const presentation = extra.presentation ?? rest.presentation ?? "floating"
    return (
      <MiniPlayerWindow
        presentation={presentation}
        holdsSurface={windowHoldsSurface(presentation)}
        player={player as never}
        video={VIDEO}
        isPlaying
        screen={SCREEN}
        chrome={CHROME}
        onExpand={onExpand}
        onDismiss={onDismiss}
        onPlayPause={onPlayPause}
        onEnded={onEnded}
        onFailure={onFailure}
        {...rest}
        {...extra}
      />
    )
  }
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element({}))
  })
  live.push(renderer)
  return {
    renderer,
    player,
    /** Re-render the SAME window with changed props. */
    async update(extra: Partial<MiniPlayerWindowProps>) {
      await act(async () => {
        renderer.update(element(extra))
      })
    },
  }
}

/** Release the ONE gate through the surface's own first-frame event. */
async function firstFrame(renderer: TestInstance) {
  const surface = videoSurfaces(renderer)[0]
  await act(async () => {
    ;(surface.props.onFirstFrameRender as () => void)()
  })
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}

async function press(node: AnyNode) {
  await act(async () => {
    ;(node.props.onPress as () => void)()
  })
}

async function accessibilityAction(renderer: TestInstance, name: string) {
  const root = windowRoot(renderer)
  await act(async () => {
    ;(
      root.props.onAccessibilityAction as (event: {
        nativeEvent: { actionName: string }
      }) => void
    )({ nativeEvent: { actionName: name } })
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  resetExpoVideoMock()
  resetPictureInPictureLatch()
  live = []
  onExpand = jest.fn()
  onDismiss = jest.fn()
  onPlayPause = jest.fn()
  onEnded = jest.fn()
  onFailure = jest.fn()
  countAnimatedValues()
  panHandlers = Object.fromEntries(
    PAN_HANDLER_NAMES.map((name) => [name, jest.fn()]),
  )
  createSpy = jest.spyOn(PanResponder, "create")
  createSpy.mockImplementation((config) => {
    panConfig = config as Parameters<typeof PanResponder.create>[0]
    return { panHandlers } as unknown as ReturnType<typeof PanResponder.create>
  })
})

afterEach(async () => {
  for (const renderer of live) {
    await act(async () => {
      try {
        renderer.unmount()
      } catch {
        // Already unmounted by the test itself.
      }
    })
  }
  live = []
  createSpy.mockRestore()
  restoreAnimatedValues()
  jest.useRealTimers()
})

describe("MiniPlayerWindow accessibility", () => {
  it("exposes one accessible root with a button role, a label and a dismiss action", async () => {
    const { renderer } = await renderWindow()

    const root = windowRoot(renderer)
    expect(root.props.accessible).toBe(true)
    expect(root.props.accessibilityRole).toBe("button")
    expect(root.props.accessibilityLabel).toBe(
      "Mini player: The Birth of Jesus",
    )
    expect(root.props.accessibilityActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: MINI_PLAYER_ACTION_DISMISS }),
      ]),
    )
  })

  it("declares every action by name", async () => {
    const { renderer } = await renderWindow()

    const names = (
      windowRoot(renderer).props.accessibilityActions as { name: string }[]
    ).map((action) => action.name)
    expect(names).toEqual([
      MINI_PLAYER_ACTION_PLAY_PAUSE,
      MINI_PLAYER_ACTION_DISMISS,
      MINI_PLAYER_ACTION_MOVE,
    ])
  })

  it("sets nothing of the focus-containment shape", async () => {
    // R8: the window must not trap focus. `accessibilityViewIsModal` hides
    // every sibling from VoiceOver, which is the whole app behind it.
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    expect(
      findAll(renderer, (node) => node.props.accessibilityViewIsModal === true),
    ).toHaveLength(0)
    const root = windowRoot(renderer)
    expect(root.props.accessibilityViewIsModal).toBeUndefined()
    expect(root.props.accessibilityElementsHidden).toBeUndefined()
  })
})

describe("MiniPlayerWindow controls", () => {
  it("carries exactly play-pause and dismiss, found by label", async () => {
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    expect(controlLabels(renderer)).toEqual([DISMISS_LABEL, PAUSE_LABEL])
  })

  it("flips the play-pause label when it is pressed", async () => {
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    await press(pressableByLabel(renderer, PAUSE_LABEL))

    expect(onPlayPause).toHaveBeenCalledTimes(1)
    expect(controlLabels(renderer)).toEqual([DISMISS_LABEL, PLAY_LABEL])
  })

  it("seeds play-pause from the LIVE player, not from the isPlaying prop", async () => {
    // The discriminating case: the window mounts over a player that is already
    // running, which emits no playingChange to correct a wrong seed.
    const { renderer } = await renderWindow({
      player: makeFakePlayer({ playing: true }) as never,
      isPlaying: false,
    })
    await firstFrame(renderer)

    expect(controlLabels(renderer)).toEqual([DISMISS_LABEL, PAUSE_LABEL])
  })

  it("seeds play-pause as paused for a player that is not running", async () => {
    // The contrast case. Without it the assertion above passes for a window
    // that always renders "Pause".
    const { renderer } = await renderWindow({
      player: makeFakePlayer({ playing: false }) as never,
      isPlaying: true,
    })
    await firstFrame(renderer)

    expect(controlLabels(renderer)).toEqual([DISMISS_LABEL, PLAY_LABEL])
  })

  it("dismisses through the visible control", async () => {
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    await press(pressableByLabel(renderer, DISMISS_LABEL))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("renders a non-interactive position indicator", async () => {
    // R5: an indicator, not a scrubber. A pressable one would fight the drag.
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    const indicator = hostsWithTestID(renderer, MINI_PLAYER_POSITION_INDICATOR)
    expect(indicator).toHaveLength(1)
    expect(indicator[0].props.onPress).toBeUndefined()
    expect(indicator[0].props.pointerEvents).toBe("none")
  })
})

describe("MiniPlayerWindow reveal gate", () => {
  it("hides the chrome and the tap target until the gate releases", async () => {
    const { renderer } = await renderWindow()

    expect(controlLabels(renderer)).toEqual([])
    expect(hostsWithTestID(renderer, MINI_PLAYER_EXPAND_TARGET)).toHaveLength(0)
  })

  it("releases the gate on time even when nothing plays and nothing errors", async () => {
    // The recorded bug: "started OR errored" misses "neither". Without the
    // unconditional timer the viewer has no dismiss and no way out.
    const { renderer } = await renderWindow({
      player: makeFakePlayer({ playing: false }) as never,
    })

    await advance(MINI_PLAYER_REVEAL_RELEASE_MS)

    expect(controlLabels(renderer)).toEqual([DISMISS_LABEL, PLAY_LABEL])
    expect(hostsWithTestID(renderer, MINI_PLAYER_EXPAND_TARGET)).toHaveLength(1)
  })

  it("gates the tap target on the same predicate as the chrome", async () => {
    // One predicate for both, so the window is never a tappable-looking
    // rectangle with no controls, nor the reverse.
    const { renderer } = await renderWindow()
    expect(controlLabels(renderer)).toEqual([])
    expect(hostsWithTestID(renderer, MINI_PLAYER_EXPAND_TARGET)).toHaveLength(0)

    await firstFrame(renderer)

    expect(controlLabels(renderer)).toHaveLength(2)
    expect(hostsWithTestID(renderer, MINI_PLAYER_EXPAND_TARGET)).toHaveLength(1)
  })
})

describe("MiniPlayerWindow poster", () => {
  it("mounts the poster opaque over an ALREADY-playing player", async () => {
    // The discriminating case for R18/KTD3. The window arises from a watch
    // screen that is already running, so a gate seeded from `player.playing`
    // — the seed the full-screen surface correctly uses — would drop the
    // poster at mount and show the bare surface the spike proved can be dead.
    const { renderer } = await renderWindow({
      player: makeFakePlayer({ playing: true, currentTime: 42 }) as never,
    })
    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER_IMAGE)).toHaveLength(1)
    expect(posterOpacity(renderer)).toBe(1)

    // Still opaque a whole fade later: the poster waits for THIS surface's
    // first frame, not for the player that was already running before it.
    await advance(MINI_PLAYER_POSTER_FADE_MS * 2)

    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER_IMAGE)).toHaveLength(1)
    expect(posterOpacity(renderer)).toBe(1)
  })

  it("hands the video's own poster to the image", async () => {
    // Nothing else reads the source: with the two branches sharing one testID,
    // a constant null drew an opaque BLACK rectangle over every window and the
    // whole suite stayed green.
    const { renderer } = await renderWindow()

    const image = hostsWithTestID(renderer, MINI_PLAYER_POSTER_IMAGE)
    expect(image).toHaveLength(1)
    expect(image[0].props.source).toBe(POSTER)
    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER_FALLBACK)).toHaveLength(
      0,
    )
  })

  it("falls back to the opaque rectangle when the video has no poster", async () => {
    const { renderer } = await renderWindow({
      video: { ...VIDEO, posterUrl: null },
    })

    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER_IMAGE)).toHaveLength(0)
    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER_FALLBACK)).toHaveLength(
      1,
    )
  })

  it("falls back for a poster url the resolver rejects", async () => {
    // Pins that the url goes through resolveImageUrl rather than straight from
    // the session, which is CMS-sourced and unvalidated.
    const { renderer } = await renderWindow({
      video: { ...VIDEO, posterUrl: "javascript:alert(1)" },
    })

    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER_IMAGE)).toHaveLength(0)
    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER_FALLBACK)).toHaveLength(
      1,
    )
  })

  it("keeps the poster mounted until the fade completes", async () => {
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    await advance(MINI_PLAYER_POSTER_FADE_MS / 2)
    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER)).toHaveLength(1)

    await advance(MINI_PLAYER_POSTER_FADE_MS)
    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER)).toHaveLength(0)
  })
})

describe("MiniPlayerWindow drag", () => {
  it("claims a drag and rejects a tap", async () => {
    await renderWindow()

    expect(
      panConfig.onStartShouldSetPanResponder?.(noopGesture, gesture(0, 0)),
    ).toBe(false)
    expect(
      panConfig.onMoveShouldSetPanResponder?.(noopGesture, gesture(2, 1)),
    ).toBe(false)
    expect(
      panConfig.onMoveShouldSetPanResponder?.(noopGesture, gesture(40, 3)),
    ).toBe(true)
  })

  it("commits a release to the corner layout.ts snaps to", async () => {
    const { renderer } = await renderWindow()
    const start = cornerOrigin("bottomRight", SCREEN, SIZE, CHROME)
    const dx = -260
    const dy = -560
    const expected = snapCorner(
      { x: start.x + dx, y: start.y + dy },
      SCREEN,
      SIZE,
      CHROME,
    )
    expect(expected).toBe("topLeft")

    await act(async () => {
      panConfig.onPanResponderGrant?.(noopGesture, gesture(0, 0))
      panConfig.onPanResponderMove?.(noopGesture, gesture(dx, dy))
      panConfig.onPanResponderRelease?.(noopGesture, gesture(dx, dy))
    })
    await advance(400)

    expect(windowOrigin(renderer)).toEqual(
      cornerOrigin(expected, SCREEN, SIZE, CHROME),
    )
  })

  it("tracks the finger while the drag is live", async () => {
    // The anti-vacuous companion: a window that ignored every move would still
    // land on a corner above, because the release recomputes from scratch.
    const { renderer } = await renderWindow()
    const start = cornerOrigin("bottomRight", SCREEN, SIZE, CHROME)

    await act(async () => {
      panConfig.onPanResponderGrant?.(noopGesture, gesture(0, 0))
      panConfig.onPanResponderMove?.(noopGesture, gesture(-30, -40))
    })

    expect(windowOrigin(renderer)).toEqual({
      x: start.x - 30,
      y: start.y - 40,
    })
  })
})

describe("MiniPlayerWindow root wiring", () => {
  it("spreads the pan handlers onto the floating root", async () => {
    // The view boundary. Deleting the one spread that makes the window
    // draggable leaves every behavioural drag case above green, because they
    // call the captured config directly.
    const { renderer } = await renderWindow()

    const root = windowRoot(renderer)
    for (const name of PAN_HANDLER_NAMES) {
      expect(root.props[name]).toBe(panHandlers[name])
    }
  })

  it("spreads no pan handler onto the suppressed root", async () => {
    // The 1x1 keep-alive slot takes no touches at all, so a responder there
    // would claim gestures for an invisible view.
    const { renderer } = await renderWindow({ presentation: "hidden" })

    const root = keepAliveNodes(renderer)[0]
    for (const name of PAN_HANDLER_NAMES) {
      expect(root.props[name]).toBeUndefined()
    }
  })

  it("lets touches through to its children while floating", async () => {
    // `box-none` is the whole window's touch contract: the container itself
    // takes nothing, its controls and expand target take everything. A bare
    // "none" renders a window that plays and accepts no touch at all.
    const { renderer } = await renderWindow()

    expect(windowRoot(renderer).props.pointerEvents).toBe("box-none")
  })

  it("takes no touch at all while suppressed", async () => {
    const { renderer } = await renderWindow({ presentation: "hidden" })

    expect(keepAliveNodes(renderer)[0].props.pointerEvents).toBe("none")
  })

  it("builds the responder and the poster opacity once per session", async () => {
    // Both are `useRef(expression)`, whose argument runs on EVERY render. The
    // host re-renders this window once a second for the position indicator.
    const { renderer } = await renderWindow()
    const built = animatedValuesBuilt()

    await accessibilityAction(renderer, MINI_PLAYER_ACTION_MOVE)
    await advance(400)
    await firstFrame(renderer)

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(animatedValuesBuilt()).toBe(built)
  })
})

describe("MiniPlayerWindow geometry changes", () => {
  it("re-insets the window when the chrome grows under it", async () => {
    // A tab bar appearing, a sheet opening, a rotation: the window must move
    // out of the new chrome, and that reposition is instant, not animated.
    const { renderer, update } = await renderWindow()
    const taller = { ...CHROME, bottom: CHROME.bottom + 120 }

    await update({ chrome: taller })

    expect(windowOrigin(renderer)).toEqual(
      cornerOrigin(DEFAULT_CORNER, SCREEN, SIZE, taller),
    )
  })

  it("re-picks an allowed corner when the viewer's corner loses clearance", async () => {
    const { renderer, update } = await renderWindow()
    await firstFrame(renderer)
    const allowed = allowedCorners(SCREEN, SIZE, CHROME)
    const moved =
      allowed[(allowed.indexOf(DEFAULT_CORNER) + 1) % allowed.length]
    await accessibilityAction(renderer, MINI_PLAYER_ACTION_MOVE)
    await advance(400)
    expect(windowOrigin(renderer)).toEqual(
      cornerOrigin(moved, SCREEN, SIZE, CHROME),
    )

    // Too short for the window: no corner clears the chrome, so the layout
    // falls back to the default one and the corner the viewer chose is gone.
    const short = { width: SCREEN.width, height: 120 }
    await update({ screen: short })

    expect(allowedCorners(short, SIZE, CHROME)).toEqual([DEFAULT_CORNER])
    expect(windowOrigin(renderer)).toEqual(
      cornerOrigin(DEFAULT_CORNER, short, SIZE, CHROME),
    )
  })
})

describe("MiniPlayerWindow accessibility actions", () => {
  it("play-pause acts exactly like the visible control", async () => {
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    await accessibilityAction(renderer, MINI_PLAYER_ACTION_PLAY_PAUSE)

    expect(onPlayPause).toHaveBeenCalledTimes(1)
    expect(controlLabels(renderer)).toEqual([DISMISS_LABEL, PLAY_LABEL])
  })

  it("dismiss acts exactly like the visible control", async () => {
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    await accessibilityAction(renderer, MINI_PLAYER_ACTION_DISMISS)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("ignores an action name the window never declared", async () => {
    // The default branch used to expand. Any action the platform or a future
    // caller invents would then navigate the viewer off the screen they are on.
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    await accessibilityAction(renderer, "someActionWeNeverDeclared")

    expect(onExpand).not.toHaveBeenCalled()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(onPlayPause).not.toHaveBeenCalled()
  })

  it("move-to-corner commits the same way a drag release does", async () => {
    const { renderer } = await renderWindow()
    await firstFrame(renderer)
    const allowed = allowedCorners(SCREEN, SIZE, CHROME)
    const next = allowed[(allowed.indexOf("bottomRight") + 1) % allowed.length]

    await accessibilityAction(renderer, MINI_PLAYER_ACTION_MOVE)
    await advance(400)

    expect(windowOrigin(renderer)).toEqual(
      cornerOrigin(next, SCREEN, SIZE, CHROME),
    )
  })
})

describe("MiniPlayerWindow expand", () => {
  it("calls the injected navigate callback with the current video", async () => {
    const { renderer } = await renderWindow()
    await firstFrame(renderer)

    await press(pressableByTestID(renderer, MINI_PLAYER_EXPAND_TARGET))

    expect(onExpand).toHaveBeenCalledWith(VIDEO)
  })
})

describe("MiniPlayerWindow presentation", () => {
  it("renders no window node while suppressed, and keeps the surface", async () => {
    const { renderer } = await renderWindow({ presentation: "hidden" })

    expect(windowNodes(renderer)).toHaveLength(0)
    expect(keepAliveNodes(renderer)).toHaveLength(1)
    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("renders nothing at all on the watch route", async () => {
    // The watch screen mounts its OWN surface on its OWN player. A keep-alive
    // surface here is a second surface for the same video, which is what the
    // expand flow turns into two decoders and two audio streams.
    const { renderer } = await renderWindow({ presentation: "full" })

    expect(windowNodes(renderer)).toHaveLength(0)
    expect(keepAliveNodes(renderer)).toHaveLength(0)
    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("renders nothing at all with no session", async () => {
    const { renderer } = await renderWindow({ presentation: "none" })

    expect(windowNodes(renderer)).toHaveLength(0)
    expect(keepAliveNodes(renderer)).toHaveLength(0)
    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("mounts exactly one video surface in every presentation it renders", async () => {
    // Both halves of the keep-alive rule at once: the surface survives a
    // suppression, and it is never doubled.
    for (const presentation of ["floating", "hidden"] as const) {
      const { renderer } = await renderWindow({ presentation })
      expect(videoSurfaces(renderer)).toHaveLength(1)
    }
  })

  it("never puts pointerEvents on the video view itself", async () => {
    const { renderer } = await renderWindow()

    expect(videoSurfaces(renderer)[0].props.pointerEvents).toBeUndefined()
  })

  it("keeps the platform's own controls off the surface", async () => {
    // Both default the wrong way for this window. Native controls would eat the
    // taps the expand target needs, and iOS 16+ defaults frame analysis TRUE,
    // which floats a Live Text scan button over any frame with text in it.
    const { renderer } = await renderWindow()

    const surface = videoSurfaces(renderer)[0]
    expect(surface.props.nativeControls).toBe(false)
    expect(surface.props.allowsVideoFrameAnalysis).toBe(false)
  })
})

describe("MiniPlayerWindow Android compositing", () => {
  it("opts the surface into textureView on Android", async () => {
    const original = Platform.OS
    Object.defineProperty(Platform, "OS", { value: "android", writable: true })
    try {
      const { renderer } = await renderWindow()

      expect(videoSurfaces(renderer)[0].props.surfaceType).toBe("textureView")
    } finally {
      Object.defineProperty(Platform, "OS", { value: original, writable: true })
    }
  })

  it("passes no surfaceType on iOS", async () => {
    const { renderer } = await renderWindow()

    expect(videoSurfaces(renderer)[0].props.surfaceType).toBeUndefined()
  })

  it("carries the shared picture-in-picture wiring (AE5)", async () => {
    // Without this the viewer can only reach the operating system's window
    // from the full-screen view, and AE5 leaves the app FROM the window.
    const { renderer } = await renderWindow()

    const surface = videoSurfaces(renderer)[0]
    expect(surface.props.allowsPictureInPicture).toBe(true)
    expect(surface.props.startsPictureInPictureAutomatically).toBe(true)
  })

  it("feeds the latch from its own view callbacks", async () => {
    const { renderer } = await renderWindow()
    const surface = videoSurfaces(renderer)[0]

    await act(async () => {
      ;(surface.props.onPictureInPictureStart as () => void)()
    })
    expect(isPictureInPictureActive()).toBe(true)

    await act(async () => {
      ;(surface.props.onPictureInPictureStop as () => void)()
    })
    expect(isPictureInPictureActive()).toBe(false)
  })
})

describe("MiniPlayerWindow lifecycle edges", () => {
  it("releases the video surface when playback ends (R21)", async () => {
    const { renderer, player } = await renderWindow()
    await firstFrame(renderer)
    expect(videoSurfaces(renderer)).toHaveLength(1)

    await act(async () => {
      player.emit("playToEnd")
    })

    expect(videoSurfaces(renderer)).toHaveLength(0)
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it("keeps the surface at the end of playback during picture-in-picture (R24)", async () => {
    // R21's release IS an unmount, and expo-video does not guard the
    // unregister that follows it while the operating system's window holds
    // this view.
    const { renderer, player } = await renderWindow()
    await firstFrame(renderer)
    await act(async () => {
      setPictureInPictureActive(true)
    })

    await act(async () => {
      player.emit("playToEnd")
    })

    expect(videoSurfaces(renderer)).toHaveLength(1)
    // Held VIEWS, never held bookkeeping: the session still closes as ended.
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it("releases that surface once picture-in-picture stops", async () => {
    const { renderer, player } = await renderWindow()
    await firstFrame(renderer)
    await act(async () => {
      setPictureInPictureActive(true)
    })
    await act(async () => {
      player.emit("playToEnd")
    })
    expect(videoSurfaces(renderer)).toHaveLength(1)

    await act(async () => {
      setPictureInPictureActive(false)
    })

    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("shows the poster again when playback ends", async () => {
    const { renderer, player } = await renderWindow()
    await firstFrame(renderer)
    await advance(MINI_PLAYER_POSTER_FADE_MS * 2)
    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER)).toHaveLength(0)

    await act(async () => {
      player.emit("playToEnd")
    })

    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER)).toHaveLength(1)
  })

  it("keeps the surface UNDER the poster on an unrecoverable failure (R22)", async () => {
    // R22 keeps the session alive so the failure UI stays operable, so this is
    // a live player. Dropping its view leaves it playing surfaceless, which is
    // permanently video-dead on Android — the poster hides the dead frame
    // instead.
    const { renderer, player } = await renderWindow()
    await firstFrame(renderer)

    await act(async () => {
      player.emit("statusChange", { status: "error" })
    })

    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(hostsWithTestID(renderer, MINI_PLAYER_POSTER)).toHaveLength(1)
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it("shows the failure label and keeps dismiss and expand operable", async () => {
    const { renderer, player } = await renderWindow()

    await act(async () => {
      player.emit("statusChange", { status: "error" })
    })

    expect(
      findAll(renderer, (node) => node.props.children === FAILURE_LABEL),
    ).not.toHaveLength(0)
    await press(pressableByLabel(renderer, DISMISS_LABEL))
    await press(pressableByTestID(renderer, MINI_PLAYER_EXPAND_TARGET))

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(onExpand).toHaveBeenCalledWith(VIDEO)
  })

  it("clears the failure when the player reports a good status again", async () => {
    // A latch here outlives the fault: a source swap recovers the player, and
    // the window would keep the failure label up with no surface behind it for
    // the rest of the session.
    const { renderer, player } = await renderWindow()
    await act(async () => {
      player.emit("statusChange", { status: "error" })
    })
    expect(
      findAll(renderer, (node) => node.props.children === FAILURE_LABEL),
    ).not.toHaveLength(0)

    await act(async () => {
      player.emit("statusChange", { status: "readyToPlay" })
    })

    // Never dropped, so the recovered stream paints into the view it always
    // had rather than into a fresh one attached to an already-playing player.
    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(
      findAll(renderer, (node) => node.props.children === FAILURE_LABEL),
    ).toHaveLength(0)
  })

  it("re-seeds the failure state when the host swaps the player", async () => {
    // A new player emits no statusChange for a status it already holds, so the
    // window would stay failed over a healthy replacement for good.
    const { renderer, update } = await renderWindow({
      player: makeFakePlayer({ status: "error" }) as never,
    })
    expect(
      findAll(renderer, (node) => node.props.children === FAILURE_LABEL),
    ).not.toHaveLength(0)

    await update({
      player: makeFakePlayer({ status: "readyToPlay" }) as never,
    })

    expect(
      findAll(renderer, (node) => node.props.children === FAILURE_LABEL),
    ).toHaveLength(0)
  })

  it("seeds the failure from a player that already errored", async () => {
    // The listener alone never sees a status the player reached before this
    // window mounted over it.
    const { renderer } = await renderWindow({
      player: makeFakePlayer({ status: "error" }) as never,
    })

    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(
      findAll(renderer, (node) => node.props.children === FAILURE_LABEL),
    ).not.toHaveLength(0)
  })
})

// ── Wired into the host ─────────────────────────────────────────────────────

describe("MiniPlayerWindow inside PlaybackHost", () => {
  let sheets: SheetCounter
  let registry: ReturnType<typeof createSessionEndRegistry>
  let canGoBack: jest.Mock
  let navigateToVideo: jest.Mock
  let backHandlers: (() => boolean)[]
  let backSpy: jest.SpyInstance

  function makeStore(): MiniPlayerStore {
    return createMiniPlayerStore({
      getSubjectId: () => "account-1",
      subscribeToSubject: () => () => {},
      onEnd: (_session, reason) => registry.end(reason),
    })
  }

  async function mountHost(
    store: MiniPlayerStore,
    segments: readonly string[] = HOME_SEGMENTS,
  ) {
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(
        <PlaybackHost
          store={store}
          sheets={sheets}
          registerEnd={registry.register}
          useRouteSegments={() => segments}
          canGoBack={canGoBack}
          navigateToVideo={navigateToVideo}
        />,
      )
    })
    live.push(renderer)
    return renderer
  }

  /** The player the host created for the live session. */
  function hostPlayer(renderer: TestInstance): FakePlayer {
    const surface = videoSurfaces(renderer)[0]
    return surface.props.player as FakePlayer
  }

  function qoeSessions(): { finalize: jest.Mock }[] {
    return (createVideoQoeSession as unknown as jest.Mock).mock.results.map(
      (result) => result.value as { finalize: jest.Mock },
    )
  }

  function indicatorWidth(renderer: TestInstance): string | undefined {
    const fill = hostsWithTestID(renderer, MINI_PLAYER_POSITION_FILL)[0]
    const entries = Array.isArray(fill.props.style)
      ? fill.props.style
      : [fill.props.style]
    for (const entry of entries) {
      const width = (entry as { width?: unknown })?.width
      if (typeof width === "string") return width
    }
    return undefined
  }

  beforeEach(() => {
    sheets = createSheetCounter()
    registry = createSessionEndRegistry()
    canGoBack = jest.fn(() => false)
    navigateToVideo = jest.fn()
    backHandlers = []
    backSpy = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((event, handler) => {
        // Filtered on the event NAME: a handler registered under any other
        // name never reaches the Android back button.
        if (event === "hardwareBackPress") {
          backHandlers.push(handler as () => boolean)
        }
        return {
          remove: () => {
            backHandlers = backHandlers.filter((h) => h !== handler)
          },
        }
      })
    // The window's own PanResponder is not under test here.
    createSpy.mockRestore()
  })

  afterEach(() => {
    backSpy.mockRestore()
  })

  it("insets the window inside the safe area AND the tab bar", async () => {
    // The seam the window itself cannot see: the host reads the live screen
    // and builds the chrome. Zeroing either leaves every window-level case
    // green and parks the real window half under the tab bar.
    const store = makeStore()
    const renderer = await mountHost(store, HOME_SEGMENTS)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: STREAM })
    })

    const screen = Dimensions.get("window")
    expect(windowOrigin(renderer)).toEqual(
      cornerOrigin(DEFAULT_CORNER, screen, miniPlayerSize(screen.width), {
        top: INSETS.top,
        bottom: INSETS.bottom + IOS_TAB_BAR_HEIGHT,
        left: INSETS.left,
        right: INSETS.right,
      }),
    )
  })

  it("adds no tab bar height on a route that has none", async () => {
    // The contrast case. Without it the assertion above also passes for a host
    // that adds the tab bar unconditionally.
    const store = makeStore()
    const renderer = await mountHost(store, ["series", "[slug]"])
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: STREAM })
    })

    const screen = Dimensions.get("window")
    expect(windowOrigin(renderer)).toEqual(
      cornerOrigin(
        DEFAULT_CORNER,
        screen,
        miniPlayerSize(screen.width),
        INSETS,
      ),
    )
  })

  it("updates the position indicator from the store on the one-second poll", async () => {
    const store = makeStore()
    const renderer = await mountHost(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: STREAM })
    })
    await firstFrame(renderer)
    expect(indicatorWidth(renderer)).toBe("0%")

    const player = hostPlayer(renderer)
    player.playing = true
    await act(async () => {
      player.emit("playingChange", { isPlaying: true })
    })
    player.currentTime = 30
    player.duration = 120
    await advance(1000)

    expect(store.getSnapshot()).toMatchObject({ positionSeconds: 30 })
    expect(indicatorWidth(renderer)).toBe("25%")
  })

  it("claims the Android back press at a tab root and dismisses", async () => {
    const store = makeStore()
    await mountHost(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: STREAM })
    })

    expect(backHandlers).toHaveLength(1)
    let handled = false
    await act(async () => {
      handled = backHandlers[0]()
    })

    expect(handled).toBe(true)
    expect(store.getSnapshot()).toBeNull()
  })

  it("does not claim the press when the navigator can go back", async () => {
    // R23 is deliberately narrow: anywhere back has somewhere to go, it goes.
    canGoBack.mockReturnValue(true)
    const store = makeStore()
    await mountHost(store, WATCH_SEGMENTS)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: STREAM })
    })

    let handled = true
    await act(async () => {
      handled = backHandlers[0]()
    })

    expect(handled).toBe(false)
    expect(store.getSnapshot()).not.toBeNull()
  })

  it("registers no back handler with no active session", async () => {
    await mountHost(makeStore())

    expect(backHandlers).toHaveLength(0)
  })

  it("releases the back handler when the session ends", async () => {
    const store = makeStore()
    await mountHost(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: STREAM })
    })
    expect(backHandlers).toHaveLength(1)

    await act(async () => {
      store.end("dismissed")
    })

    expect(backHandlers).toHaveLength(0)
  })

  it("closes the quality session as failed without removing the window (R22)", async () => {
    // The two halves R22 asks for at once: the quality session closes with a
    // failure reason, and the window stays operable. Ending the mini player
    // session instead would unmount the only dismiss the viewer has left.
    const store = makeStore()
    const renderer = await mountHost(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: STREAM })
    })
    const player = hostPlayer(renderer)

    await act(async () => {
      player.emit("statusChange", { status: "error" })
    })

    expect(qoeSessions()[0].finalize).toHaveBeenCalledWith("failed")
    expect(store.getSnapshot()).not.toBeNull()
    expect(windowNodes(renderer)).toHaveLength(1)
  })

  it("closes the session as ended when playback finishes (R21/AE11)", async () => {
    const store = makeStore()
    const renderer = await mountHost(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: STREAM })
    })
    const player = hostPlayer(renderer)

    await act(async () => {
      player.emit("playToEnd")
    })

    expect(qoeSessions()[0].finalize).toHaveBeenCalledWith("ended")
    expect(store.getSnapshot()).toBeNull()
    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("drives the borrowed player from the play-pause control", async () => {
    const store = makeStore()
    const renderer = await mountHost(store)
    await act(async () => {
      store.start({ videoId: "video-1", streamingUrl: STREAM })
    })
    const player = hostPlayer(renderer)
    await firstFrame(renderer)
    player.playing = true
    await act(async () => {
      player.emit("playingChange", { isPlaying: true })
    })

    await press(pressableByLabel(renderer, PAUSE_LABEL))
    expect(player.pause).toHaveBeenCalledTimes(1)

    player.playing = false
    await act(async () => {
      player.emit("playingChange", { isPlaying: false })
    })

    await press(pressableByLabel(renderer, PLAY_LABEL))
    expect(player.play).toHaveBeenCalledTimes(1)
  })

  it("expands to the video the session is playing", async () => {
    const store = makeStore()
    const renderer = await mountHost(store)
    await act(async () => {
      store.start({
        videoId: "video-1",
        videoSlug: "birth-of-jesus",
        streamingUrl: STREAM,
      })
    })
    await firstFrame(renderer)

    await press(pressableByTestID(renderer, MINI_PLAYER_EXPAND_TARGET))

    expect(navigateToVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: "video-1",
        videoSlug: "birth-of-jesus",
      }),
    )
  })
})
