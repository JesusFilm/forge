/**
 * The SDUI routes yield the one decoder to their own video (R9/R10).
 *
 * Both halves run for real — the root host and a stand-in for the route —
 * because the thing under test is a RELATIONSHIP between two decoders. A suite
 * over either half alone counts one surface and calls it correct.
 *
 * The stand-ins are the routes' player blocks and nothing else. The rest of
 * those screens reaches Apollo, the experience provider and expo-router, none
 * of which says anything about who owns the decoder.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

jest.mock("expo-video", () =>
  require("../../test-utils/expoVideoMock").expoVideoModuleMock(),
)
// Partial, and `useEvent` subscribes for real so a test can drive the playing
// state the helper is keyed on.
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
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  reportDatadogAction: jest.fn(),
  reportDatadogError: jest.fn(),
}))
jest.mock("../../lib/watchProgress/store", () => ({
  applyLocalProgress: jest.fn(),
  bufferProgressIntent: jest.fn(),
}))
jest.mock("../../lib/watchProgress/signInPrompt", () => ({
  noteSignedOutPlaybackStop: jest.fn(),
}))
jest.mock("../../lib/watchProgress/syncClient", () => ({
  getProgressSync: () => ({ drainIntents: jest.fn() }),
  getSignedInAccountId: () => "account-1",
}))
jest.mock("../../lib/watchProgress/recorder", () => ({
  createProgressRecorder: jest.fn(() => ({
    flush: jest.fn(),
    onTick: jest.fn(),
  })),
}))
jest.mock("../../lib/videoQoe", () => ({
  createVideoQoeSession: jest.fn(() => ({
    onFirstPlaying: jest.fn(() => null),
    onRebuffer: jest.fn(),
    onError: jest.fn(),
    onTimeUpdate: jest.fn(),
    finalize: jest.fn(() => null),
  })),
  shouldCountRebuffer: jest.fn(() => false),
}))
// Loud, not inert: every test injects its own store, so reaching a singleton
// default is a defect in the test rather than a fallback.
jest.mock("../../lib/miniPlayer", () => ({
  getMiniPlayerStore: () => {
    throw new Error("SDUI yield test reached the singleton store")
  },
  getMiniPlayerSheets: () => {
    throw new Error("SDUI yield test reached the singleton sheet counter")
  },
  registerSessionEnd: () => () => {},
}))

import { act } from "react"
import { VideoView } from "expo-video"

import { useEndMiniPlayerOnPlayback } from "../useEndMiniPlayerOnPlayback"
import { useManagedVideoPlayer } from "../useManagedVideoPlayer"
import { PlaybackHost } from "../../components/watch/PlaybackHost"
import { createSessionEndRegistry } from "../../lib/miniPlayer/endRegistry"
import { resetHostPlayerBridge } from "../../lib/miniPlayer/hostPlayer"
import {
  createMiniPlayerStore,
  type MiniPlayerStore,
} from "../../lib/miniPlayer/store"
import { createSheetCounter } from "../../lib/miniPlayer/suppression"
import {
  createdFakePlayers,
  peakMountedSurfaces,
  peakSurfacesPerPlayer,
  resetExpoVideoMock,
  type FakePlayer,
} from "../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const WINDOW_SLUG = "birth-of-jesus"
const WINDOW_URL = "https://stream.test/window.m3u8"
const ROUTE_URL = "https://stream.test/route.m3u8"
const SECOND_EPISODE_URL = "https://stream.test/episode-2.m3u8"

const VIDEO_SEGMENTS = ["video", "[sectionKey]"] as const
const COLLECTION_SEGMENTS = ["collection", "[sectionKey]"] as const

/**
 * `app/video/[sectionKey].tsx`'s player block: one frozen source, its own
 * player, its own surface mounted whether or not anything is playing.
 */
