/**
 * R19 keeps the SDUI hero out of the mini player, but it still mounts a video
 * view of its own — so R10 makes it yield to a window that holds a live video.
 *
 * The yield is read from the store inside the component, not threaded from a
 * call site, because this hero renders in two places: `CuratedHomeLayout`
 * (which passes `paused`) and `SectionDispatcher` (which passes nothing). A
 * per-call-site prop would leave the second one holding the decoder.
 *
 * The same hero's mute glyph shows glass (R8) inside the box that
 * `CuratedHomeLayout` measures for its tap target.
 */

jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("../../ui/PlatformBlur", () => ({ PlatformBlur: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock("../../../contexts/ExperienceProvider", () => ({
  useVideoThumbnail: () => null,
}))
jest.mock("expo-video", () =>
  jest.requireActual("../../../test-utils/expoVideoMock").createExpoVideoMock(),
)
// The `mock` prefix lets babel-plugin-jest-hoist accept this name. A case
// takes the glass branch unless it turns the gate off.
const mockGlass = { on: true }
jest.mock("../../../lib/liquidGlass", () => ({
  canUseLiquidGlass: () => mockGlass.on,
}))
// A host stand-in, so a case can see where the glass draws.
jest.mock("expo-glass-effect", () => ({ GlassView: "GlassView" }))

// Live subscription, so the hero's first-frame latch flips exactly as on device.
jest.mock("expo", () => ({
  useEvent: (
    player: { addListener: (n: string, f: (p?: unknown) => void) => Sub },
    event: string,
    initial: unknown,
  ) => {
    const react = jest.requireActual("react") as {
      useState: <T>(v: T) => [T, (v: T) => void]
      useEffect: (fn: () => () => void, deps: unknown[]) => void
    }
    const [value, setValue] = react.useState(initial)
    react.useEffect(() => {
      const sub = player.addListener(event, (payload) =>
        setValue(payload as never),
      )
      return () => sub.remove()
    }, [player, event])
    return value
  },
}))

import { act, type ReactElement } from "react"
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native"

import { VideoHeroRenderer } from "../VideoHeroRenderer"
import { getMiniPlayerStore } from "../../../lib/miniPlayer/store"
import type { AdminBlock } from "../../../lib/queries"
import type { ExpoVideoMock } from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type RenderedNode,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

type Sub = { remove: () => void }

const video = jest.requireMock("expo-video") as ExpoVideoMock
const sessionStore = getMiniPlayerStore()

const WINDOW_SESSION = {
  videoId: "video-in-the-window",
  videoSlug: "video-in-the-window-slug",
  title: "Video In The Window",
}

const SECTION = {
  __typename: "VideoHeroBlock",
  heading: "A Hero",
  subheading: null,
  ctaLabel: null,
  ctaLink: null,
  streamingUrl: "https://stream.mux.com/assetAAA111.m3u8",
  sectionKey: "hero",
  videoId: "video-hero",
} as unknown as AdminBlock

function hero(paused?: boolean): ReactElement {
  return <VideoHeroRenderer section={SECTION} paused={paused} />
}

/** R10 is a MOUNT question — a paused player still owns its surface. */
function mountedVideoViews(renderer: TestInstance): number {
  return renderer.root.findAll(
    (node) =>
      (node as RenderedNode & { type?: unknown }).type === video.VideoView,
  ).length
}

function thumbnails(renderer: TestInstance): RenderedNode[] {
  return renderer.root.findAll(
    (node) => node.props.recyclingKey === "hero-thumb",
  )
}

let mounted: TestInstance | null = null

async function render(element: ReactElement): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element)
  })
  mounted = renderer
  return renderer
}

beforeEach(() => {
  video.__reset()
  // A module singleton outlives the file: a leftover session would suspend the
  // next hero before it rendered.
  sessionStore.end("abandoned")
})

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  sessionStore.end("abandoned")
  mockGlass.on = true
})

