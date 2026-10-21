jest.mock("../../../env", () => ({ env: {} }))
jest.mock("../monitor", () => ({
  resolveMuxMonitorBackend: () => mockResolvedBackend,
}))
jest.mock("../viewerId", () => ({
  getMuxViewerIdStore: () => ({ get: () => Promise.resolve("viewer-1") }),
}))

import type { VideoPlayer } from "expo-video"

import { env } from "../../../env"
import type { MuxMonitor, MuxMonitorBackend } from "../monitor"
import {
  createMonitorSession,
  createMuxMonitorSession,
  type MuxDataOption,
} from "../monitorSession"
import type { MuxViewData } from "../viewData"

// The shipped state: no backend until the device spike connects one.
let mockResolvedBackend: MuxMonitorBackend | null = null
const mockEnv = env as { EXPO_PUBLIC_MUX_DATA_ENV_KEY?: string }

const OFFLINE_ROOT = "file:///data/Documents/offline-downloads"
const ENGLISH = "https://stream.mux.com/englishAsset.m3u8"
const SPANISH = "https://stream.mux.com/spanishAsset.m3u8"
const FRENCH = "https://stream.mux.com/frenchAsset.m3u8"
const ENGLISH_LOW =
  "https://stream.mux.com/englishAsset.m3u8?max_resolution=480p"
const TRAILER = "https://stream.mux.com/trailerAsset.m3u8"
const EPISODE = "https://stream.mux.com/episodeAsset.m3u8"
const DOWNLOAD = `${OFFLINE_ROOT}/jesus/video.mp4`
const VIEWER = "5f0b6c1e-8d2a-4c3b-9e4f-0a1b2c3d4e5f"

type Call =
  | { op: "attach"; data: MuxViewData; size: unknown }
  | { op: "stage" | "updateView"; data: MuxViewData }
  | { op: "startView" | "release"; monitor: number }
  | { op: "setPlayerSize"; size: unknown }

function fakeBackend(overrides: Partial<MuxMonitorBackend> = {}) {
  const calls: Call[] = []
  let monitors = 0
  const backend: MuxMonitorBackend = {
    downloadedPlaysMonitored: true,
    seesNativeControlSeeks: true,
    attach: jest.fn(({ data, size }) => {
      monitors += 1
      const index = monitors
      calls.push({ op: "attach", data, size })
      const monitor: MuxMonitor = {
        stage: (staged) => void calls.push({ op: "stage", data: staged }),
        updateView: (updated) =>
          void calls.push({ op: "updateView", data: updated }),
        startView: () => void calls.push({ op: "startView", monitor: index }),
        setPlayerSize: (next) =>
          void calls.push({ op: "setPlayerSize", size: next }),
        release: () => void calls.push({ op: "release", monitor: index }),
      }
      return monitor
    }),
    ...overrides,
  }
  return { backend, calls }
}

// A released native player throws on every read. The session must never
// touch the player itself; only the backend's attach receives it.
const player = new Proxy(
  {},
  {
    get() {
      throw new Error("the session read the player")
    },
  },
) as VideoPlayer

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function watch(
  identity: Partial<MuxDataOption["identity"]> = {},
): MuxDataOption {
  return {
    surface: "watch",
    identity: { videoId: null, videoSlug: "jesus", title: null, ...identity },
  }
}

function session(
  options: {
    backend?: MuxMonitorBackend
    viewerId?: Promise<string>
  } = {},
) {
  const fake = fakeBackend()
  const backend = options.backend ?? fake.backend
  const created = createMonitorSession(player, {
    config: {
      envKey: "k0abc123",
      playerNames: {
        watch: "forge-mobile-watch",
        experience: "forge-mobile-experience",
        explore: "forge-mobile-explore",
      },
    },
    backend,
    getViewerId: () => options.viewerId ?? Promise.resolve(VIEWER),
    isLocal: (url) => url.startsWith(`${OFFLINE_ROOT}/`),
  })
  return { session: created, calls: fake.calls, backend }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))
const ops = (calls: Call[]) => calls.map((call) => call.op)

