/**
 * U10: the playback host's Mux Data wiring. The adapter runs inside the real
 * `PlaybackHost`, as in `useManagedVideoPlayer.recommendations.test.tsx`; only
 * the module boundaries and the monitor backend are faked. The backend is the
 * seam the device spike's pick connects to (KTD1).
 *
 * The host owns the identity and the title and holds both for each video
 * (KTD6); the hook forwards them. These cases pin what reaches the monitor
 * from the host's real request handling: one view per stream across the
 * window, PiP and cast (AE1, AE6), a new view per dub or quality swap (AE2),
 * the record title only (AE3), and the slug on a download (AE10).
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

jest.mock("expo-video", () =>
  require("../../test-utils/expoVideoMock").createExpoVideoMock(),
)

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
      const r = require as unknown as NodeRequireLike
      const react = r("react") as {
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

// jest-expo leaves `documentDirectory` null, so no path would be a download.
jest.mock("expo-file-system/legacy", () => ({
  ...jest.requireActual("expo-file-system/legacy"),
  documentDirectory: "file:///docs/",
}))
jest.mock("expo-network", () => ({
  useNetworkState: () => ({ isInternetReachable: true }),
}))
jest.mock("expo-image", () => ({ Image: () => null }))
jest.mock("expo-linear-gradient", () => ({ LinearGradient: () => null }))
jest.mock("expo-glass-effect", () => ({
  GlassView: () => null,
  isLiquidGlassAvailable: () => false,
  isGlassEffectAPIAvailable: () => false,
}))
jest.mock("expo-router", () => ({
  useRouter: () => ({
    back: jest.fn(),
    canGoBack: () => true,
    replace: jest.fn(),
    push: jest.fn(),
  }),
  useSegments: () => [],
}))
jest.mock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock("../../components/ui/PlatformBlur", () => ({
  PlatformBlur: () => null,
}))
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
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
jest.mock("../../lib/recommendations/playbackRecorderClient", () => ({
  createPlaybackRecorderForMedia: () => null,
}))

// The gate opens with a test key; the rest of env stays real.
jest.mock("../../env", () => ({
  env: {
    ...jest.requireActual("../../env").env,
    EXPO_PUBLIC_MUX_DATA_ENV_KEY: "k0abc123",
  },
}))
jest.mock("../../lib/muxData/monitor", () => ({
  resolveMuxMonitorBackend: () => mockBackend,
}))
jest.mock("../../lib/muxData/viewerId", () => ({
  getMuxViewerIdStore: () => ({
    get: () => Promise.resolve("5f0b6c1e-8d2a-4c3b-9e4f-0a1b2c3d4e5f"),
  }),
}))

import { act } from "react"
import { AppState } from "react-native"

import { PlaybackHost } from "../../components/watch/PlaybackHost"
import { getMiniPlayerStore } from "../../lib/miniPlayer/store"
import { getPlayerSettingsStore } from "../../lib/miniPlayer/playerSettings"
import {
  getPlaybackRequestStore,
  type PlaybackRequest,
} from "../../lib/miniPlayer/playbackRequest"
import type { MuxMonitor, MuxMonitorBackend } from "../../lib/muxData/monitor"
import type { MuxViewData } from "../../lib/muxData/viewData"
import type { ExpoVideoMock } from "../../test-utils/expoVideoMock"
import { resetPlayerSettings } from "../../test-utils/resetPlayerSettings"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

jest.setTimeout(20_000)

const video = jest.requireMock("expo-video") as ExpoVideoMock
const player = video.__player
const requestStore = getPlaybackRequestStore()
const sessionStore = getMiniPlayerStore()

const ENGLISH = "https://stream.mux.com/englishAsset.m3u8"
const SPANISH = "https://stream.mux.com/spanishAsset.m3u8"
const TRAILER = "https://stream.mux.com/trailerAsset.m3u8"
const EPISODE = "https://stream.mux.com/episodeAsset.m3u8"
const DOWNLOAD = "file:///docs/offline-downloads/jesus/video.mp4"
const SLOT_RECT = { x: 0, y: 0, width: 390, height: 219 }

type FakeMonitor = { [K in keyof MuxMonitor]: jest.Mock }
const monitors: FakeMonitor[] = []
const attaches: Array<{ data: MuxViewData; size: unknown }> = []

let mockBackend: MuxMonitorBackend = makeBackend()

function makeBackend(): MuxMonitorBackend {
  return {
    downloadedPlaysMonitored: true,
    seesNativeControlSeeks: true,
    attach: jest.fn(({ data, size }) => {
      attaches.push({ data, size })
      const monitor: FakeMonitor = {
        stage: jest.fn(),
        updateView: jest.fn(),
        startView: jest.fn(),
        setPlayerSize: jest.fn(),
        release: jest.fn(),
      }
      monitors.push(monitor)
      return monitor
    }),
  }
}

type Descriptor = {
  url?: string | null
  videoId?: string | null
  slug?: string
  title?: string
  titleFromRecord?: boolean
  languageSlug?: string | null
  castActive?: boolean
  /** The series trailer publishes no session. */
  noSession?: boolean
}

