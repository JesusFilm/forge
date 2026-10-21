/**
 * U7: the Mux Data monitor session inside the shared player hook, driven
 * against a fake monitor backend (KTD1). The spike picks the real backend;
 * these cases pin the attach rule (KTD4), the two-phase view boundary (KTD5),
 * the player size, the error reload facade (KTD16), and that the QoE session
 * stays unchanged (R29).
 *
 * Every render runs under <StrictMode> (the repo's remount-safety rule): the
 * session is created in an effect, so the mount cycle must leave exactly one.
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
// Live playingChange subscription, as in useManagedVideoPlayer.test.tsx.
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
jest.mock("../../env", () => ({
  env: { EXPO_PUBLIC_MUX_DATA_ENV_KEY: "k0abc123" },
}))
jest.mock("../../lib/datadog", () => ({
  datadogLog: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
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
  getSignedInAccountId: () => null,
}))
// The spike's backend does not exist yet; this seam is where it connects.
jest.mock("../../lib/muxData/monitor", () => ({
  resolveMuxMonitorBackend: () => mockBackend,
}))
jest.mock("../../lib/muxData/viewerId", () => ({
  getMuxViewerIdStore: () => ({ get: () => mockViewerId }),
}))

import { StrictMode, act, type ReactElement } from "react"

import { env } from "../../env"
import { datadogLog } from "../../lib/datadog"
import type { MuxMonitor, MuxMonitorBackend } from "../../lib/muxData/monitor"
import type { MuxDataOption } from "../../lib/muxData/monitorSession"
import type { MuxViewData } from "../../lib/muxData/viewData"
import { recoverPlayback } from "../../lib/recoverPlayback"
import type { ExpoVideoMock } from "../../test-utils/expoVideoMock"
import {
  TestRenderer,
  type NodePath,
  type NodeRequireLike,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"
import { useManagedVideoPlayer } from "../useManagedVideoPlayer"

const VIEWER = "5f0b6c1e-8d2a-4c3b-9e4f-0a1b2c3d4e5f"
const ENGLISH = "https://stream.mux.com/englishAsset.m3u8"
const SPANISH = "https://stream.mux.com/spanishAsset.m3u8"
const FRENCH = "https://stream.mux.com/frenchAsset.m3u8"
const ENGLISH_LOW =
  "https://stream.mux.com/englishAsset.m3u8?max_resolution=480p"
const TRAILER = "https://stream.mux.com/trailerAsset.m3u8"
const EPISODE = "https://stream.mux.com/episodeAsset.m3u8"
const DOWNLOAD = "file:///docs/offline-downloads/jesus/video.mp4"

const video = jest.requireMock("expo-video") as ExpoVideoMock
const player = video.__player
const mockEnv = env as { EXPO_PUBLIC_MUX_DATA_ENV_KEY?: string }

let mockViewerId: Promise<string> = Promise.resolve(VIEWER)

type FakeMonitor = { [K in keyof MuxMonitor]: jest.Mock }
const monitors: FakeMonitor[] = []
const attaches: Array<{ data: MuxViewData; size: unknown }> = []

function makeBackend(
  overrides: Partial<MuxMonitorBackend> = {},
): MuxMonitorBackend {
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
    ...overrides,
  }
}

let mockBackend: MuxMonitorBackend = makeBackend()

type HookResult = ReturnType<typeof useManagedVideoPlayer>
let latest: HookResult | null = null

function Harness({
  url,
  muxData,
}: {
  url: string | null
  muxData: MuxDataOption | null
}) {
  latest = useManagedVideoPlayer(url, undefined, { muxData })
  return null
}

type UpdatableRenderer = TestInstance & {
  update(element: ReactElement): void
  unmount(): void
}

let strict = true

function element(url: string | null, muxData: MuxDataOption | null) {
  const harness = <Harness url={url} muxData={muxData} />
  return strict ? <StrictMode>{harness}</StrictMode> : harness
}

async function mount(url: string | null, muxData: MuxDataOption | null) {
  let renderer!: UpdatableRenderer
  await act(async () => {
    renderer = TestRenderer.create(
      element(url, muxData),
    ) as unknown as UpdatableRenderer
  })
  return renderer
}

async function rerender(
  renderer: UpdatableRenderer,
  url: string | null,
  muxData: MuxDataOption | null,
) {
  await act(async () => {
    renderer.update(element(url, muxData))
  })
}

async function settleReplace(reason?: unknown) {
  await act(async () => {
    player.__settleReplace(reason)
  })
}

function watch(
  identity: Partial<MuxDataOption["identity"]> = {},
  playerSize: MuxDataOption["playerSize"] = null,
): MuxDataOption {
  return {
    surface: "watch",
    identity: { videoId: null, videoSlug: "jesus", title: null, ...identity },
    playerSize,
  }
}

function liveMonitors() {
  return monitors.filter((m) => m.release.mock.calls.length === 0)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  strict = true
  video.__reset()
  monitors.length = 0
  attaches.length = 0
  latest = null
  mockBackend = makeBackend()
  mockViewerId = Promise.resolve(VIEWER)
  mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY = "k0abc123"
  ;(datadogLog.info as jest.Mock).mockClear()
})

describe("useManagedVideoPlayer muxData: attach (KTD4)", () => {
  // The production first render: a slug-only request with no progress
  // identity and no documentId (session-identity learning).
  it("attaches a slug-only first render once, with no video id", async () => {
    await mount(ENGLISH, watch())
    expect(attaches).toHaveLength(1)
    expect(attaches[0].data).toEqual({
      player_name: "forge-mobile-watch",
      viewer_user_id: VIEWER,
      custom_1: "streamed",
      custom_2: "jesus",
      video_source_url: ENGLISH,
    })
    expect(liveMonitors()).toHaveLength(1)
  })

  it("creates no monitor for any URL with the gate off", async () => {
    delete mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY
    const renderer = await mount(ENGLISH, watch())
    await rerender(renderer, SPANISH, watch({ videoId: "doc-1" }))
    await settleReplace()
    expect(mockBackend.attach).not.toHaveBeenCalled()
  })

  it("attaches once for a null creation source followed by a URL", async () => {
    const renderer = await mount(null, watch())
    expect(attaches).toHaveLength(0)
    await rerender(renderer, ENGLISH, watch())
    await settleReplace()
    expect(attaches).toHaveLength(1)
    expect(attaches[0].data.video_source_url).toBe(ENGLISH)
  })

  it("runs no attach when the viewer id resolves after unmount", async () => {
    const id = deferred<string>()
    mockViewerId = id.promise
    const renderer = await mount(ENGLISH, watch())
    await act(async () => renderer.unmount())
    await act(async () => id.resolve(VIEWER))
    expect(mockBackend.attach).not.toHaveBeenCalled()
  })

  it("binds only the second stream when the viewer id resolves after it entered", async () => {
    const id = deferred<string>()
    mockViewerId = id.promise
    const renderer = await mount(ENGLISH, watch())
    await rerender(renderer, SPANISH, watch({ videoId: "doc-1" }))
    await act(async () => id.resolve(VIEWER))
    expect(attaches).toHaveLength(1)
    expect(attaches[0].data.video_source_url).toBe(SPANISH)
  })

  it("keeps one live monitor after the StrictMode mount and none after unmount", async () => {
    const renderer = await mount(ENGLISH, watch())
    expect(liveMonitors()).toHaveLength(1)
    await act(async () => renderer.unmount())
    expect(liveMonitors()).toHaveLength(0)
  })

  it("releases the monitor on unmount without touching the released player", async () => {
    const renderer = await mount(ENGLISH, watch())
    // The real hook releases the native player first, then runs this cleanup.
    player.__release()
    expect(() => act(() => renderer.unmount())).not.toThrow()
    expect(monitors[0].release).toHaveBeenCalledTimes(1)
  })
})

describe("useManagedVideoPlayer muxData: view boundaries (KTD5)", () => {
  it("stages three quick swaps and opens one view, for the last", async () => {
    const renderer = await mount(ENGLISH, watch({ videoId: "doc-1" }))
    await rerender(renderer, SPANISH, watch({ videoId: "doc-1" }))
    await rerender(renderer, FRENCH, watch({ videoId: "doc-1" }))
    await rerender(renderer, ENGLISH_LOW, watch({ videoId: "doc-1" }))
    await settleReplace()
    await settleReplace()
    await settleReplace()
    const [monitor] = monitors
    expect(monitor.stage.mock.calls.map(([d]) => d.video_source_url)).toEqual([
      SPANISH,
      FRENCH,
      ENGLISH_LOW,
    ])
    expect(monitor.updateView).not.toHaveBeenCalled()
    expect(monitor.startView).toHaveBeenCalledTimes(1)
    // The view opens only after the last swap staged its data.
    expect(monitor.startView.mock.invocationCallOrder[0]).toBeGreaterThan(
      monitor.stage.mock.invocationCallOrder[2],
    )
  })

  it("updates the open view with a late documentId, with no second attach", async () => {
    const renderer = await mount(ENGLISH, watch())
    await rerender(
      renderer,
      ENGLISH,
      watch({ videoId: "doc-1", title: "Jesus" }),
    )
    expect(attaches).toHaveLength(1)
    expect(monitors[0].updateView).toHaveBeenCalledTimes(1)
    expect(monitors[0].updateView.mock.calls[0][0]).toMatchObject({
      video_id: "doc-1",
      video_title: "Jesus",
    })
    expect(monitors[0].startView).not.toHaveBeenCalled()
  })

  it("forwards a size change and starts no view", async () => {
    const renderer = await mount(
      ENGLISH,
      watch({}, { width: 390, height: 219 }),
    )
    expect(attaches[0].size).toEqual({ width: 390, height: 219 })
    await rerender(renderer, ENGLISH, watch({}, { width: 160, height: 90 }))
    expect(monitors[0].setPlayerSize).toHaveBeenCalledWith({
      width: 160,
      height: 90,
    })
    expect(monitors[0].startView).not.toHaveBeenCalled()
    expect(monitors[0].stage).not.toHaveBeenCalled()
  })

  it("detaches before the trailer loads and attaches before the episode loads", async () => {
    const renderer = await mount(ENGLISH, watch({ videoId: "doc-1" }))
    await rerender(renderer, TRAILER, null)
    const trailerLoad = player.replaceAsync.mock.invocationCallOrder[0]
    expect(monitors[0].release.mock.invocationCallOrder[0]).toBeLessThan(
      trailerLoad,
    )
    await settleReplace()
    await rerender(
      renderer,
      EPISODE,
      watch({ videoId: "doc-3", videoSlug: "episode-1" }),
    )
    const episodeLoad = player.replaceAsync.mock.invocationCallOrder[1]
    const episodeAttach = (mockBackend.attach as jest.Mock).mock
      .invocationCallOrder[1]
    expect(episodeAttach).toBeLessThan(episodeLoad)
    expect(attaches[1].data).toMatchObject({
      video_id: "doc-3",
      custom_2: "episode-1",
    })
  })

  it("does not detach when the option is lost and no URL arrives", async () => {
    const renderer = await mount(ENGLISH, watch({ videoId: "doc-1" }))
    await rerender(renderer, ENGLISH, null)
    expect(monitors[0].release).not.toHaveBeenCalled()
    await rerender(renderer, TRAILER, null)
    expect(monitors[0].release).toHaveBeenCalledTimes(1)
  })

  it("detaches for a download and attaches for the stream, with downloads off", async () => {
    mockBackend = makeBackend({ downloadedPlaysMonitored: false })
    const renderer = await mount(ENGLISH, watch({ videoId: "doc-1" }))
    await rerender(renderer, DOWNLOAD, watch({ videoId: "doc-1" }))
    await settleReplace()
    expect(monitors[0].release).toHaveBeenCalledTimes(1)
    await rerender(renderer, ENGLISH, watch({ videoId: "doc-1" }))
    await settleReplace()
    expect(attaches).toHaveLength(2)
    expect(liveMonitors()).toHaveLength(1)
  })
})

describe("useManagedVideoPlayer muxData: error reload facade (KTD16)", () => {
  async function failedPlayback() {
    await mount(ENGLISH_LOW, watch({ videoId: "doc-1" }))
    const facade = latest?.muxMonitor
    expect(facade).toBeDefined()
    return facade!
  }

  it("starts one view with the reload URL on the replaceAsync path", async () => {
    const facade = await failedPlayback()
    let outcome: Promise<unknown> | null = null
    await act(async () => {
      outcome = recoverPlayback(
        player,
        ENGLISH,
        0,
        () => false,
        (url) => facade.beginReload(url),
      )
    })
    await settleReplace()
    await act(async () => {
      await outcome
    })
    expect(monitors[0].stage.mock.calls[0][0].video_source_url).toBe(ENGLISH)
    expect(monitors[0].startView).toHaveBeenCalledTimes(1)
  })

  it("starts one view with the reload URL on the replace fallback", async () => {
    const facade = await failedPlayback()
    await act(async () => {
      void recoverPlayback(
        player,
        ENGLISH,
        0,
        () => false,
        (url) => facade.beginReload(url),
      )
    })
    await settleReplace(new Error("replaceAsync rejected"))
    expect(player.replace).toHaveBeenCalledWith(ENGLISH, true)
    expect(monitors[0].stage.mock.calls[0][0].video_source_url).toBe(ENGLISH)
    expect(monitors[0].startView).toHaveBeenCalledTimes(1)
  })

  it("keeps the facade stable across renders", async () => {
    const renderer = await mount(ENGLISH, watch())
    const first = latest?.muxMonitor
    await rerender(renderer, ENGLISH, watch({ videoId: "doc-1" }))
    expect(latest?.muxMonitor).toBe(first)
  })
})

describe("useManagedVideoPlayer muxData: playback safety (R27, R29)", () => {
  async function swapSequence() {
    const renderer = await mount(ENGLISH, watch({ videoId: "doc-1" }))
    await act(async () => player.play())
    await rerender(renderer, SPANISH, watch({ videoId: "doc-1" }))
    // A loading status during the swap must not count as a rebuffer.
    await act(async () => player.__emit("statusChange", { status: "loading" }))
    await settleReplace()
    await act(async () => player.__emit("statusChange", { status: "loading" }))
    await act(async () => renderer.unmount())
    return (datadogLog.info as jest.Mock).mock.calls
      .filter(([name]) => name === "video.qoe")
      .map(([, summary]) => ({ ...summary, ttff_ms: null }))
  }

  // Outside StrictMode: its mount cycle already finalizes the adapter's first
  // QoE session, which leaves nothing to compare. R29 keeps that unchanged.
  it("emits the same QoE summaries with the monitor on and off", async () => {
    strict = false
    const withMonitor = await swapSequence()
    video.__reset()
    ;(datadogLog.info as jest.Mock).mockClear()
    delete mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY
    const withoutMonitor = await swapSequence()
    expect(withMonitor.length).toBeGreaterThan(0)
    expect(withMonitor).toEqual(withoutMonitor)
  })

  it("keeps playing when every monitor call throws (AE9)", async () => {
    const thrower = jest.fn(() => {
      throw new Error("native fault")
    })
    mockBackend = makeBackend({
      attach: () => ({
        stage: thrower,
        updateView: thrower,
        startView: thrower,
        setPlayerSize: thrower,
        release: thrower,
      }),
    })
    const renderer = await mount(ENGLISH, watch({}, { width: 1, height: 1 }))
    await act(async () => player.play())
    await rerender(
      renderer,
      SPANISH,
      watch({ videoId: "doc-1", title: "Jesus" }, { width: 2, height: 2 }),
    )
    await settleReplace()
    expect(thrower).toHaveBeenCalled()
    expect(player.playing).toBe(true)
    expect(() => act(() => renderer.unmount())).not.toThrow()
  })
})