describe("monitor session: attach (KTD4)", () => {
  // The production first render: a slug-only request with no documentId.
  it("attaches the first stream once with the slug and no video id", async () => {
    const { session: s, calls } = session()
    s.onStream(ENGLISH, watch())
    await flush()
    expect(ops(calls)).toEqual(["attach"])
    const first = calls[0] as Extract<Call, { op: "attach" }>
    expect(first.data).toEqual({
      player_name: "forge-mobile-watch",
      viewer_user_id: VIEWER,
      custom_1: "streamed",
      custom_2: "jesus",
      video_source_url: ENGLISH,
    })
  })

  it("does not attach when the viewer id resolves after release", async () => {
    const id = deferred<string>()
    const { session: s, calls } = session({ viewerId: id.promise })
    s.onStream(ENGLISH, watch())
    s.release()
    id.resolve(VIEWER)
    await flush()
    expect(calls).toEqual([])
  })

  it("binds only the second stream when the viewer id resolves after it entered", async () => {
    const id = deferred<string>()
    const { session: s, calls } = session({ viewerId: id.promise })
    s.onStream(ENGLISH, watch())
    s.onStream(SPANISH, watch({ videoId: "doc-1" }))
    id.resolve(VIEWER)
    await flush()
    expect(ops(calls)).toEqual(["attach"])
    const first = calls[0] as Extract<Call, { op: "attach" }>
    expect(first.data.video_source_url).toBe(SPANISH)
    expect(first.data.video_id).toBe("doc-1")
  })

  it("does not attach when an unmonitored stream entered before the id resolved", async () => {
    const id = deferred<string>()
    const { session: s, calls } = session({ viewerId: id.promise })
    s.onStream(ENGLISH, watch())
    s.onStream(TRAILER, null)
    id.resolve(VIEWER)
    await flush()
    expect(calls).toEqual([])
  })

  it("attaches a later stream before its load once the id was read", async () => {
    const { session: s, calls } = session()
    s.onStream(TRAILER, null)
    await flush()
    s.onStream(EPISODE, watch({ videoId: "doc-3", videoSlug: "episode-1" }))
    // Synchronous: the caller starts the load right after this returns.
    expect(ops(calls)).toEqual(["attach"])
  })

  it("passes the latest player size into the attach", async () => {
    const { session: s, calls } = session()
    s.setPlayerSize({ width: 390, height: 219 })
    s.onStream(ENGLISH, watch())
    await flush()
    expect(calls[0]).toMatchObject({
      op: "attach",
      size: { width: 390, height: 219 },
    })
  })
})

describe("monitor session: view boundaries (KTD5)", () => {
  async function attached() {
    const made = session()
    made.session.onStream(ENGLISH, watch({ videoId: "doc-1" }))
    await flush()
    made.calls.length = 0
    return made
  }

  it("stages each of three quick swaps and opens one view, for the last", async () => {
    const { session: s, calls } = await attached()
    const settleFirst = s.onStream(SPANISH, watch({ videoId: "doc-1" }))
    const settleSecond = s.onStream(FRENCH, watch({ videoId: "doc-1" }))
    const settleThird = s.onStream(ENGLISH_LOW, watch({ videoId: "doc-1" }))
    settleFirst()
    settleSecond()
    settleThird()
    expect(ops(calls)).toEqual(["stage", "stage", "stage", "startView"])
    const staged = calls
      .filter((call) => call.op === "stage")
      .map((call) => (call as { data: MuxViewData }).data.video_source_url)
    expect(staged).toEqual([SPANISH, FRENCH, ENGLISH_LOW])
  })

  // A settle that arrives after a newer swap must not open the newer view early.
  it("opens no view for a superseded swap that settles last", async () => {
    const { session: s, calls } = await attached()
    const settleFirst = s.onStream(SPANISH, watch({ videoId: "doc-1" }))
    const settleSecond = s.onStream(FRENCH, watch({ videoId: "doc-1" }))
    settleSecond()
    settleFirst()
    expect(ops(calls)).toEqual(["stage", "stage", "startView"])
  })

  it("sends a late id to the open view without a new view", async () => {
    const { session: s, calls } = session()
    s.onStream(ENGLISH, watch())
    await flush()
    calls.length = 0
    s.onStream(null, watch({ videoId: "doc-1", title: "Jesus" }))
    expect(ops(calls)).toEqual(["updateView"])
    expect(calls[0]).toMatchObject({
      data: { video_id: "doc-1", video_title: "Jesus", custom_2: "jesus" },
    })
  })

  // A seed-path open: B's record lands while its replaceAsync is in flight.
  // Until the settle, the open view on Android and JS is still A's (KTD5).
  it("sends a late id inside a swap window to the new view, not the open one", async () => {
    const { session: s, calls } = await attached()
    const settle = s.onStream(EPISODE, watch({ videoSlug: "episode-1" }))
    s.onStream(
      null,
      watch({ videoId: "doc-3", videoSlug: "episode-1", title: "Episode" }),
    )
    expect(ops(calls)).toEqual(["stage"])

    settle()

    expect(ops(calls)).toEqual(["stage", "startView", "updateView"])
    expect(calls[2]).toMatchObject({
      data: {
        video_id: "doc-3",
        video_title: "Episode",
        custom_2: "episode-1",
        video_source_url: EPISODE,
      },
    })
  })

  it("sends a late title inside a dub swap window to the new view", async () => {
    const { session: s, calls } = await attached()
    const settle = s.onStream(SPANISH, watch({ videoId: "doc-1" }))
    s.onStream(null, watch({ videoId: "doc-1", title: "Jesus" }))
    settle()

    expect(ops(calls)).toEqual(["stage", "startView", "updateView"])
    expect(calls[2]).toMatchObject({
      data: { video_title: "Jesus", video_source_url: SPANISH },
    })
  })

  it("changes the size without a new view", async () => {
    const { session: s, calls } = await attached()
    s.setPlayerSize({ width: 160, height: 90 })
    s.setPlayerSize({ width: 160, height: 90 })
    expect(calls).toEqual([
      { op: "setPlayerSize", size: { width: 160, height: 90 } },
    ])
  })

  it("starts one new view for an error reload, with the URL that it loads", async () => {
    const { session: s, calls } = session()
    s.onStream(ENGLISH_LOW, watch({ videoId: "doc-1" }))
    await flush()
    calls.length = 0
    s.onStream(ENGLISH, watch({ videoId: "doc-1" }), true)()
    expect(ops(calls)).toEqual(["stage", "startView"])
    expect(calls[0]).toMatchObject({ data: { video_source_url: ENGLISH } })
  })
})