describe("VideoHeroRenderer and the one decoder", () => {
  it("plays behind no window, with its thumbnail gone once the video starts", async () => {
    const renderer = await render(hero(false))

    // Anti-vacuous: the yield below has to remove something that was there.
    expect(mountedVideoViews(renderer)).toBe(1)
    expect(video.__player.playing).toBe(true)
    expect(thumbnails(renderer)).toHaveLength(0)
  })

  it("drops its video view and goes silent while the window holds a live video", async () => {
    const renderer = await render(hero(false))

    await act(async () => {
      sessionStore.start(WINDOW_SESSION)
    })

    expect(mountedVideoViews(renderer)).toBe(0)
    expect(video.__player.playing).toBe(false)
    // R9: the hero shows its poster rather than a hole.
    expect(thumbnails(renderer).length).toBeGreaterThan(0)
  })

  it("yields with no `paused` prop — the SectionDispatcher call site", async () => {
    const renderer = await render(hero())
    expect(mountedVideoViews(renderer)).toBe(1)

    await act(async () => {
      sessionStore.start(WINDOW_SESSION)
    })

    expect(mountedVideoViews(renderer)).toBe(0)
    expect(video.__player.playing).toBe(false)
  })

  it("takes the hero back when the window's playback ENDS in place", async () => {
    const renderer = await render(hero(false))
    await act(async () => {
      sessionStore.start(WINDOW_SESSION)
    })
    expect(mountedVideoViews(renderer)).toBe(0)

    // Nobody dismisses the ended window; the hero must not stay frozen on it.
    await act(async () => {
      sessionStore.markEnded("playToEnd")
    })

    expect(mountedVideoViews(renderer)).toBe(1)
    expect(video.__player.playing).toBe(true)
  })

  it("takes the hero back only once a dismissed window has finished leaving", async () => {
    const renderer = await render(hero(false))
    await act(async () => {
      sessionStore.start(WINDOW_SESSION)
    })

    await act(async () => {
      sessionStore.requestDismiss()
    })
    expect(mountedVideoViews(renderer)).toBe(0)

    await act(async () => {
      sessionStore.reportExitComplete()
    })

    expect(mountedVideoViews(renderer)).toBe(1)
    expect(video.__player.playing).toBe(true)
  })

  it("still honours the screen's own scroll suspension", async () => {
    const renderer = await render(hero(false))
    expect(video.__player.playing).toBe(true)

    await act(async () => {
      ;(renderer as TestInstance & { update(e: ReactElement): void }).update(
        hero(true),
      )
    })

    expect(video.__player.playing).toBe(false)
  })
})

describe("VideoHeroRenderer's mute glyph (R8)", () => {
  function withMute(onMuteButtonLayout = jest.fn()): ReactElement {
    return (
      <VideoHeroRenderer
        section={SECTION}
        paused={false}
        onMuteToggle={jest.fn()}
        onMuteButtonLayout={onMuteButtonLayout}
      />
    )
  }

  /** The host node right behind the mute glyph. */
  function behindGlyph(renderer: TestInstance): RenderedNode {
    const [glyph] = renderer.root.findAll((n) => n.props.name === "volume-mute")
    let at = glyph?.parent
    while (at != null && typeof at.type !== "string") at = at.parent
    if (at == null) throw new Error("no host node behind the mute glyph")
    return at
  }

  const ownStyle = (node: RenderedNode) =>
    StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>) ?? {}

  it("draws the glyph on glass inside the measured box, and still reports that box", async () => {
    const onMuteButtonLayout = jest.fn()
    const renderer = await render(withMute(onMuteButtonLayout))

    const glass = behindGlyph(renderer)
    expect(glass.type).toBe("GlassView")
    expect(glass.props.glassEffectStyle).toMatchObject({ style: "regular" })
    expect(ownStyle(glass)).toMatchObject({ width: 48, height: 48 })
    expect(ownStyle(glass).backgroundColor).toBeUndefined()

    // The overlay's tap target copies the box that holds the glass.
    const [box] = renderer.root.findAll(
      (n) => n.props.testID === "video-hero-mute" && typeof n.type !== "string",
    )
    const [boxHost] = renderer.root.findAll(
      (n) => n.props.testID === "video-hero-mute" && typeof n.type === "string",
    )
    let above = glass.parent
    while (above != null && typeof above.type !== "string") above = above.parent
    expect(above).toBe(boxHost)

    const instance = (box as unknown as { instance: Record<string, unknown> })
      .instance
    instance.measureLayout = jest.fn(
      (_to: unknown, done: (...rect: number[]) => void) =>
        done(311, 640, 48, 48),
    )
    await act(async () => {
      ;(boxHost.props.onLayout as (e: unknown) => void)({
        nativeEvent: { layout: { x: 0, y: 0, width: 48, height: 48 } },
      })
    })
    expect(onMuteButtonLayout).toHaveBeenCalledWith(311, 640, 48, 48)
  })

  it("keeps today's dark circle where Liquid Glass is unavailable", async () => {
    mockGlass.on = false
    const renderer = await render(withMute())
    expect(ownStyle(behindGlyph(renderer))).toMatchObject({
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
    })
    expect(renderer.root.findAll((n) => n.type === "GlassView")).toHaveLength(0)
  })
})