function FakeVideoRoute({
  store,
  streamingUrl,
}: {
  store: MiniPlayerStore
  streamingUrl: string
}) {
  const { player, isPlaying } = useManagedVideoPlayer(streamingUrl, undefined, {
    progress: { videoId: "sdui-video-1" },
  })
  useEndMiniPlayerOnPlayback(isPlaying, store)
  return <VideoView player={player} />
}

/**
 * `app/collection/[sectionKey].tsx`'s player block: the active episode's URL
 * changes under one player, which the adapter swaps in place.
 */
function FakeCollectionRoute({
  store,
  streamingUrl,
}: {
  store: MiniPlayerStore
  streamingUrl: string
}) {
  const { player, isPlaying } = useManagedVideoPlayer(streamingUrl, undefined, {
    progress: { videoId: "sdui-episode-1" },
  })
  useEndMiniPlayerOnPlayback(isPlaying, store)
  return <VideoView player={player} />
}

type RouteName = "video" | "collection"

const ROUTES: {
  name: RouteName
  segments: readonly string[]
  Route: typeof FakeVideoRoute
}[] = [
  { name: "video", segments: VIDEO_SEGMENTS, Route: FakeVideoRoute },
  {
    name: "collection",
    segments: COLLECTION_SEGMENTS,
    Route: FakeCollectionRoute,
  },
]

type HarnessProps = {
  store: MiniPlayerStore
  streamingUrl: string
  segments: readonly string[]
  Route: typeof FakeVideoRoute
}

/** Route first, host second — the real tree's order, and effect order is what
 *  sequences the handoff. */
function Harness({ store, streamingUrl, segments, Route }: HarnessProps) {
  return (
    <>
      <Route store={store} streamingUrl={streamingUrl} />
      <PlaybackHost
        store={store}
        sheets={sheets}
        registerEnd={registry.register}
        useRouteSegments={() => segments}
        canGoBack={() => true}
        navigateToVideo={() => {}}
      />
    </>
  )
}

let live: TestInstance[] = []
let sheets: ReturnType<typeof createSheetCounter>
let registry: ReturnType<typeof createSessionEndRegistry>
let storeEndReasons: string[] = []

function makeStore(): MiniPlayerStore {
  return createMiniPlayerStore({
    getSubjectId: () => "account-1",
    subscribeToSubject: () => () => {},
    onEnd: (_session, reason) => {
      storeEndReasons.push(reason)
      registry.end(reason)
    },
  })
}

/** The window the viewer left floating, published by the watch route earlier. */
async function startFloatingSession(store: MiniPlayerStore) {
  await act(async () => {
    store.start({ videoSlug: WINDOW_SLUG, streamingUrl: WINDOW_URL })
  })
}

async function render(props: HarnessProps) {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(<Harness {...props} />)
  })
  live.push(renderer)
  return renderer
}

async function update(renderer: TestInstance, props: HarnessProps) {
  await act(async () => {
    renderer.update(<Harness {...props} />)
  })
}

/** Every mounted video surface, host's and route's alike. */
function videoSurfaces(renderer: TestInstance) {
  return renderer.root.findAll(
    (node) => node.props.testID === "expo-video-view",
  )
}

/** The route renders first, so it creates the first player. */
function routePlayer(): FakePlayer {
  return createdFakePlayers()[0]
}

function hostPlayer(): FakePlayer {
  return createdFakePlayers()[1]
}

