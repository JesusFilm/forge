/**
 * Inline (portrait) vs fullscreen chrome: the volume control is gone from both,
 * and the two timestamps are one "0:00 / 2:00" pill.
 *
 * apps/mobile's tsconfig maps `react` to its .d.ts and jest-expo mirrors
 * tsconfig paths into jest's moduleNameMapper, so the mocks below re-point
 * `react` at the real package. The renderer is jest-expo's own transitive
 * react-test-renderer (KTD11: no new test dependencies).
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
// Ionicons requires native font modules at import time under jest.
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
// Same for the Cast glyph's icon set.
jest.mock("@expo/vector-icons/MaterialIcons", () => ({
  __esModule: true,
  default: () => null,
}))
// The glass and the blur backplate are native views. Host stand-ins render
// their children, so the controls stay findable and each plate is countable.
jest.mock("expo-blur", () => ({ BlurView: "BlurView" }))
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))
// Each case pins the glass branch. The `mock` prefix lets jest hoist the name.
const mockGate = { glass: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGate.glass,
}))
// PlayerControls subscribes to the player's playingChange; return the seed.
jest.mock("expo", () => ({
  useEvent: (_player: unknown, _name: string, initial: unknown) => initial,
}))
// The AirPlay button is a native AVRoutePickerView; a View keeps its
// accessibility props findable.
jest.mock("expo-video", () => {
  const { View } = require("react-native")
  return { VideoAirPlayButton: View }
})
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))

import { act } from "react"
import {
  Animated,
  I18nManager,
  Platform,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native"

import {
  PlayerControls,
  RouteButtons,
  type PlayerControlsCastUi,
  fullscreenCaptionOffset,
} from "../PlayerControls"
import type { PlaybackTarget } from "../../../lib/playbackTarget"
import {
  createControlsVisibleStore,
  type ControlsVisibleReader,
} from "../../../lib/controlsVisibility"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"
import { directionAbove } from "../../../test-utils/layoutDirection"

// A player stopped at 0:00 of a two-minute video.
function makePlayer() {
  return {
    playing: false,
    muted: false,
    currentTime: 0,
    duration: 120,
    play: jest.fn(),
    pause: jest.fn(),
    addListener: () => ({ remove: () => {} }),
  }
}

function makeCastUi(
  overrides: Partial<PlayerControlsCastUi> = {},
): PlayerControlsCastUi {
  return {
    available: true,
    connected: false,
    label: "Cast",
    onPress: jest.fn(),
    ...overrides,
  }
}

function makeCastTarget(
  overrides: Partial<PlaybackTarget> = {},
): PlaybackTarget {
  return {
    isPlaying: false,
    currentTime: 30,
    duration: 120,
    ended: false,
    held: false,
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    ...overrides,
  }
}

async function render(
  fullscreen: boolean,
  props: {
    externalPlaybackActive?: boolean
    castUi?: PlayerControlsCastUi | null
    castTarget?: PlaybackTarget | null
    onOpenSettings?: () => void
    onInteract?: () => void
    onRecover?: () => void
    isOnline?: boolean
    fade?: Animated.Value
    visibleStore?: ControlsVisibleReader
  } = {},
  player: ReturnType<typeof makePlayer> = makePlayer(),
): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <PlayerControls
        player={player as never}
        fullscreen={fullscreen}
        onFullscreen={() => {}}
        {...props}
      />,
    )
  })
  return renderer
}

// Platform.OS is an object-literal getter (configurable), so a data-property
// override works; the saved descriptor restores the real getter after each test.
const platformOsDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS")!
function setPlatform(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true })
  // Liquid Glass exists only on iOS (KTD1).
  if (os === "android") mockGate.glass = false
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
  mockGate.glass = true
})

// A Pressable and its host view both carry the label, so a present control
// matches more than one node — presence is "any", absence is "none".
function labelCount(renderer: TestInstance, label: string): number {
  return renderer.root.findAll((n) => n.props.accessibilityLabel === label)
    .length
}
function hasLabel(renderer: TestInstance, label: string): boolean {
  return labelCount(renderer, label) > 0
}

// The pill's children are an array ("0:00", " / ", "2:00"), so the shared
// hasText (string children only) cannot see it.
function hasJoinedText(renderer: TestInstance, needle: string): boolean {
  return (
    renderer.root.findAll((n) => {
      const c = n.props.children
      return Array.isArray(c) && c.every((p) => typeof p === "string")
        ? c.join("").includes(needle)
        : false
    }).length > 0
  )
}

describe("PlayerControls chrome", () => {
  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])("renders no volume control (%s)", async (_name, fullscreen) => {
    const renderer = await render(fullscreen as boolean)
    expect(labelCount(renderer, "Mute")).toBe(0)
    expect(labelCount(renderer, "Unmute")).toBe(0)
    await unmount(renderer)
  })

  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])(
    "shows one combined elapsed/total pill (%s)",
    async (_name, fullscreen) => {
      const renderer = await render(fullscreen as boolean)
      expect(hasJoinedText(renderer, "0:00 / 2:00")).toBe(true)
      // The old layout painted the total as its own node; one pill means the
      // total never stands alone.
      expect(
        renderer.root.findAll((n) => n.props.children === "2:00").length,
      ).toBe(0)
      await unmount(renderer)
    },
  )

  it("keeps the transport controls and offers fullscreen inline", async () => {
    const renderer = await render(false)
    expect(hasLabel(renderer, "Play")).toBe(true)
    expect(hasLabel(renderer, "Back 10 seconds")).toBe(true)
    expect(hasLabel(renderer, "Forward 10 seconds")).toBe(true)
    expect(hasLabel(renderer, "Fullscreen")).toBe(true)
    expect(labelCount(renderer, "Exit fullscreen")).toBe(0)
    await unmount(renderer)
  })

  it("flips the fullscreen control to an exit affordance", async () => {
    const renderer = await render(true)
    expect(hasLabel(renderer, "Exit fullscreen")).toBe(true)
    expect(labelCount(renderer, "Fullscreen")).toBe(0)
    await unmount(renderer)
  })

  it("puts the exit control ABOVE the seek bar in fullscreen", async () => {
    // Below the bar, the exit control's 44pt row pushes the seek bar up off the
    // bottom edge in landscape — the one place the bar should hug it.
    //
    // Asserted by tree ORDER, not by style: the fullscreen bottom bar is a
    // plain flex column, so "renders earlier" IS "sits higher". A style
    // assertion would keep passing with the two rows simply swapped back.
    // `findAll` walks depth-first, so one query over both nodes preserves their
    // relative position without needing to reconstruct the tree.
    const renderer = await render(true)
    const ordered = renderer.root.findAll(
      (n) =>
        n.props.accessibilityLabel === "Exit fullscreen" ||
        n.props.accessibilityRole === "adjustable",
    )
    expect(ordered.length).toBeGreaterThanOrEqual(2)
    expect(ordered[0].props.accessibilityLabel).toBe("Exit fullscreen")
    expect(
      ordered.some((n) => n.props.accessibilityRole === "adjustable"),
    ).toBe(true)
    await unmount(renderer)
  })
})

describe("AirPlay button (U1)", () => {
  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])("renders the AirPlay button on iOS (%s)", async (_name, fullscreen) => {
    const renderer = await render(fullscreen as boolean)
    expect(hasLabel(renderer, "AirPlay")).toBe(true)
    await unmount(renderer)
  })

  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])("renders no AirPlay button on Android (%s)", async (_name, fullscreen) => {
    setPlatform("android")
    const renderer = await render(fullscreen as boolean)
    expect(labelCount(renderer, "AirPlay")).toBe(0)
    expect(labelCount(renderer, "AirPlay: connected")).toBe(0)
    await unmount(renderer)
  })

  it("carries a button role like every other chrome control", async () => {
    const renderer = await render(false)
    const buttons = renderer.root.findAll(
      (n) =>
        n.props.accessibilityLabel === "AirPlay" &&
        n.props.accessibilityRole === "button",
    )
    expect(buttons.length).toBeGreaterThan(0)
    await unmount(renderer)
  })

  it("labels the active external route (state-aware label)", async () => {
    const renderer = await render(false, { externalPlaybackActive: true })
    expect(hasLabel(renderer, "AirPlay: connected")).toBe(true)
    // Exact-match count: the idle label must not linger beside the active one.
    expect(labelCount(renderer, "AirPlay")).toBe(0)
    await unmount(renderer)
  })

  it("stays present while external playback is active (controls unchanged, R5)", async () => {
    const renderer = await render(true, { externalPlaybackActive: true })
    expect(hasLabel(renderer, "Play")).toBe(true)
    expect(hasLabel(renderer, "Back 10 seconds")).toBe(true)
    expect(hasLabel(renderer, "Forward 10 seconds")).toBe(true)
    expect(hasLabel(renderer, "Exit fullscreen")).toBe(true)
    await unmount(renderer)
  })
})

describe("Cast button (U4)", () => {
  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])(
    "renders the Cast button while devices are reachable (%s)",
    async (_name, fullscreen) => {
      const renderer = await render(fullscreen as boolean, {
        castUi: makeCastUi(),
      })
      expect(hasLabel(renderer, "Cast")).toBe(true)
      await unmount(renderer)
    },
  )

  it("renders on Android too (R1 — cast is both platforms)", async () => {
    setPlatform("android")
    const renderer = await render(false, { castUi: makeCastUi() })
    expect(hasLabel(renderer, "Cast")).toBe(true)
    expect(labelCount(renderer, "AirPlay")).toBe(0)
    await unmount(renderer)
  })

  it("hides while no device is reachable (R2)", async () => {
    const renderer = await render(false, {
      castUi: makeCastUi({ available: false }),
    })
    expect(labelCount(renderer, "Cast")).toBe(0)
    await unmount(renderer)
  })

  it("does not render on surfaces without cast wiring (series dock)", async () => {
    const renderer = await render(false)
    expect(labelCount(renderer, "Cast")).toBe(0)
    await unmount(renderer)
  })

  it("opens the device dialog on press", async () => {
    const castUi = makeCastUi()
    const renderer = await render(false, { castUi })
    await press(pressableByLabel(renderer, "Cast"))
    expect(castUi.onPress).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("labels the active session (state-aware label)", async () => {
    const renderer = await render(false, {
      castUi: makeCastUi({
        connected: true,
        label: "Casting to Living Room TV",
      }),
    })
    expect(hasLabel(renderer, "Casting to Living Room TV")).toBe(true)
    // Exact-match count: the idle label must not linger beside the active one.
    expect(labelCount(renderer, "Cast")).toBe(0)
    await unmount(renderer)
  })
})

// Android cannot open its cast dialog from JS: showCastDialog() can only click a
// native MediaRouteButton that is already attached (RNGCCastContext.java:128).
// So Android renders the SDK's own button as the real control, while iOS keeps
// the app-drawn glyph because it presents the dialog from the context directly.
describe("cast control differs by platform", () => {
  // The SDK button is the only host node carrying tintColor, apart from a
  // tinted glass plate.
  function nativeButtonCount(renderer: TestInstance): number {
    return renderer.root.findAll(
      (node) =>
        typeof node.type === "string" &&
        node.type !== "GlassView" &&
        node.props.tintColor != null,
    ).length
  }

  it("Android renders the SDK button, not a Pressable glyph", async () => {
    setPlatform("android")
    const renderer = await render(false, { castUi: makeCastUi() })
    expect(nativeButtonCount(renderer)).toBe(1)
    // The native button owns its own press, so no JS handler may compete for
    // the tap — that competition is what the hidden-button design created.
    const jsPressHandlers = renderer.root.findAll(
      (n) =>
        n.props.accessibilityLabel === "Cast" &&
        typeof n.props.onPress === "function",
    )
    expect(jsPressHandlers).toHaveLength(0)
    await unmount(renderer)
  })

  it("iOS renders the app-drawn glyph and routes the press through JS", async () => {
    setPlatform("ios")
    const castUi = makeCastUi()
    const renderer = await render(false, { castUi })
    expect(nativeButtonCount(renderer)).toBe(0)
    await press(pressableByLabel(renderer, "Cast"))
    expect(castUi.onPress).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  // iOS keeps the R2 gate: presentCastDialog needs no attached button, so
  // getCastState() is trustworthy there and hiding the glyph is honest.
  it("iOS hides the control while no device is reachable (R2)", async () => {
    setPlatform("ios")
    const renderer = await render(false, {
      castUi: makeCastUi({ available: false }),
    })
    expect(labelCount(renderer, "Cast")).toBe(0)
    expect(nativeButtonCount(renderer)).toBe(0)
    await unmount(renderer)
  })

  // Galaxy Tab S8, 2026-08-24: getCastState() answered noDevicesAvailable for
  // minutes with two Chromecasts already in the app's route list. The cause is
  // unestablished; the untrustworthiness is what makes the gate wrong here.
  it("Android renders the SDK button even while `available` is false", async () => {
    setPlatform("android")
    const renderer = await render(false, {
      castUi: makeCastUi({ available: false }),
    })
    expect(nativeButtonCount(renderer)).toBe(1)
    expect(hasLabel(renderer, "Cast")).toBe(true)
    await unmount(renderer)
  })

  it("renders nothing on a surface with no cast wiring", async () => {
    setPlatform("android")
    const renderer = await render(false)
    expect(nativeButtonCount(renderer)).toBe(0)
    await unmount(renderer)
  })

  // The SDK owns the glyph on Android, so its connected artwork is the SDK's,
  // not `cast-connected`. iOS keeps the swap and the state-aware label.
  it("iOS swaps to the connected glyph and label", async () => {
    setPlatform("ios")
    const renderer = await render(false, {
      castUi: makeCastUi({
        connected: true,
        label: "Casting to Living Room TV",
      }),
    })
    expect(hasLabel(renderer, "Casting to Living Room TV")).toBe(true)
    expect(labelCount(renderer, "Cast")).toBe(0)
    await unmount(renderer)
  })
})

describe("Settings gear (U4)", () => {
  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])(
    "renders the gear in the route row on iOS (%s)",
    async (_n, fullscreen) => {
      const renderer = await render(fullscreen as boolean, {
        onOpenSettings: () => {},
      })
      expect(hasLabel(renderer, "Video settings")).toBe(true)
      await unmount(renderer)
    },
  )

  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])(
    "renders the gear in the route row on Android (%s)",
    async (_n, fullscreen) => {
      setPlatform("android")
      const renderer = await render(fullscreen as boolean, {
        onOpenSettings: () => {},
      })
      expect(hasLabel(renderer, "Video settings")).toBe(true)
      await unmount(renderer)
    },
  )

  it("opens the sheet and resets the auto-hide timer on press", async () => {
    const onOpenSettings = jest.fn()
    const onInteract = jest.fn()
    const renderer = await render(false, { onOpenSettings, onInteract })
    await press(pressableByLabel(renderer, "Video settings"))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(onInteract).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  // R12 is structural: only the watch chrome threads the callback, so a
  // surface that does not (the veil route row) renders no gear.
  it("renders no gear when the host does not thread onOpenSettings", async () => {
    const renderer = await render(false)
    expect(labelCount(renderer, "Video settings")).toBe(0)
    await unmount(renderer)
  })
})

describe("Cast remote mode (KTD4)", () => {
  it("routes pause to the cast target and never the local player", async () => {
    const player = makePlayer()
    const castTarget = makeCastTarget({ isPlaying: true })
    const renderer = await render(false, { castTarget }, player)
    await press(pressableByLabel(renderer, "Pause"))
    expect(castTarget.pause).toHaveBeenCalledTimes(1)
    expect(player.pause).not.toHaveBeenCalled()
    expect(player.play).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  // A stopped video looked identical whatever stopped it. Offline plus a failed
  // source is the one case we can name, so it gets its own indicator — and no
  // play button, because a retry cannot succeed with no connection.
  it("shows a no-connection indicator, not a play button, when offline and errored", async () => {
    const player = { ...makePlayer(), status: "error" }
    const renderer = await render(false, { isOnline: false }, player)

    const offline = renderer.root.findAll(
      (n) =>
        n.props.accessibilityLabel === "No connection. The video cannot play.",
    )
    expect(offline.length).toBeGreaterThan(0)

    const play = renderer.root.findAll(
      (n) =>
        n.props.accessibilityLabel === "Play" &&
        typeof n.props.onPress === "function",
    )
    expect(play).toHaveLength(0)
    await unmount(renderer)
  })

  // The indicator must not outlive the outage, or the viewer is stranded
  // looking at it with no way to resume.
  it("returns the play button once the connection is back, still errored", async () => {
    const player = { ...makePlayer(), status: "error" }
    const renderer = await render(false, { isOnline: true }, player)
    expect(pressableByLabel(renderer, "Play")).toBeTruthy()
    await unmount(renderer)
  })

  // A released player throws on every read. The chrome has no error boundary,
  // so an exception escaping the render unmounts the whole player surface.
  //
  // The throw is installed AFTER construction on purpose: Babel lowers object
  // spread to Object.assign, which reads a getter declared in the same literal
  // and would fire the throw in the fixture instead of in the component.
  function releaseProperty(target: object, key: string) {
    Object.defineProperty(target, key, {
      get() {
        throw new Error("released")
      },
      configurable: true,
    })
  }

  it("renders the ordinary control when the status cannot be read", async () => {
    const player = makePlayer()
    releaseProperty(player, "status")

    // Offline: a READABLE error status here shows the no-connection glyph, so
    // the ordinary control is only correct because the status is unreadable.
    const renderer = await render(false, { isOnline: false }, player)

    expect(pressableByLabel(renderer, "Play")).toBeTruthy()
    expect(hasLabel(renderer, "No connection. The video cannot play.")).toBe(
      false,
    )
    await unmount(renderer)
  })

  it("does nothing when the press finds the player released", async () => {
    const onRecover = jest.fn()
    const player = { ...makePlayer(), status: "error" }
    releaseProperty(player, "playing")
    const renderer = await render(false, { onRecover }, player)

    await press(pressableByLabel(renderer, "Play"))

    expect(onRecover).not.toHaveBeenCalled()
    expect(player.play).not.toHaveBeenCalled()
    expect(player.pause).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  // todos/024: after a dropout ExoPlayer sits in `error`, where play() is a
  // no-op — so the button silently did nothing. Recovery re-applies the source.
  it("recovers instead of calling play when the source has errored", async () => {
    const player = { ...makePlayer(), status: "error" }
    const onRecover = jest.fn()
    const renderer = await render(false, { onRecover }, player)
    await press(pressableByLabel(renderer, "Play"))
    expect(onRecover).toHaveBeenCalledTimes(1)
    expect(player.play).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("routes play to the cast target and never the local player", async () => {
    const player = makePlayer()
    const castTarget = makeCastTarget({ isPlaying: false })
    const renderer = await render(false, { castTarget }, player)
    await press(pressableByLabel(renderer, "Play"))
    expect(castTarget.play).toHaveBeenCalledTimes(1)
    expect(player.play).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("routes the skip buttons to the cast target", async () => {
    const player = makePlayer()
    const castTarget = makeCastTarget({ currentTime: 30, duration: 120 })
    const renderer = await render(false, { castTarget }, player)
    await press(pressableByLabel(renderer, "Forward 10 seconds"))
    expect(castTarget.seekTo).toHaveBeenCalledWith(40)
    expect(player.play).not.toHaveBeenCalled()
    expect(player.pause).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("shows the remote position in the time pill", async () => {
    const renderer = await render(false, {
      castTarget: makeCastTarget({ currentTime: 30, duration: 120 }),
    })
    expect(hasJoinedText(renderer, "0:30 / 2:00")).toBe(true)
    await unmount(renderer)
  })

  it("shows Replay when the receiver reports finished (target ended)", async () => {
    const castTarget = makeCastTarget({ ended: true })
    const renderer = await render(false, { castTarget })
    expect(hasLabel(renderer, "Replay")).toBe(true)
    await press(pressableByLabel(renderer, "Replay"))
    // Replay restarts the TV: back to 0, then play — on the session.
    expect(castTarget.seekTo).toHaveBeenCalledWith(0)
    expect(castTarget.play).toHaveBeenCalledTimes(1)
    await unmount(renderer)
  })

  it("holds the transport while connecting (R16)", async () => {
    const player = makePlayer()
    const castTarget = makeCastTarget({ held: true })
    const renderer = await render(false, { castTarget }, player)
    await press(pressableByLabel(renderer, "Play"))
    await press(pressableByLabel(renderer, "Forward 10 seconds"))
    expect(castTarget.play).not.toHaveBeenCalled()
    expect(castTarget.seekTo).not.toHaveBeenCalled()
    expect(player.play).not.toHaveBeenCalled()
    await unmount(renderer)
  })
})

/**
 * The caption lives in VideoPlayer while the bar it must clear lives in
 * PlayerControls, so the offset is DERIVED here rather than eyeballed there. It
 * had been a hard-coded 92, which silently assumed one device's home-indicator
 * inset and then rotted outright when the exit control moved above the bar.
 */