/** The watch screen's request shape (`app/watch/[slug].tsx`). */
function request(d: Descriptor = {}): PlaybackRequest {
  const slug = d.slug ?? "jesus"
  const videoId = d.videoId === undefined ? "doc-1" : d.videoId
  const languageSlug = d.languageSlug === undefined ? "english" : d.languageSlug
  return {
    streamingUrl: d.url === undefined ? ENGLISH : d.url,
    posterUrl: null,
    subtitleVttSrc: null,
    fullscreen: false,
    autostart: false,
    resumeAtSeconds: null,
    progressVideoId: d.noSession ? null : videoId,
    progressVideoSlug:
      !d.noSession && videoId == null && d.url === DOWNLOAD ? slug : null,
    progressLanguageSlug: d.noSession ? null : languageSlug,
    onToggleFullscreen: null,
    castActive: d.castActive ?? false,
    cast: null,
    progressFeedRef: null,
    session: d.noSession
      ? null
      : {
          videoId,
          videoSlug: slug,
          title: d.title ?? "Jesus",
          titleFromRecord: d.titleFromRecord ?? true,
          posterUrl: null,
          languageSlug,
          originPattern: "watch/[slug]",
        },
  }
}

let mounted: TestInstance | null = null
let slotId: number | null = null

async function renderHost(d: Descriptor = {}) {
  slotId = requestStore.attachSlot(request(d))
  requestStore.setSlotRect(slotId, SLOT_RECT)
  await act(async () => {
    mounted = TestRenderer.create(<PlaybackHost />)
  })
}

async function publish(d: Descriptor) {
  await act(async () => {
    if (slotId != null) requestStore.updateSlot(slotId, request(d))
  })
}

async function settleReplace() {
  await act(async () => {
    player.__settleReplace()
  })
}

function only<T>(items: T[]): T {
  expect(items).toHaveLength(1)
  return items[0]
}

beforeEach(() => {
  video.__reset()
  monitors.length = 0
  attaches.length = 0
  mockBackend = makeBackend()
  requestStore.reset()
  slotId = null
  sessionStore.setPipHold(false)
  sessionStore.end("abandoned")
  resetPlayerSettings()
  ;(AppState as { currentState: string }).currentState = "active"
})

afterEach(async () => {
  if (mounted != null) {
    const renderer = mounted
    await act(async () => renderer.unmount())
    mounted = null
  }
  sessionStore.setPipHold(false)
  sessionStore.end("abandoned")
})

describe("PlaybackHost Mux Data: what a view carries", () => {
  // AE3, R16: a Home tile, search result or deep link plays the seed stream
  // before the record loads, with the slug alone.
  it("attaches a slug-only first render, then updates the same view with the late documentId", async () => {
    await renderHost({ videoId: null, title: "Jesus", titleFromRecord: false })
    const first = only(attaches)
    expect(first.data).not.toHaveProperty("video_id")
    expect(first.data).not.toHaveProperty("video_title")
    expect(first.data.custom_2).toBe("jesus")

    await publish({ videoId: "doc-1", title: "Jesus", titleFromRecord: true })

    expect(attaches).toHaveLength(1)
    expect(monitors[0].updateView).toHaveBeenCalledTimes(1)
    expect(monitors[0].updateView.mock.calls[0][0]).toMatchObject({
      video_id: "doc-1",
      video_title: "Jesus",
      custom_2: "jesus",
    })
    expect(monitors[0].startView).not.toHaveBeenCalled()
  })

  // R15: the seed title is deep-link input and never reaches Mux.
  it("never sends a seed title, and sends the record title", async () => {
    await renderHost({ title: "Crafted seed title", titleFromRecord: false })
    expect(JSON.stringify(attaches[0].data)).not.toContain("Crafted")

    await publish({ title: "Jesus", titleFromRecord: true })

    const updates = monitors[0].updateView.mock.calls.map(([d]) => d)
    expect(updates.map((d) => d.video_title)).toEqual(["Jesus"])
    expect(JSON.stringify(updates)).not.toContain("Crafted")
  })

  // KTD6: an expand remounts the watch page, whose first render has no record.
  // The view rules hold the known title for the same video.
  it("keeps the known title when a remount's first render names none", async () => {
    await renderHost({ title: "Jesus", titleFromRecord: true })
    await publish({ title: "Jesus", titleFromRecord: false })
    await publish({ url: SPANISH, title: "Jesus", titleFromRecord: false })
    await settleReplace()

    expect(monitors[0].updateView).not.toHaveBeenCalled()
    expect(only(monitors[0].stage.mock.calls)[0]).toMatchObject({
      video_title: "Jesus",
      video_source_url: SPANISH,
    })
  })

  // AE10, R17: an offline play before the record loads.
  it("names an offline download with no record by slug and marker", async () => {
    await renderHost({ url: DOWNLOAD, videoId: null, titleFromRecord: false })
    const first = only(attaches).data
    expect(first.custom_2).toBe("jesus")
    expect(first.custom_1).toBe("downloaded")
    expect(first).not.toHaveProperty("video_id")
    expect(JSON.stringify(first)).not.toContain("file://")
  })

  it("sends no dub language or other app field (R21)", async () => {
    await renderHost({ languageSlug: "spanish" })
    expect(JSON.stringify(attaches[0].data)).not.toContain("spanish")
  })
})