async function setPlaying(player: FakePlayer, isPlaying: boolean) {
  player.playing = isPlaying
  await act(async () => {
    player.emit("playingChange", { isPlaying })
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  resetExpoVideoMock()
  resetHostPlayerBridge()
  sheets = createSheetCounter()
  registry = createSessionEndRegistry()
  storeEndReasons = []
  live = []
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
  resetHostPlayerBridge()
  jest.useRealTimers()
})

describe.each(ROUTES)(
  "the SDUI $name route takes the decoder from the mini player",
  ({ segments, Route }) => {
    const props = (store: MiniPlayerStore): HarnessProps => ({
      store,
      streamingUrl: ROUTE_URL,
      segments,
      Route,
    })

    it("ends the live session as its own video starts playing", async () => {
      const store = makeStore()
      await startFloatingSession(store)
      await render(props(store))

      // The audited state: the window and the route each hold a decoder.
      expect(createdFakePlayers()).toHaveLength(2)
      expect(videoSurfaces(renderer())).toHaveLength(2)

      await setPlaying(routePlayer(), true)

      expect(store.getSnapshot()).toBeNull()
      expect(storeEndReasons).toEqual(["replaced"])
    })

    it("leaves exactly one surface, on the route's own player", async () => {
      const store = makeStore()
      await startFloatingSession(store)
      await render(props(store))

      await setPlaying(routePlayer(), true)

      const surfaces = videoSurfaces(renderer())
      expect(surfaces).toHaveLength(1)
      expect(surfaces[0].props.player).toBe(routePlayer())
      // The host's decoder did not merely lose its surface — it was released,
      // which is what a "one decoder" claim actually means on the device.
      expect(hostPlayer().pause).toHaveBeenCalled()
    })

    it("never puts a third surface up, and never two on one player", async () => {
      // The peak reads every commit, not the last one: a handoff that flashes
      // an extra surface for a single commit is invisible to a tree count.
      const store = makeStore()
      await startFloatingSession(store)
      await render(props(store))

      await setPlaying(routePlayer(), true)

      expect(peakMountedSurfaces()).toBe(2)
      expect(peakSurfacesPerPlayer()).toBe(1)
      expect(videoSurfaces(renderer())).toHaveLength(1)
    })

    it("leaves a floating session alive while the route only sits there", async () => {
      // The anti-vacuous companion. Keyed on mounting instead, every assertion
      // above still passes — and the viewer loses the window to a page they
      // opened to read.
      const store = makeStore()
      await startFloatingSession(store)
      await render(props(store))

      expect(store.getSnapshot()).not.toBeNull()
      expect(storeEndReasons).toEqual([])
      expect(videoSurfaces(renderer())).toHaveLength(2)
    })

    it("is a no-op with no session, and does not throw", async () => {
      const store = makeStore()
      await render(props(store))

      await setPlaying(routePlayer(), true)

      expect(store.getSnapshot()).toBeNull()
      expect(storeEndReasons).toEqual([])
      expect(videoSurfaces(renderer())).toHaveLength(1)
    })

    it("does not end a session when its video pauses", async () => {
      // A native stack keeps this route mounted under a watch route, so a
      // session published there can arrive while this player is paused.
      const store = makeStore()
      await render(props(store))
      await setPlaying(routePlayer(), true)

      await startFloatingSession(store)
      await setPlaying(routePlayer(), false)

      expect(store.getSnapshot()).not.toBeNull()
      expect(storeEndReasons).toEqual([])
    })

    it("ends a session that arrived after its first play, on the next play", async () => {
      // A once-per-mount latch passes every test above and fails this one,
      // leaving the second decoder back under the window.
      const store = makeStore()
      await render(props(store))
      await setPlaying(routePlayer(), true)
      await setPlaying(routePlayer(), false)

      await startFloatingSession(store)
      await setPlaying(routePlayer(), true)

      expect(store.getSnapshot()).toBeNull()
      expect(storeEndReasons).toEqual(["replaced"])
    })

    it("keeps yielding when the route swaps its source", async () => {
      // The collection route re-points one player at the next episode; the
      // video route re-points when a language resolves.
      const store = makeStore()
      await render(props(store))

      await update(renderer(), {
        ...props(store),
        streamingUrl: SECOND_EPISODE_URL,
      })
      await startFloatingSession(store)
      await setPlaying(routePlayer(), true)

      expect(createdFakePlayers()).toHaveLength(2)
      expect(store.getSnapshot()).toBeNull()
      expect(storeEndReasons).toEqual(["replaced"])
    })
  },
)

/** The one renderer this test mounted. */
function renderer(): TestInstance {
  const current = live.at(-1)
  if (current == null) throw new Error("nothing rendered")
  return current
}
