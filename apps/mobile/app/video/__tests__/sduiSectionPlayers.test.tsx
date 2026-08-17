/**
 * The two viewer-initiated SDUI players (U9), covered together because R14 is a
 * claim ABOUT the pair: `video/[sectionKey]` and `collection/[sectionKey]` are
 * the only surfaces besides the root host that mount a video view a viewer
 * asked for, and both must reconcile with picture-in-picture the same way.
 *
 * Two things are pinned here. Their views feed the SAME latch the host does
 * (R14/R15), and starting playback on either ends a live mini-player session
 * rather than playing a second decoder over the floating window (R10/R12) —
 * without creating a session of its own, which R19 excludes these routes from.
 *
 * The real screens and the real adapter run; only module boundaries are faked.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../../src/test-utils/expoVideoMock").createExpoVideoMock(),
)

// Live playingChange subscription, so `isPlaying` tracks the fake player the
// way it does on-device. Partial: `expo` carries more than useEvent.
jest.mock("expo", () => {
  const actual = jest.requireActual("expo")
  return {
    ...actual,
    useEvent: (
      player: {
        addListener: (
          n: string,
          f: (p?: unknown) => void,
        ) => { remove: () => void }
      },
      event: string,
      initial: unknown,
    ) => {
      const react = require("react") as {
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
  }
})

jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ sectionKey: "section-1" }),
  useNavigation: () => ({
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }),
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../../src/components/sections/ContentDispatcher", () => ({
  ContentDispatcher: () => null,
}))
jest.mock("../../../src/lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))
jest.mock("../../../src/lib/watchProgress/store", () => ({
  applyLocalProgress: jest.fn(),
  bufferProgressIntent: jest.fn(),
}))
jest.mock("../../../src/lib/watchProgress/signInPrompt", () => ({
  noteSignedOutPlaybackStop: jest.fn(),
}))
jest.mock("../../../src/lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({ drainIntents: jest.fn() }),
  getSignedInAccountId: () => "account-1",
}))

// The SDUI section both screens read. Driven per test so one suite can render
// a single video and a collection from the same provider seam.
jest.mock("../../../src/contexts/ExperienceProvider", () => {
  let section: unknown = null
  return {
    useSectionByKey: () => section,
    __setSection: (next: unknown) => {
      section = next
    },
  }
})

import { act } from "react"

import CollectionPlayerScreen from "../../collection/[sectionKey]"
import VideoDetailScreen from "../[sectionKey]"
import {
  getMiniPlayerStore,
  type MiniPlayerEndEvent,
} from "../../../src/lib/miniPlayer/store"
import type { ExpoVideoMock } from "../../../src/test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../../src/test-utils/rnTestRenderer"

const video = jest.requireMock("expo-video") as ExpoVideoMock
const experience = jest.requireMock(
  "../../../src/contexts/ExperienceProvider",
) as { __setSection: (next: unknown) => void }
const sessionStore = getMiniPlayerStore()

const URL_A = "https://stream.mux.com/assetAAA111.m3u8"

const VIDEO_SECTION = {
  __typename: "VideoBlock",
  sectionKey: "section-1",
  title: "A section video",
  videoId: "sdui-video-1",
  streamingUrl: URL_A,
  contentParagraphs: [],
  siblingContent: [],
}

const COLLECTION_SECTION = {
  __typename: "VideoCarouselBlock",
  sectionKey: "section-1",
  title: "A collection",
  items: [{ videoId: "sdui-video-1", streamingUrl: URL_A, imageUrl: null }],
}

/** Both screens are default exports taking no props. */
const SCREENS = [
  ["video/[sectionKey]", VideoDetailScreen, VIDEO_SECTION],
  ["collection/[sectionKey]", CollectionPlayerScreen, COLLECTION_SECTION],
] as const

let mounted: TestInstance | null = null

async function renderScreen(
  Screen: () => React.JSX.Element,
  section: unknown,
): Promise<TestInstance> {
  experience.__setSection(section)
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<Screen />)
  })
  mounted = renderer
  return renderer
}

function videoViewProps(renderer: TestInstance) {
  const views = renderer.root.findAll(
    (node) => (node as { type?: unknown }).type === video.VideoView,
  )
  if (views.length !== 1)
    throw new Error(`expected exactly one video view, found ${views.length}`)
  return views[0].props as {
    allowsPictureInPicture: boolean
    startsPictureInPictureAutomatically: boolean
    onPictureInPictureStart: () => void
    onPictureInPictureStop: () => void
  }
}

function startSession() {
  sessionStore.start({
    videoId: "floating-video",
    videoSlug: "floating-video-slug",
    title: "Floating",
    originPattern: "watch/[slug]",
  })
}

beforeEach(() => {
  video.__reset()
  experience.__setSection(null)
  sessionStore.setPipHold(false)
  sessionStore.end("abandoned")
})

afterEach(async () => {
  if (mounted != null) {
    await act(async () => {
      mounted?.unmount()
    })
    mounted = null
  }
  sessionStore.setPipHold(false)
  sessionStore.end("abandoned")
})

describe.each(SCREENS)("%s", (_name, Screen, section) => {
  it("feeds the shared picture-in-picture latch, both ways", async () => {
    const renderer = await renderScreen(Screen, section)
    const props = videoViewProps(renderer)

    expect(props.allowsPictureInPicture).toBe(true)
    // R14/R15: `automatic` belongs to the host alone — expo-video elects one
    // candidate across every view that carries it.
    expect(props.startsPictureInPictureAutomatically).toBe(false)

    await act(async () => {
      props.onPictureInPictureStart()
    })
    expect(sessionStore.getSnapshot().pipHold).toBe(true)

    await act(async () => {
      props.onPictureInPictureStop()
    })
    expect(sessionStore.getSnapshot().pipHold).toBe(false)
  })

  it("ends a live session as replaced when playback starts, and opens none", async () => {
    startSession()
    const renderer = await renderScreen(Screen, section)
    const endings: MiniPlayerEndEvent[] = []
    const unsubscribe = sessionStore.onEnd((event) => endings.push(event))

    // Mounting alone must not disturb the window — the viewer has not asked
    // for this video yet, and the poster path never plays.
    expect(sessionStore.getSnapshot().session?.videoId).toBe("floating-video")
    expect(renderer).not.toBeNull()

    await act(async () => {
      video.__player.play()
    })

    expect(endings.map((e) => e.reason)).toEqual(["replaced"])
    expect(endings[0].session.videoId).toBe("floating-video")
    // R19: no session takes its place, from either of these routes.
    expect(sessionStore.getSnapshot().session).toBeNull()
    unsubscribe()
  })
})
