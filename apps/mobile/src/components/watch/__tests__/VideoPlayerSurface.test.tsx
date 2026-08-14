/**
 * The injected-player surface (U6). What matters here is the EXPAND case: a
 * surface mounting over a player that is already playing, which is what
 * happens every time the viewer taps the floating window to go full screen.
 *
 * That case has no event to wait for. The player is already playing, so it
 * emits no new `playingChange` — the only signal available at mount is the
 * player's current state. A surface that seeds its "has started" latch from a
 * bare false re-arms the autostart veil over running video and the 12s
 * watchdog becomes the only way out.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../../test-utils/expoVideoMock").expoVideoModuleMock(),
)
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  return {
    ...actual,
    useEvent: (_player: unknown, _name: string, initial: unknown) => initial,
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
jest.mock("../../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))
// The surface never calls the adapter, but it lives in the same module as the
// self-owning wrapper, whose import chain reaches AsyncStorage and SecureStore.
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

import { act } from "react"
import { Platform } from "react-native"

import { VideoPlayerSurface } from "../VideoPlayer"
import {
  makeFakePlayer,
  type FakePlayer,
} from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

const STREAM = "https://stream.test/one.m3u8"
const POSTER = "https://images.test/poster.jpg"

let live: TestInstance[] = []

async function mount(
  player: FakePlayer,
  props: Partial<{ isPlaying: boolean; autostart: boolean }> = {},
) {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(
      <VideoPlayerSurface
        streamingUrl={STREAM}
        posterUrl={POSTER}
        autostart={props.autostart ?? true}
        player={player as never}
        isPlaying={props.isPlaying ?? player.playing}
      />,
    )
  })
  live.push(renderer)
  return renderer
}

/**
 * The veil is PlayerLoadingVeil's progressbar, found by its label. A View and
 * its host node both carry the label, so presence is "any", absence is "none" —
 * counting exact nodes pins a rendering detail, not the behaviour.
 */
function hasVeil(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll(
      (node) => node.props.accessibilityLabel === "Loading video",
    ).length > 0
  )
}

function hasPoster(renderer: TestInstance): boolean {
  return (
    renderer.root.findAll(
      (node) =>
        node.props.recyclingKey === POSTER || node.props.source === POSTER,
    ).length > 0
  )
}

function videoSurfaces(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => node.props.testID === "expo-video-view",
  )
}

afterEach(async () => {
  for (const renderer of live) {
    await act(async () => {
      try {
        renderer.unmount()
      } catch {
        // already gone
      }
    })
  }
  live = []
  jest.clearAllMocks()
})

describe("VideoPlayerSurface over an already-playing player", () => {
  it("does not re-arm the autostart veil", async () => {
    const renderer = await mount(makeFakePlayer({ playing: true }))
    expect(hasVeil(renderer)).toBe(false)
  })

  it("shows the veil for a player that has NOT started", async () => {
    // The contrast case. Without it the assertion above passes for a surface
    // that never renders a veil at all, which would prove nothing.
    const renderer = await mount(makeFakePlayer({ playing: false }))
    expect(hasVeil(renderer)).toBe(true)
  })

  it("clears the veil from the PLAYER when isPlaying arrives false", async () => {
    // The case the seed exists for, and the only one that discriminates.
    //
    // When isPlaying arrives true the post-mount effect flips the latch anyway,
    // so the seed is invisible to any assertion taken after act() flushes. The
    // seed only decides the outcome when the two DISAGREE: the player is
    // playing but the flag says otherwise — a host threading isPlaying from a
    // store snapshot or a useState that begins false.
    //
    // Without the seed that mount re-arms the veil over running video, and
    // there is no event left to clear it: an already-playing player emits no
    // new playingChange. The 12-second watchdog becomes the only exit.
    const renderer = await mount(makeFakePlayer({ playing: true }), {
      isPlaying: false,
    })
    expect(hasVeil(renderer)).toBe(false)
  })

  it("does not paint the poster over running video", async () => {
    // The same latch gates the poster, so a stale flag puts a full-bleed
    // thumbnail over live frames on the surface the viewer is looking at.
    const renderer = await mount(makeFakePlayer({ playing: true }), {
      isPlaying: false,
    })
    expect(hasPoster(renderer)).toBe(false)
  })

  it("does paint the poster before playback starts", async () => {
    // Pins that the poster assertion above is about the SEED, not about a
    // poster this surface never renders.
    const renderer = await mount(makeFakePlayer({ playing: false }))
    expect(hasPoster(renderer)).toBe(true)
  })

  it("does not re-arm the veil over a player that already played and is PAUSED", async () => {
    // The commonest expand of all: pause the floating window, then tap it. The
    // player is loaded and parked past 0:00, so `playing` alone reads false and
    // seeds the veil over a video with nothing left to load.
    const renderer = await mount(
      makeFakePlayer({ playing: false, currentTime: 42 }),
    )
    expect(hasVeil(renderer)).toBe(false)
    expect(hasPoster(renderer)).toBe(false)
  })

  it("still shows the veil for a loaded player parked at 0:00", async () => {
    // The genuine never-played case, and the reason the seed cannot read
    // `status`: this player reports readyToPlay and has never run a frame.
    const renderer = await mount(
      makeFakePlayer({ playing: false, currentTime: 0, status: "readyToPlay" }),
    )
    expect(hasVeil(renderer)).toBe(true)
  })

  // NOT TESTED, deliberately: surviving a RELEASED player at mount. The seed's
  // try/catch degrades to "not started", but `useControlsVisibility(player)`
  // (VideoPlayer.tsx:257 -> useControlsVisibility.ts:183) reads `player.playing`
  // unguarded a few lines later and throws anyway. That is pre-existing and
  // out of U6's scope; a test here would assert a safety the component does
  // not have.
})

describe("VideoPlayerSurface decoder surface", () => {
  it("mounts exactly one video view", async () => {
    const renderer = await mount(makeFakePlayer({ playing: true }))
    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("borrows the injected player rather than creating one", async () => {
    const player = makeFakePlayer({ playing: true })
    const renderer = await mount(player)
    expect(videoSurfaces(renderer)[0].props.player).toBe(player)
  })

  it("opts into textureView on Android", async () => {
    // Android composites SurfaceView above every RN view, so without this the
    // controls and captions render BEHIND the video. jest cannot see native
    // compositing; this only pins that the prop is still passed.
    const original = Platform.OS
    Object.defineProperty(Platform, "OS", { value: "android", writable: true })
    try {
      const renderer = await mount(makeFakePlayer({ playing: true }))
      expect(videoSurfaces(renderer)[0].props.surfaceType).toBe("textureView")
    } finally {
      Object.defineProperty(Platform, "OS", {
        value: original,
        writable: true,
      })
    }
  })

  it("passes no surfaceType on iOS", async () => {
    const renderer = await mount(makeFakePlayer({ playing: true }))
    expect(videoSurfaces(renderer)[0].props.surfaceType).toBeUndefined()
  })
})
