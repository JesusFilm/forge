/**
 * The provider's own wiring — the part no pure test can reach. Every decision
 * it composes (reconcile, planExportSweep, the fence) is unit-tested in
 * `src/lib/`; what is untested there is whether this provider CALLS them with
 * what it fetched, and whether its ref-mutating fence effect survives a
 * StrictMode remount (see apps/mobile/CLAUDE.md and the repo's
 * react-strictmode-remount-safety note).
 *
 * The renderer is jest-expo's own transitive react-test-renderer, driven
 * through `src/test-utils/rnTestRenderer.ts` (no new test dependencies).
 * StrictMode arrives by wrapping the rendered ELEMENT, which is what doubles
 * the effect cycle.
 */

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///docs/",
}))

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>()
  return {
    __esModule: true,
    __storage: store,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value)
      }),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key)
      }),
      multiSet: jest.fn(async (pairs: [string, string][]) => {
        for (const [key, value] of pairs) store.set(key, value)
      }),
    },
  }
})

jest.mock("../../lib/downloadEngine", () => ({
  configureDownloadEngine: jest.fn(),
  listExistingDownloadTasks: jest.fn(async () => []),
  notifyIosBackgroundComplete: jest.fn(),
  pauseTask: jest.fn(async () => undefined),
  resumeTask: jest.fn(async () => undefined),
  startMediaDownload: jest.fn(),
  stopTask: jest.fn(async () => undefined),
  wireExistingTask: jest.fn(),
}))

jest.mock("../../lib/offlineFileSystem", () => ({
  OFFLINE_ROOT: "file:///docs/offline-downloads",
  downloadToFile: jest.fn(async () => undefined),
  ensureVideoDir: jest.fn(async () => "file:///docs/offline-downloads/x"),
  fileExists: jest.fn(async () => false),
  freeDiskBytes: jest.fn(async () => 10 ** 12),
  listDirectory: jest.fn(async () => [] as string[]),
  moveFile: jest.fn(async () => undefined),
  removeUri: jest.fn(async () => undefined),
  removeVideoDir: jest.fn(async () => undefined),
}))