describe("fullscreenCaptionOffset", () => {
  it("clears the seek bar's GRAB area, not just its visible track", () => {
    // The track is 3pt but the touch target is 44pt. Clearing only the track
    // would put the caption inside the area a scrub starts from.
    expect(fullscreenCaptionOffset(0)).toBeGreaterThanOrEqual(44)
  })

  it("clears the seek bar and its row gap, and nothing above them", () => {
    // The bar stacks (from the bottom): its safe-area padding, the seek bar's
    // 44pt grab area, a 6pt gap, then the 44pt pill/exit row. The caption
    // clears the first three ONLY -- clearing the row too was rejected on the
    // shipped build as too high, and it is safe to sit in that row because the
    // overlay is pointerEvents="none".
    const PADDING_FLOOR = 8
    const SEEK_GRAB = 44
    const ROW_GAP = 6
    const throughSeekBar = PADDING_FLOOR + SEEK_GRAB + ROW_GAP

    expect(fullscreenCaptionOffset(0)).toBe(throughSeekBar)
    expect(fullscreenCaptionOffset(8)).toBe(throughSeekBar)
  })

  it("keeps that clearance on a device with a home indicator", () => {
    // A landscape iPhone reports ~21 here. The clearance above the bar must not
    // shrink just because the bar's own padding grew.
    const CLEARANCE = 44 + 6
    expect(fullscreenCaptionOffset(21)).toBe(21 + CLEARANCE)
    expect(fullscreenCaptionOffset(34)).toBe(34 + CLEARANCE)
    expect(fullscreenCaptionOffset(34) - fullscreenCaptionOffset(21)).toBe(13)
  })

  it("does NOT lift the caption over the pill and exit row", () => {
    // The inverse of the guard this file used to carry. It is pinned, not just
    // dropped, because the reviewed-and-rejected version is the tempting one:
    // without this a future 'fix' silently re-raises the caption by a row.
    const ROW_ABOVE_SEEK_BAR = 44
    const throughSeekBar = Math.max(21, 8) + 44 + 6

    expect(fullscreenCaptionOffset(21)).toBe(throughSeekBar)
    expect(fullscreenCaptionOffset(21)).toBeLessThan(
      throughSeekBar + ROW_ABOVE_SEEK_BAR,
    )
  })
})

