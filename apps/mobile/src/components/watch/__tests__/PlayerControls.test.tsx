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
// The blur backplate is a native view; render its children so the controls it
// wraps stay findable.
jest.mock("expo-blur", () => {
  const { View } = require("react-native")
  return { BlurView: View }
})
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
import { Platform } from "react-native"

import { PlayerControls, type PlayerControlsCastUi } from "../PlayerControls"
import type { PlaybackTarget } from "../../../lib/playbackTarget"
import {
  TestRenderer,
  press,
  pressableByLabel,
  unmount,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

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
    onRecover?: () => void
    isOnline?: boolean
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
}
afterEach(() => {
  Object.defineProperty(Platform, "OS", platformOsDescriptor)
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