// A driveable stand-in for the module singleton: `state` is mutated by tests
// and `__notify` fires the fence's subscription.
jest.mock("../../lib/exportSession", () => {
  const listeners = new Set<() => void>()
  const state = {
    activeCount: 0,
    targets: new Set<string>(),
    notes: [] as unknown[],
  }
  const store = {
    getSnapshot: () => ({
      byTarget: {},
      activeCount: state.activeCount,
      targets: state.targets,
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    listStagingNotes: jest.fn(async () => state.notes),
  }
  return {
    getExportSessionStore: () => store,
    __sessionState: state,
    __notify: () => {
      for (const listener of Array.from(listeners)) listener()
    },
    __listenerCount: () => listeners.size,
    // A test that fails before its unmount leaves a provider — and its fence —
    // subscribed, which would then fail the NEXT test's listener count.
    __resetListeners: () => listeners.clear(),
  }
})

jest.mock("../../lib/rawExportRuntime", () => {
  const adapter = {
    discardStagedExport: jest.fn(async () => undefined),
  }
  return {
    attachRawExportRuntime: jest.fn(),
    getRawExportAdapter: jest.fn(() => adapter),
    __adapter: adapter,
  }
})

// planExportSweep and createEngineConfigFence stay REAL — they are the
// decisions under composition. Only the effectful apply is captured.
jest.mock("../../lib/exportSweep", () => ({
  ...jest.requireActual("../../lib/exportSweep"),
  applyExportSweep: jest.fn(async () => undefined),
}))

jest.mock("../../lib/apolloClient", () => ({
  getApolloClient: () => ({ query: jest.fn() }),
}))

jest.mock("../../lib/datadog", () => ({
  datadogLog: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

jest.mock("../WatchPreferencesProvider", () => {
  const state = { wifiOnly: false }
  return {
    useWatchPreferences: () => ({
      audioLanguageSlug: null,
      subtitleLanguageSlug: null,
      subtitleLanguageName: null,
      subtitlesEnabled: false,
      wifiOnly: state.wifiOnly,
      isReady: true,
    }),
    __prefState: state,
  }
})

import { StrictMode, act } from "react"

import { DownloadsProvider } from "../DownloadsProvider"
import type { ExportStagingNote } from "../../lib/exportSession"
import type { ExportSweepEffects } from "../../lib/exportSweep"
import {
  OFFLINE_INDEX_STORAGE_KEY,
  offlineRecordKey,
  serializeOfflineIndex,
  serializeOfflineRecord,
  type OfflineDownloadRecord,
} from "../../lib/offlineManifest"
import {
  TestRenderer,
  type TestInstance,
} from "../../test-utils/rnTestRenderer"

const EXPORT_ROOT = "file:///docs/raw-exports"

const storage = (
  jest.requireMock("@react-native-async-storage/async-storage") as {
    __storage: Map<string, string>
  }
).__storage

const engine = jest.requireMock("../../lib/downloadEngine") as {
  configureDownloadEngine: jest.Mock
  listExistingDownloadTasks: jest.Mock
  stopTask: jest.Mock
  wireExistingTask: jest.Mock
}

const fs = jest.requireMock("../../lib/offlineFileSystem") as {
  fileExists: jest.Mock
  listDirectory: jest.Mock
  removeUri: jest.Mock
}

const session = jest.requireMock("../../lib/exportSession") as {
  __sessionState: {
    activeCount: number
    targets: Set<string>
    notes: ExportStagingNote[]
  }
  __notify: () => void
  __listenerCount: () => number
  __resetListeners: () => void
}

const runtime = jest.requireMock("../../lib/rawExportRuntime") as {
  attachRawExportRuntime: jest.Mock
  __adapter: {
    discardStagedExport: jest.Mock
  }
}

const sweep = jest.requireMock("../../lib/exportSweep") as {
  applyExportSweep: jest.Mock
}

const prefs = jest.requireMock("../WatchPreferencesProvider") as {
  __prefState: { wifiOnly: boolean }
}

function note(
  over: Partial<ExportStagingNote> & { target: string },
): ExportStagingNote {
  return {
    version: 1,
    runId: "run-1",
    stagedPath: `${EXPORT_ROOT}/${over.target}/video.mp4`,
    ...over,
  }
}

function record(
  over: Partial<OfflineDownloadRecord> & { videoSlug: string },
): OfflineDownloadRecord {
  return {
    version: 1,
    dubDocumentId: "dub-1",
    renditionDocumentId: "rend-1",
    qualityLabel: "High",
    title: "A video",
    subtitleLanguageSlug: null,
    state: "downloading",
    committedPath: null,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 0,
    totalBytes: 100,
    ...over,
  }
}

function seedManifest(records: OfflineDownloadRecord[]) {
  storage.set(
    OFFLINE_INDEX_STORAGE_KEY,
    serializeOfflineIndex(records.map((entry) => entry.videoSlug)),
  )
  for (const entry of records) {
    storage.set(
      offlineRecordKey(entry.videoSlug),
      serializeOfflineRecord(entry),
    )
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  storage.clear()
  session.__sessionState.activeCount = 0
  session.__sessionState.targets = new Set()
  session.__sessionState.notes = []
  session.__resetListeners()
  prefs.__prefState.wifiOnly = false
  engine.listExistingDownloadTasks.mockResolvedValue([])
  fs.fileExists.mockResolvedValue(false)
  fs.listDirectory.mockResolvedValue([])
})

function element(strict: boolean) {
  const tree = <DownloadsProvider>{null}</DownloadsProvider>
  return strict ? <StrictMode>{tree}</StrictMode> : tree
}

/** Drain the mount effects' awaits; three turns cover the deepest chain. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function render(strict = false): Promise<TestInstance> {
  let renderer!: TestInstance
  await act(async () => {
    renderer = TestRenderer.create(element(strict))
  })
  await flush()
  return renderer
}

async function unmount(renderer: TestInstance) {
  await act(async () => {
    renderer.unmount()
  })
}

describe("raw-export runtime attachment (R13)", () => {
  it("supplies a record reader that reflects the hydrated manifest", async () => {
    seedManifest([record({ videoSlug: "birth-of-jesus", state: "downloaded" })])
    const renderer = await render()

    expect(runtime.attachRawExportRuntime).toHaveBeenCalledTimes(1)
    const deps = runtime.attachRawExportRuntime.mock.calls[0][0] as {
      findOfflineRecord: (slug: string) => OfflineDownloadRecord | null
    }
    // The reader closes over the live records ref, so it must answer with what
    // hydration read — not the empty map the effect itself ran against.
    expect(deps.findOfflineRecord("birth-of-jesus")?.state).toBe("downloaded")
    expect(deps.findOfflineRecord("no-such-video")).toBeNull()
    await unmount(renderer)
  })
})

describe("engine-config fence (KTD3) under a StrictMode remount", () => {
  it("keeps exactly one live fence subscribed", async () => {
    const renderer = await render(true)
    // Two setups ran; the disposed one must have unsubscribed.
    expect(session.__listenerCount()).toBe(1)
    await unmount(renderer)
    expect(session.__listenerCount()).toBe(0)
  })

  it("holds a wifi-only change while an export runs and applies it once when the last settles", async () => {
    const renderer = await render(true)
    engine.configureDownloadEngine.mockClear()

    session.__sessionState.activeCount = 1
    prefs.__prefState.wifiOnly = true
    await act(async () => {
      renderer.update(element(true))
    })
    await flush()
    // Held: configuring now would recreate the URLSession and kill the export.
    expect(engine.configureDownloadEngine).not.toHaveBeenCalled()

    session.__sessionState.activeCount = 0
    await act(async () => {
      session.__notify()
    })
    expect(engine.configureDownloadEngine).toHaveBeenCalledTimes(1)
    expect(engine.configureDownloadEngine).toHaveBeenCalledWith({
      wifiOnly: true,
    })
    await unmount(renderer)
  })
})

describe("launch export sweep", () => {
  it("composes the sweep from the notes, staged entries and live tasks it fetched", async () => {
    const landed = note({ target: "landed-one" })
    const interrupted = note({ target: "interrupted" })
    session.__sessionState.notes = [landed, interrupted]
    fs.listDirectory.mockResolvedValue([
      "landed-one",
      "interrupted",
      "orphan-dir",
    ])
    const liveTask = { id: "rawexport:interrupted" }
    engine.listExistingDownloadTasks.mockResolvedValue([liveTask])

    const renderer = await render()

    expect(fs.listDirectory).toHaveBeenCalledWith(EXPORT_ROOT)
    expect(sweep.applyExportSweep).toHaveBeenCalledTimes(1)
    const [actions, effects] = sweep.applyExportSweep.mock.calls[0] as [
      unknown[],
      ExportSweepEffects,
    ]
    // Every note is a discard: the folder grant died with the process, so no
    // launch can finish the copy. Whether the staged file landed is not read.
    expect(actions).toEqual([
      { action: "discard", note: landed, stopTaskId: null },
      {
        action: "discard",
        note: interrupted,
        stopTaskId: "rawexport:interrupted",
      },
      { action: "removeStagedDir", target: "orphan-dir" },
    ])
    expect(fs.fileExists).not.toHaveBeenCalled()
    expect(effects.adapter).toBe(runtime.__adapter)

    // The removal re-joins the entry under the root, so a stray name cannot
    // point outside it.
    await effects.removeStagedDir("orphan-dir")
    expect(fs.removeUri).toHaveBeenCalledWith(`${EXPORT_ROOT}/orphan-dir`)
    await effects.stopExportTask("rawexport:interrupted")
    expect(engine.stopTask).toHaveBeenCalledWith(liveTask)
    await unmount(renderer)
  })

  it("builds no adapter when there is nothing to sweep", async () => {
    const renderer = await render()
    expect(sweep.applyExportSweep).not.toHaveBeenCalled()
    await unmount(renderer)
  })

  it("stops before applying when the provider unmounts mid-fetch", async () => {
    session.__sessionState.notes = [note({ target: "slow-one" })]
    let releaseListing!: (entries: string[]) => void
    fs.listDirectory.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          releaseListing = resolve
        }),
    )

    const renderer = await render()
    expect(sweep.applyExportSweep).not.toHaveBeenCalled()

    await unmount(renderer)
    await act(async () => {
      releaseListing(["slow-one"])
    })
    await flush()

    expect(sweep.applyExportSweep).not.toHaveBeenCalled()
  })

  it("reports itself cancelled to an apply already in flight", async () => {
    session.__sessionState.notes = [note({ target: "landed-one" })]
    fs.listDirectory.mockResolvedValue(["landed-one"])

    const renderer = await render()
    const effects = sweep.applyExportSweep.mock
      .calls[0][1] as ExportSweepEffects
    expect(effects.isCancelled?.()).toBe(false)

    await unmount(renderer)
    expect(effects.isCancelled?.()).toBe(true)
  })
})

describe("cold-start phases", () => {
  it("sweeps the export staging root without waiting for the offline reattach", async () => {
    // The two phases share only `tasks`/`liveTaskSlugs`, computed before either
    // starts. A stalled reattach must not hold the unfinished-export report and
    // the staged-file cleanup for the whole session.
    const stalled = record({
      videoSlug: "stalled-download",
      pendingPath: "file:///docs/offline-downloads/stalled-download/a.pending",
    })
    seedManifest([stalled])
    const landed = note({ target: "landed-one" })
    session.__sessionState.notes = [landed]
    fs.listDirectory.mockResolvedValue(["landed-one"])
    // Only the reattach reads file presence, so a hang here stalls it alone.
    fs.fileExists.mockImplementation(() => new Promise<boolean>(() => {}))

    const renderer = await render()

    expect(sweep.applyExportSweep).toHaveBeenCalledTimes(1)
    expect(sweep.applyExportSweep.mock.calls[0][0]).toEqual([
      { action: "discard", note: landed, stopTaskId: null },
    ])
    await unmount(renderer)
  })
})