describe("monitor session: unmonitored and downloaded streams", () => {
  it("detaches before the trailer loads and attaches before the episode loads", async () => {
    const { session: s, calls } = session()
    s.onStream(ENGLISH, watch({ videoId: "doc-1" }))
    await flush()
    s.onStream(TRAILER, null)
    s.onStream(EPISODE, watch({ videoId: "doc-3", videoSlug: "episode-1" }))
    await flush()
    expect(ops(calls)).toEqual(["attach", "release", "attach"])
    expect(calls[2]).toMatchObject({
      data: { video_id: "doc-3", custom_2: "episode-1" },
    })
  })

  // The trailer's settle must not open a view on the episode's new monitor.
  it("opens no view on a later monitor from an earlier swap's settle", async () => {
    const { session: s, calls } = session()
    s.onStream(ENGLISH, watch({ videoId: "doc-1" }))
    await flush()
    const settleDub = s.onStream(SPANISH, watch({ videoId: "doc-1" }))
    s.onStream(TRAILER, null)
    s.onStream(EPISODE, watch({ videoId: "doc-3", videoSlug: "episode-1" }))
    await flush()
    settleDub()
    expect(ops(calls)).not.toContain("startView")
  })

  it("keeps the monitor when the option is lost with no URL", async () => {
    const { session: s, calls } = session()
    s.onStream(ENGLISH, watch({ videoId: "doc-1" }))
    await flush()
    s.onStream(null, null)
    expect(ops(calls)).toEqual(["attach"])
  })

  it("detaches for a download and attaches again for the stream, with downloads off", async () => {
    const { backend, calls } = fakeBackend({ downloadedPlaysMonitored: false })
    const { session: s } = session({ backend })
    s.onStream(ENGLISH, watch({ videoId: "doc-1" }))
    await flush()
    s.onStream(DOWNLOAD, watch({ videoId: "doc-1" }))()
    s.onStream(ENGLISH, watch({ videoId: "doc-1" }))()
    await flush()
    expect(ops(calls)).toEqual(["attach", "release", "attach"])
  })

  it("starts a downloaded view with the marker and no path, with downloads on", async () => {
    const { session: s, calls } = session()
    s.onStream(ENGLISH, watch({ videoId: "doc-1" }))
    await flush()
    s.onStream(DOWNLOAD, watch({ videoId: "doc-1" }))()
    expect(ops(calls)).toEqual(["attach", "stage", "startView"])
    const staged = (calls[1] as { data: MuxViewData }).data
    expect(staged.custom_1).toBe("downloaded")
    expect(JSON.stringify(staged)).not.toContain("file://")
  })
})