describe("PlaybackHost Mux Data: view boundaries", () => {
  // AE2
  it("starts one new view for a dub swap and one for a quality swap", async () => {
    await renderHost()
    await publish({ url: SPANISH, languageSlug: "spanish" })
    await settleReplace()
    expect(monitors[0].startView).toHaveBeenCalledTimes(1)

    await act(async () => {
      getPlayerSettingsStore().setQualityTier("low")
    })
    await settleReplace()

    expect(attaches).toHaveLength(1)
    expect(monitors[0].startView).toHaveBeenCalledTimes(2)
    const staged = monitors[0].stage.mock.calls.map(([d]) => d.video_source_url)
    expect(staged[0]).toBe(SPANISH)
    expect(staged[1]).toContain("max_resolution=480p")
  })

  // AE1: the watch page, the window, the background and PiP are one view.
  it("keeps one view when the video moves to the window and into PiP", async () => {
    await renderHost()
    await act(async () => player.play())
    await act(async () => {
      if (slotId != null) requestStore.detachSlot(slotId)
    })
    expect(sessionStore.getSnapshot().session).not.toBeNull()
    await act(async () => {
      sessionStore.setPipHold(true)
    })

    expect(attaches).toHaveLength(1)
    const [monitor] = monitors
    expect(monitor.startView).not.toHaveBeenCalled()
    expect(monitor.stage).not.toHaveBeenCalled()
    expect(monitor.release).not.toHaveBeenCalled()
  })

  it("sends the window's size when the video moves to the window, with no new view", async () => {
    await renderHost()
    // The first size arrives while the attach waits, so the attach carries it.
    expect(only(attaches).size).toEqual({
      width: SLOT_RECT.width,
      height: SLOT_RECT.height,
    })
    await act(async () => player.play())
    await act(async () => {
      if (slotId != null) requestStore.detachSlot(slotId)
    })

    const last = monitors[0].setPlayerSize.mock.calls.at(-1)?.[0]
    expect(last.width).toBeLessThan(SLOT_RECT.width)
    expect(last.height).toBeGreaterThan(0)
    expect(monitors[0].startView).not.toHaveBeenCalled()
  })

  // AE6: the phone's player pauses under a cast; the view stays open.
  it("starts no view and keeps the monitor when a cast session starts", async () => {
    await renderHost()
    await act(async () => player.play())
    await publish({ castActive: true })
    await publish({ castActive: false })

    expect(attaches).toHaveLength(1)
    expect(monitors[0].startView).not.toHaveBeenCalled()
    expect(monitors[0].release).not.toHaveBeenCalled()
  })

  it("creates no monitor for the series trailer, then attaches before the episode loads", async () => {
    await renderHost({ url: TRAILER, noSession: true })
    expect(mockBackend.attach).not.toHaveBeenCalled()

    await publish({ url: EPISODE, videoId: "doc-3", slug: "episode-1" })

    const attachOrder = (mockBackend.attach as jest.Mock).mock
      .invocationCallOrder[0]
    expect(attachOrder).toBeLessThan(
      player.replaceAsync.mock.invocationCallOrder[0],
    )
    expect(only(attaches).data).toMatchObject({
      video_id: "doc-3",
      custom_2: "episode-1",
    })
  })
  // KTD16: the chrome's recovery reaches the monitor through the host. A
  // one-line revert of that prop would leave every reload inside the old view.
  it("starts one view for an error reload from the player's play control", async () => {
    await renderHost()
    player.status = "error"
    const play = mounted?.root.findAll(
      (node) =>
        (node.props as { accessibilityLabel?: string }).accessibilityLabel ===
          "Play" &&
        typeof (node.props as { onPress?: unknown }).onPress === "function",
    )[0]
    expect(play).toBeDefined()
    await act(async () => {
      ;(play?.props as { onPress: () => void }).onPress()
    })
    await settleReplace()

    expect(only(monitors[0].stage.mock.calls)[0]).toMatchObject({
      video_source_url: ENGLISH,
    })
    expect(monitors[0].startView).toHaveBeenCalledTimes(1)
  })
})
