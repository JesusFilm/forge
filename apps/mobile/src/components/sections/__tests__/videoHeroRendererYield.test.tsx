/**
 * R19 keeps the SDUI hero out of the mini player, but it still mounts a video
 * view of its own — so R10 makes it yield to a window that holds a live video.
 *
 * The yield is read from the store inside the component, not threaded from a
 * call site, because this hero renders in two places: `CuratedHomeLayout`
 * (which passes `paused`) and `SectionDispatcher` (which passes nothing). A
 * per-call-site prop would leave the second one holding the decoder.
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