describe("monitor session: release and faults (R27, AE9)", () => {
  it("releases the monitor once, without touching the player", async () => {
    const { session: s, calls } = session()
    s.onStream(ENGLISH, watch({ videoId: "doc-1" }))
    await flush()
    expect(() => {
      s.release()
      s.release()
    }).not.toThrow()
    expect(ops(calls)).toEqual(["attach", "release"])
  })

  it("does nothing after release", async () => {
    const { session: s, calls } = session()
    s.onStream(ENGLISH, watch({ videoId: "doc-1" }))
    await flush()
    s.release()
    s.onStream(SPANISH, watch({ videoId: "doc-1" }))()
    s.setPlayerSize({ width: 1, height: 1 })
    expect(ops(calls)).toEqual(["attach", "release"])
  })

  it("contains a monitor that throws on every call", async () => {
    const thrower = () => {
      throw new Error("native fault")
    }
    const backend: MuxMonitorBackend = {
      downloadedPlaysMonitored: true,
      seesNativeControlSeeks: true,
      attach: () => ({
        stage: thrower,
        updateView: thrower,
        startView: thrower,
        setPlayerSize: thrower,
        release: thrower,
      }),
    }
    const { session: s } = session({ backend })
    s.onStream(ENGLISH, watch())
    await flush()
    expect(() => {
      s.onStream(null, watch({ videoId: "doc-1" }))
      s.onStream(SPANISH, watch({ videoId: "doc-1" }))()
      s.setPlayerSize({ width: 2, height: 2 })
      s.release()
    }).not.toThrow()
  })

  it("contains an attach that throws and a viewer id that rejects", async () => {
    const backend: MuxMonitorBackend = {
      downloadedPlaysMonitored: true,
      seesNativeControlSeeks: true,
      attach: () => {
        throw new Error("native fault")
      },
    }
    const attachFault = session({ backend }).session
    expect(() => attachFault.onStream(ENGLISH, watch())).not.toThrow()
    await flush()

    const idFault = session({ viewerId: Promise.reject(new Error("storage")) })
    expect(() => idFault.session.onStream(ENGLISH, watch())).not.toThrow()
    await flush()
    expect(idFault.calls).toEqual([])
  })

  it("contains a fault in its own planning, so a swap still loads", () => {
    const created = createMonitorSession(player, {
      config: {
        envKey: "k0abc123",
        playerNames: {
          watch: "forge-mobile-watch",
          experience: "forge-mobile-experience",
          explore: "forge-mobile-explore",
        },
      },
      // Downloads off, so the planner must call the classifier.
      backend: fakeBackend({ downloadedPlaysMonitored: false }).backend,
      getViewerId: () => Promise.resolve(VIEWER),
      isLocal: () => {
        throw new Error("classifier fault")
      },
    })
    let settle: () => void = () => {}
    expect(() => {
      settle = created.onStream(ENGLISH, watch())
    }).not.toThrow()
    expect(() => settle()).not.toThrow()
  })
})

describe("createMuxMonitorSession (KTD3)", () => {
  afterEach(() => {
    mockResolvedBackend = null
    delete mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY
  })

  // A valid key ships before any backend: nothing may reach Mux then.
  it("creates no session for a valid key while no backend exists", () => {
    mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY = "k0abc123"
    expect(createMuxMonitorSession(player)).toBeNull()
  })

  it("creates no session without a key, even with a backend", () => {
    mockResolvedBackend = fakeBackend().backend
    expect(createMuxMonitorSession(player)).toBeNull()
  })

  // R20 fails closed: a file URL outside the offline root is still local.
  it("treats any URL that is not http(s) as a download", async () => {
    mockEnv.EXPO_PUBLIC_MUX_DATA_ENV_KEY = "k0abc123"
    const fake = fakeBackend({ downloadedPlaysMonitored: false })
    mockResolvedBackend = fake.backend
    const created = createMuxMonitorSession(player)
    created?.onStream("file:///private/var/tmp/clip.mp4", watch())
    await flush()
    expect(fake.calls).toEqual([])

    created?.onStream(ENGLISH, watch())
    await flush()
    expect(ops(fake.calls)).toEqual(["attach"])
  })
})