/**
 * feat-699 U4 (R6): the eight frosted plates show Liquid Glass on iOS 26. No
 * glass may sit inside a fading layer, so the host pushes its fade down to the
 * parts (KTD6), and the published `visible` value dissolves the glass (KTD5).
 * Jest cannot draw the material, so these cases pin the branch and its props.
 */
describe("Liquid Glass plates (feat-699 U4)", () => {
  type SearchableNode = RenderedNode & {
    findAll(predicate: (node: RenderedNode) => boolean): RenderedNode[]
  }
  type GlassEffectStyle = {
    style: string
    animate: boolean
    animationDuration: number
  }

  const isGlass = (n: RenderedNode) => n.type === "GlassView"
  const isBlur = (n: RenderedNode) => n.type === "BlurView"

  function joinedText(n: RenderedNode): string | null {
    const c = n.props.children
    return Array.isArray(c) && c.every((p) => typeof p === "string")
      ? c.join("")
      : null
  }

  // What each of R6's eight controls draws on its plate. The icon mocks
  // render nothing, so a glyph is found by its icon name.
  function plateContents(
    fullscreen: boolean,
  ): [string, (n: RenderedNode) => boolean][] {
    return [
      ["Cast", (n) => n.props.name === "cast"],
      [
        "AirPlay",
        (n) =>
          typeof n.type === "string" &&
          n.props.accessibilityLabel === "AirPlay",
      ],
      ["settings", (n) => n.props.name === "settings"],
      ["play/pause", (n) => n.props.name === "play"],
      ["back 10 s", (n) => n.props.name === "play-back"],
      ["forward 10 s", (n) => n.props.name === "play-forward"],
      [
        "time label",
        (n) => typeof n.type === "string" && joinedText(n) === "0:00 / 2:00",
      ],
      [
        "fullscreen",
        (n) => n.props.name === (fullscreen ? "contract" : "expand"),
      ],
    ]
  }

  function ancestors(node: RenderedNode): RenderedNode[] {
    const chain: RenderedNode[] = []
    for (let at = node.parent ?? null; at != null; at = at.parent ?? null) {
      chain.push(at)
    }
    return chain
  }

  function first(
    renderer: TestInstance,
    match: (n: RenderedNode) => boolean,
  ): RenderedNode {
    const [node] = renderer.root.findAll(match)
    if (node == null) throw new Error("no matching node")
    return node
  }

  function opacityOf(n: RenderedNode): unknown {
    if (typeof n.type !== "string") return undefined
    return StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>)?.opacity
  }

  function glassStyles(renderer: TestInstance): GlassEffectStyle[] {
    return renderer.root
      .findAll(isGlass)
      .map((n) => n.props.glassEffectStyle as GlassEffectStyle)
  }

  // Every route button is present: Cast (a device is reachable), AirPlay
  // (iOS) and the settings gear.
  function allPlates(extra: Parameters<typeof render>[1] = {}) {
    return { castUi: makeCastUi(), onOpenSettings: () => {}, ...extra }
  }

  it.each([
    ["inline", false],
    ["fullscreen", true],
  ])(
    "draws each of the eight controls in a glass plate of its own (%s)",
    async (_name, fullscreen) => {
      const renderer = await render(fullscreen as boolean, allPlates())
      const plates = renderer.root.findAll(isGlass) as SearchableNode[]
      const contents = plateContents(fullscreen as boolean)

      expect(plates).toHaveLength(8)
      for (const [name, match] of contents) {
        const holders = plates.filter((p) => p.findAll(match).length > 0)
        expect([name, holders.length]).toEqual([name, 1])
      }
      for (const plate of plates) {
        const held = contents.filter(([, match]) => plate.findAll(match).length)
        expect(held).toHaveLength(1)
      }
      expect(renderer.root.findAll(isBlur)).toHaveLength(0)
      await unmount(renderer)
    },
  )

  it("dissolves every plate when the published value turns false, and brings it back on true", async () => {
    const store = createControlsVisibleStore(true)
    const renderer = await render(false, allPlates({ visibleStore: store }))
    expect(glassStyles(renderer)).toHaveLength(8)
    for (const style of glassStyles(renderer)) {
      expect(style.style).toBe("regular")
    }

    // KTD5: out over 0.15 s with the glyph fade, back in over 0.1 s.
    await act(async () => {
      store.set(false)
    })
    expect(glassStyles(renderer)).toHaveLength(8)
    for (const style of glassStyles(renderer)) {
      expect(style).toMatchObject({ style: "none", animationDuration: 0.15 })
    }

    await act(async () => {
      store.set(true)
    })
    for (const style of glassStyles(renderer)) {
      expect(style).toMatchObject({ style: "regular", animationDuration: 0.1 })
    }
    await unmount(renderer)
  })

  it("fades each glyph and the seek bar with the host's value, never the glass", async () => {
    const fade = new Animated.Value(0.4)
    const renderer = await render(false, allPlates({ fade }))

    for (const [name, match] of plateContents(false)) {
      const chain = ancestors(first(renderer, match))
      const glassAt = chain.findIndex(isGlass)
      expect([name, glassAt > -1]).toEqual([name, true])
      // The part inside the glass fades; the glass and its ancestors do not.
      const inside = chain.slice(0, glassAt)
      expect([name, inside.some((n) => opacityOf(n) === 0.4)]).toEqual([
        name,
        true,
      ])
      const outside = chain.slice(glassAt)
      expect([name, outside.every((n) => opacityOf(n) == null)]).toEqual([
        name,
        true,
      ])
    }

    const bar = first(
      renderer,
      (n) =>
        typeof n.type === "string" &&
        n.props.accessibilityRole === "adjustable",
    )
    expect(ancestors(bar).some((n) => opacityOf(n) === 0.4)).toBe(true)
    await unmount(renderer)
  })

  it("keeps today's frosted blur on iOS before 26, with no fade of its own", async () => {
    mockGate.glass = false
    const renderer = await render(false, allPlates())

    expect(renderer.root.findAll(isGlass)).toHaveLength(0)
    const blurs = renderer.root.findAll(isBlur)
    expect(blurs).toHaveLength(8)
    for (const blur of blurs) {
      expect(blur.props).toMatchObject({ intensity: 40, tint: "dark" })
    }
    // The host fades the whole layer on this path, so no part fades again.
    expect(renderer.root.findAll((n) => opacityOf(n) != null)).toHaveLength(0)
    await unmount(renderer)
  })

  it("keeps today's flat dim on Android", async () => {
    setPlatform("android")
    const renderer = await render(false, allPlates())

    expect(renderer.root.findAll(isGlass)).toHaveLength(0)
    expect(renderer.root.findAll(isBlur)).toHaveLength(0)
    // SURFACE_COLOR #292524 at 60%: Cast, settings, the transport row, the
    // time pill and fullscreen. Android has no AirPlay.
    const dims = renderer.root.findAll(
      (n) =>
        typeof n.type === "string" &&
        StyleSheet.flatten(n.props.style as StyleProp<ViewStyle>)
          ?.backgroundColor === "rgba(41, 37, 36, 0.6)",
    )
    expect(dims).toHaveLength(7)
    await unmount(renderer)
  })

  it.each([
    ["Cast", "player-cast"],
    ["Video settings", "player-settings"],
    ["Back 10 seconds", "player-skip-back"],
    ["Forward 10 seconds", "player-skip-forward"],
    ["Fullscreen", "player-fullscreen-enter"],
    ["Play", "player-play"],
  ])("keeps the %s tap name on glass", async (label, actionName) => {
    const renderer = await render(false, allPlates())
    expect(pressableByLabel(renderer, label).props["dd-action-name"]).toBe(
      actionName,
    )
    await unmount(renderer)
  })

  // The veil's route row passes no published value, so its glass shows.
  it("shows the route buttons' glass when no visible value is given", async () => {
    let renderer!: TestInstance
    await act(async () => {
      renderer = TestRenderer.create(<RouteButtons castUi={makeCastUi()} />)
    })
    const styles = glassStyles(renderer)
    expect(styles).toHaveLength(2)
    for (const style of styles) expect(style.style).toBe("regular")
    await unmount(renderer)
  })
})

