/**
 * The SDUI hero yields the decoder too (U8, R9/R10).
 *
 * R19 keeps this hero OUT of the mini player, which is exactly why it is easy
 * to forget: it can never become the floating window, but it still holds a
 * video surface while the window plays over it.
 *
 * The real `useMiniPlayerActive` runs here over an injected store, so the
 * subscription itself is under test rather than stubbed away.
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
jest.mock("expo-image", () => {
  const { View } = require("react-native")
  return { Image: View }
})
jest.mock("expo-linear-gradient", () => {
  const { View } = require("react-native")
  return { LinearGradient: View }
})
jest.mock("expo-blur", () => {
  const { View } = require("react-native")
  return { BlurView: View }
})
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../../contexts/ExperienceProvider", () => ({
  useVideoThumbnail: () => "https://images.test/hero.jpg",
}))
jest.mock("../../../lib/blockVideoDub", () => ({
  blockStreamingUrl: () => "https://stream.mux.com/abc123.m3u8",
}))
jest.mock("../../../lib/miniPlayer", () => ({
  getMiniPlayerStore: () => mockMiniPlayerStore,
  getMiniPlayerSheets: () => {
    throw new Error("videoHeroDecoder test reached the singleton sheet counter")
  },
  registerSessionEnd: () => () => {},
}))

import { act } from "react"

import { VideoHeroRenderer } from "../VideoHeroRenderer"
import {
  createMiniPlayerStore,
  type MiniPlayerStore,
} from "../../../lib/miniPlayer/store"
import type { AdminBlock } from "../../../lib/queries"
import {
  lastFakePlayer,
  resetExpoVideoMock,
} from "../../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../../test-utils/rnTestRenderer"

let mockMiniPlayerStore: MiniPlayerStore

const SECTION = {
  __typename: "VideoHeroBlock",
  heading: "Watch the film",
  subheading: null,
  ctaLabel: null,
  ctaLink: null,
  sectionKey: "hero",
  videoId: "video-1",
} as unknown as AdminBlock

let live: TestInstance[] = []

function videoSurfaces(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => node.props.testID === "expo-video-view",
  )
}

async function mount() {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<VideoHeroRenderer section={SECTION} />)
  })
  live.push(renderer)
  return renderer
}

async function startSession() {
  await act(async () => {
    mockMiniPlayerStore.start({
      videoSlug: "birth-of-jesus",
      streamingUrl: "https://stream.test/mini.m3u8",
    })
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  resetExpoVideoMock()
  live = []
  mockMiniPlayerStore = createMiniPlayerStore({
    getSubjectId: () => "account-1",
    subscribeToSubject: () => () => {},
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
  mockMiniPlayerStore.destroy()
})

describe("the SDUI hero and the one decoder", () => {
  it("mounts its video view when no session holds playback", async () => {
    const renderer = await mount()

    expect(videoSurfaces(renderer)).toHaveLength(1)
  })

  it("unmounts the video view while a session holds playback", async () => {
    const renderer = await mount()

    await startSession()

    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("still paints its poster while suppressed", async () => {
    // Dropping the surface without the poster leaves a hero-sized hole, which
    // reads as a broken page rather than as deference.
    const renderer = await mount()

    await startSession()

    const posters = renderer.root.findAll(
      (node) => node.props.recyclingKey === "hero-img",
    )
    expect(posters.length).toBeGreaterThan(0)
  })

  it("pauses the transport as well as dropping the surface", async () => {
    const renderer = await mount()
    const player = lastFakePlayer()
    player.pause.mockClear()

    await startSession()

    expect(player.pause).toHaveBeenCalled()
    expect(videoSurfaces(renderer)).toHaveLength(0)
  })

  it("comes back when the session ends", async () => {
    const renderer = await mount()
    await startSession()

    await act(async () => {
      mockMiniPlayerStore.end("dismissed")
    })

    expect(videoSurfaces(renderer)).toHaveLength(1)
    expect(lastFakePlayer().play).toHaveBeenCalled()
  })

  it("does not re-render on the session's one-second position write", async () => {
    // useMiniPlayerActive reads a BOOLEAN, not the snapshot. Subscribing to the
    // object re-renders every consumer once a second, Home's feed included.
    await mount()
    await startSession()
    const before = lastFakePlayer().pause.mock.calls.length

    await act(async () => {
      mockMiniPlayerStore.updateProgress(12, 120)
      mockMiniPlayerStore.updateProgress(13, 120)
    })

    expect(lastFakePlayer().pause.mock.calls.length).toBe(before)
  })
})