describe("PlayerControls in a right-to-left layout (feat-695 R12, KTD7)", () => {
  beforeEach(() => {
    jest.spyOn(I18nManager, "getConstants").mockReturnValue({
      ...I18nManager.getConstants(),
      isRTL: true,
    })
    jest.replaceProperty(I18nManager, "isRTL", true)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  function hostByLabel(renderer: TestInstance, label: string): RenderedNode {
    const [node] = renderer.root.findAll(
      (n) => n.props.accessibilityLabel === label && typeof n.type === "string",
    )
    if (node == null) throw new Error(`no host node labelled ${label}`)
    return node
  }

  it("keeps skip back, play, and skip forward in a left-to-right row", async () => {
    const renderer = await render(false)
    for (const label of ["Back 10 seconds", "Play", "Forward 10 seconds"]) {
      expect(directionAbove(hostByLabel(renderer, label))).toBe("ltr")
    }
    await unmount(renderer)
  })

  // The route buttons are not playback controls, and the watch page's minimize
  // button mirrors to their corner, so they must mirror too (R11).
  it("mirrors the route buttons with the app, inline and in fullscreen", async () => {
    for (const fullscreen of [false, true]) {
      const renderer = await render(fullscreen, { onOpenSettings: () => {} })
      expect(directionAbove(hostByLabel(renderer, "Video settings"))).toBe(
        "rtl",
      )
      expect(directionAbove(hostByLabel(renderer, "Play"))).toBe("ltr")
      await unmount(renderer)
    }
  })

  it("lays out the fullscreen bar left to right, so its side insets keep their sides", async () => {
    const renderer = await render(true)
    // The seek bar is a direct child of the bar that carries the insets.
    expect(directionAbove(hostByLabel(renderer, "Seek bar"))).toBe("ltr")
    expect(directionAbove(hostByLabel(renderer, "Exit fullscreen"))).toBe("ltr")
    await unmount(renderer)
  })
})
