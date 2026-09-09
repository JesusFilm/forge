import { documentDirectory } from "expo-file-system/legacy"

import type { ExportReportSignal } from "../../components/ExportReportHost"
import { reconcile, type ReconcileAction } from "../downloadReconciliation"
import {
  createExportSessionStore,
  type ExportOutcome,
  type ExportStagingNote,
  type ExportStoragePort,
} from "../exportSession"
import {
  applyExportSweep,
  createEngineConfigFence,
  planExportSweep,
  type ExportSweepEffects,
} from "../exportSweep"
import { OFFLINE_ROOT, offlineVideoDir } from "../offlineFileSystem"
import type { OfflineDownloadRecord } from "../offlineManifest"
import type {
  LibraryPermissionResponse,
  RawExportTransferReport,
  RawExportTransferSpec,
} from "../rawExport"
import { RAW_EXPORT_ENABLED } from "../rawExportConstants"
import { createRawExportAdapter } from "../rawExportAdapter"
import {
  buildExportRoot,
  buildExportTaskId,
  exportStagingDir,
  isUnderExportRoot,
} from "../transferPort"

const ROOT = buildExportRoot("file:///docs/")
const SLUG = "the-birth-of-jesus"
const OTHER = "the-good-samaritan"
const STAGED = `${ROOT}/${SLUG}/The_Birth_of_Jesus.mp4`

function note(overrides: Partial<ExportStagingNote> = {}): ExportStagingNote {
  return {
    version: 1,
    target: SLUG,
    runId: "run-1",
    stagedPath: STAGED,
    albumIntent: "album",
    transferFinished: false,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** Every effect records its call, so the plan-to-effect mapping is observable. */
function recordingEffects(overrides: Partial<ExportSweepEffects> = {}) {
  const calls: string[] = []
  const effects: ExportSweepEffects = {
    adapter: {
      completeStagedExport: async (staged) => {
        calls.push(`finish:${staged.target}`)
        return "saved"
      },
      discardStagedExport: async (staged) => {
        calls.push(`discard:${staged.target}`)
        return "abandoned"
      },
    },
    clearStagingNote: async (target) => {
      calls.push(`clearNote:${target}`)
    },
    removeStagedDir: async (target) => {
      calls.push(`removeDir:${target}`)
    },
    stopExportTask: async (taskId) => {
      calls.push(`stop:${taskId}`)
    },
    ...overrides,
  }
  return { calls, effects }
}

describe("planExportSweep", () => {
  it("AE13: discards a stage the transfer never finished, with no live task", () => {
    const interrupted = note({ transferFinished: false })

    const actions = planExportSweep({
      notes: [interrupted],
      stagedEntries: [SLUG],
      existingStagedFiles: new Set([SLUG]),
      liveTaskIds: new Set(),
    })

    expect(actions).toEqual([
      { action: "discard", note: interrupted, stopTaskId: null },
    ])
  })

  it("names the surviving export task so the sweep can stop it first", () => {
    const interrupted = note({ transferFinished: false })

    const actions = planExportSweep({
      notes: [interrupted],
      stagedEntries: [SLUG],
      existingStagedFiles: new Set([SLUG]),
      liveTaskIds: new Set([buildExportTaskId(SLUG), OTHER]),
    })

    expect(actions).toEqual([
      {
        action: "discard",
        note: interrupted,
        stopTaskId: buildExportTaskId(SLUG),
      },
    ])
  })

  it("AE16: finishes a stage whose transfer completed", () => {
    const finished = note({ transferFinished: true })

    const actions = planExportSweep({
      notes: [finished],
      stagedEntries: [SLUG],
      existingStagedFiles: new Set([SLUG]),
      liveTaskIds: new Set(),
      enabled: true,
    })

    expect(actions).toEqual([{ action: "finish", note: finished }])
  })

  it("discards rather than finishes a completed stage when the switch is off", () => {
    const finished = note({ transferFinished: true })

    const actions = planExportSweep({
      notes: [finished],
      stagedEntries: [SLUG],
      existingStagedFiles: new Set([SLUG]),
      liveTaskIds: new Set(),
      enabled: false,
    })

    expect(actions).toEqual([
      { action: "discard", note: finished, stopTaskId: null },
    ])
  })

  it("reads the build-time switch itself, so no call site can pin the posture", () => {
    const finished = note({ transferFinished: true })
    const input = {
      notes: [finished],
      stagedEntries: [SLUG],
      existingStagedFiles: new Set([SLUG]),
      liveTaskIds: new Set<string>(),
    }

    const withDefault = planExportSweep(input)

    expect(withDefault).toEqual(
      RAW_EXPORT_ENABLED
        ? [{ action: "finish", note: finished }]
        : [{ action: "discard", note: finished, stopTaskId: null }],
    )
    // Anti-vacuous: the assertion above tracks the constant, so prove the
    // opposite posture is reachable through the same input.
    expect(
      planExportSweep({ ...input, enabled: !RAW_EXPORT_ENABLED }),
    ).not.toEqual(withDefault)
  })

  it("drops a note whose staged file is gone, without reporting an outcome", () => {
    const stale = note({ transferFinished: true })

    const actions = planExportSweep({
      notes: [stale],
      stagedEntries: [],
      existingStagedFiles: new Set(),
      liveTaskIds: new Set(),
    })

    expect(actions).toEqual([{ action: "dropNote", target: SLUG }])
  })

  it("removes a staged directory that survived its dropped note", () => {
    const stale = note({ transferFinished: false })

    const actions = planExportSweep({
      notes: [stale],
      stagedEntries: [SLUG],
      existingStagedFiles: new Set(),
      liveTaskIds: new Set(),
    })

    expect(actions).toEqual([
      { action: "dropNote", target: SLUG },
      { action: "removeStagedDir", target: SLUG },
    ])
  })

  it("deletes a staged file that no note claims", () => {
    const kept = note({ transferFinished: true })

    const actions = planExportSweep({
      notes: [kept],
      stagedEntries: [SLUG, OTHER],
      existingStagedFiles: new Set([SLUG]),
      liveTaskIds: new Set(),
      enabled: true,
    })

    expect(actions).toEqual([
      { action: "finish", note: kept },
      { action: "removeStagedDir", target: OTHER },
    ])
  })

  it("matches a directory entry against the SANITIZED target", () => {
    // The staging directory is named by `sanitizeSegment`, so a target that
    // sanitizes would otherwise read as an unclaimed directory and be deleted.
    const odd = note({ target: "a/b c", transferFinished: true })

    const actions = planExportSweep({
      notes: [odd],
      stagedEntries: ["a_b_c"],
      existingStagedFiles: new Set(["a/b c"]),
      liveTaskIds: new Set(),
      enabled: true,
    })

    expect(actions).toEqual([{ action: "finish", note: odd }])
  })

  it("sweeps every note, not just the first", () => {
    const one = note({ target: SLUG, transferFinished: true })
    const two = note({ target: OTHER, runId: "run-2", transferFinished: false })

    const actions = planExportSweep({
      notes: [one, two],
      stagedEntries: [SLUG, OTHER],
      existingStagedFiles: new Set([SLUG, OTHER]),
      liveTaskIds: new Set(),
      enabled: true,
    })

    expect(actions).toEqual([
      { action: "finish", note: one },
      { action: "discard", note: two, stopTaskId: null },
    ])
  })
})

describe("applyExportSweep", () => {
  it("routes each action to its own effect", async () => {
    const finished = note({ target: SLUG, transferFinished: true })
    const interrupted = note({ target: OTHER, transferFinished: false })
    const { calls, effects } = recordingEffects()

    await applyExportSweep(
      [
        { action: "finish", note: finished },
        { action: "discard", note: interrupted, stopTaskId: null },
        { action: "dropNote", target: "stale" },
        { action: "removeStagedDir", target: "orphan" },
      ],
      effects,
    )

    expect(calls).toEqual([
      `finish:${SLUG}`,
      `discard:${OTHER}`,
      "clearNote:stale",
      "removeDir:orphan",
    ])
  })

  it("stops a surviving transfer BEFORE it removes the stage", async () => {
    const interrupted = note({ transferFinished: false })
    const taskId = buildExportTaskId(SLUG)
    const { calls, effects } = recordingEffects()

    await applyExportSweep(
      [{ action: "discard", note: interrupted, stopTaskId: taskId }],
      effects,
    )

    expect(calls).toEqual([`stop:${taskId}`, `discard:${SLUG}`])
  })

  it("keeps sweeping after one effect throws", async () => {
    const { calls, effects } = recordingEffects({
      clearStagingNote: async () => {
        throw new Error("storage fault")
      },
    })

    await applyExportSweep(
      [
        { action: "dropNote", target: "stale" },
        { action: "removeStagedDir", target: "orphan" },
      ],
      effects,
    )

    expect(calls).toEqual(["removeDir:orphan"])
  })

  it("stops when the launch effect has been cancelled", async () => {
    const { calls, effects } = recordingEffects()
    let cancelled = false

    await applyExportSweep(
      [
        { action: "removeStagedDir", target: "first" },
        { action: "removeStagedDir", target: "second" },
      ],
      {
        ...effects,
        removeStagedDir: async (target) => {
          calls.push(`removeDir:${target}`)
          cancelled = true
        },
        isCancelled: () => cancelled,
      },
    )

    expect(calls).toEqual(["removeDir:first"])
  })
})

// ── Composed against the REAL adapter ───────────────────────────────

const GRANTED: LibraryPermissionResponse = {
  granted: true,
  status: "granted",
  canAskAgain: true,
  accessPrivileges: "addOnly",
}

function memoryStorage(): ExportStoragePort {
  const values = new Map<string, string>()
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value)
    },
    remove: async (key) => {
      values.delete(key)
    },
  }
}

function adapterHarness(seedFiles: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(seedFiles))
  const reports: ExportReportSignal[] = []
  const store = createExportSessionStore({ storage: memoryStorage() })

  const library = {
    getPermission: jest.fn(async () => GRANTED),
    requestPermission: jest.fn(async () => GRANTED),
    saveToLibrary: jest.fn(async () => undefined),
    createAsset: jest.fn(async (uri: string) => ({ id: "asset-1", uri })),
    createAlbum: jest.fn(async () => ({ id: "album-1" })),
  }

  const adapter = createRawExportAdapter({
    exportRoot: ROOT,
    port: {
      runExportTransfer: jest.fn(
        async (
          spec: RawExportTransferSpec,
        ): Promise<RawExportTransferReport> => ({
          kind: "done",
          stagedPath: spec.destination,
          bytesTotal: 1,
        }),
      ),
      stopExportTransfer: jest.fn(async () => undefined),
      signalBackgroundCompletion: jest.fn(),
    },
    fs: {
      ensureDirectory: jest.fn(async () => undefined),
      removeUri: jest.fn(async (uri: string) => {
        for (const key of [...files.keys()]) {
          if (key === uri || key.startsWith(`${uri}/`)) files.delete(key)
        }
      }),
      copyFile: jest.fn(async () => undefined),
      fileExists: jest.fn(async (uri: string) => files.has(uri)),
      freeDiskBytes: jest.fn(async () => 500_000_000_000),
    },
    library,
    platform: "android",
    getAppState: () => "active",
    findOfflineRecord: () => null,
    report: (signal) => reports.push(signal),
    session: store,
  })

  const effects: ExportSweepEffects = {
    adapter,
    clearStagingNote: (target) => store.clearStagingNote(target),
    removeStagedDir: async (target) => {
      files.delete(exportStagingDir(ROOT, target))
    },
    stopExportTask: async () => undefined,
  }

  return { adapter, effects, files, library, reports, store }
}

describe("the sweep composed with the real export adapter", () => {
  it("AE13: deletes the partial stage and reports it unfinished", async () => {
    const h = adapterHarness({ [STAGED]: "partial-bytes" })
    const interrupted = note({ transferFinished: false })

    await applyExportSweep(
      planExportSweep({
        notes: [interrupted],
        stagedEntries: [SLUG],
        existingStagedFiles: new Set([SLUG]),
        liveTaskIds: new Set(),
      }),
      h.effects,
    )

    expect(h.files.has(STAGED)).toBe(false)
    expect(h.library.saveToLibrary).not.toHaveBeenCalled()
    expect(h.library.createAsset).not.toHaveBeenCalled()
    expect(h.reports).toEqual([
      { runId: "run-1", target: SLUG, outcome: "abandoned" },
    ])
  })

  it("AE16: saves a completed stage instead of discarding it", async () => {
    const h = adapterHarness({ [STAGED]: "whole-bytes" })
    const finished = note({ transferFinished: true })

    await applyExportSweep(
      planExportSweep({
        notes: [finished],
        stagedEntries: [SLUG],
        existingStagedFiles: new Set([SLUG]),
        liveTaskIds: new Set(),
        enabled: true,
      }),
      h.effects,
    )

    expect(h.library.createAsset).toHaveBeenCalledWith(STAGED)
    expect(h.reports).toEqual([
      {
        runId: "run-1",
        target: SLUG,
        outcome: "saved",
        albumIntent: "album",
      },
    ])
    expect(h.files.has(STAGED)).toBe(false)
  })

  it("never writes the library for a completed stage when the switch is off", async () => {
    const h = adapterHarness({ [STAGED]: "whole-bytes" })
    const finished = note({ transferFinished: true })

    await applyExportSweep(
      planExportSweep({
        notes: [finished],
        stagedEntries: [SLUG],
        existingStagedFiles: new Set([SLUG]),
        liveTaskIds: new Set(),
        enabled: false,
      }),
      h.effects,
    )

    expect(h.library.createAsset).not.toHaveBeenCalled()
    expect(h.library.saveToLibrary).not.toHaveBeenCalled()
    expect(h.files.has(STAGED)).toBe(false)
    expect(h.reports).toEqual([
      { runId: "run-1", target: SLUG, outcome: "abandoned" },
    ])
  })

  it("drops a stale note from storage without reporting an outcome", async () => {
    const h = adapterHarness({})
    await h.store.writeStagingNote({
      target: SLUG,
      runId: "run-1",
      stagedPath: STAGED,
      albumIntent: "album",
      transferFinished: true,
    })
    const notes = await h.store.listStagingNotes()

    await applyExportSweep(
      planExportSweep({
        notes,
        stagedEntries: [],
        existingStagedFiles: new Set(),
        liveTaskIds: new Set(),
      }),
      h.effects,
    )

    expect(await h.store.listStagingNotes()).toEqual([])
    expect(h.reports).toEqual([])
  })
})

// ── The offline reconciliation path is untouched ────────────────────

function offlineRecord(
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    version: 1,
    videoSlug: SLUG,
    dubDocumentId: "dub-1",
    renditionDocumentId: "rend-high",
    qualityLabel: "High",
    title: "The Birth of Jesus",
    subtitleLanguageSlug: null,
    state: "downloading",
    committedPath: null,
    pendingPath: `${OFFLINE_ROOT}/${SLUG}/.pending-1.mp4`,
    posterPath: null,
    bytesWritten: 10,
    totalBytes: 100,
    ...overrides,
  }
}

/** The provider's per-launch disposition tally, computed the same way. */
function tally(actions: ReconcileAction[]): Record<string, number> {
  return actions.reduce<Record<string, number>>(
    (acc, a) => ({ ...acc, [a.action]: (acc[a.action] ?? 0) + 1 }),
    {},
  )
}

describe("the offline reconciliation path", () => {
  it("reconciles a surviving offline task identically when an export task is live", () => {
    const records = [
      offlineRecord(),
      offlineRecord({
        videoSlug: OTHER,
        state: "downloaded",
        committedPath: `${OFFLINE_ROOT}/${OTHER}/rend-high.mp4`,
        pendingPath: null,
      }),
    ]
    const input = {
      records,
      pendingFileSlugs: new Set([SLUG]),
      committedFileSlugs: new Set([OTHER]),
    }

    const withoutExport = reconcile({
      ...input,
      liveTaskSlugs: new Set([SLUG]),
    })
    const withExport = reconcile({
      ...input,
      // The provider feeds EVERY live task id in, export ids included.
      liveTaskSlugs: new Set([SLUG, buildExportTaskId(OTHER)]),
    })

    expect(withExport).toEqual(withoutExport)
    expect(tally(withExport)).toEqual({ rebind: 1, confirmDownloaded: 1 })
  })
})

describe("the staging root sits outside the offline root", () => {
  it("AE7: removing a video offline directory leaves its staged export intact", () => {
    const exportRoot = buildExportRoot(documentDirectory)
    const stagedPath = `${exportStagingDir(exportRoot, SLUG)}/video.mp4`
    const offlineDir = offlineVideoDir(SLUG)
    const files = new Set([stagedPath, `${offlineDir}/rend-high.mp4`])

    // `removeVideoDir` deletes the whole per-video directory by prefix.
    for (const path of [...files]) {
      if (path === offlineDir || path.startsWith(`${offlineDir}/`)) {
        files.delete(path)
      }
    }

    expect(files.has(stagedPath)).toBe(true)
    expect(isUnderExportRoot(offlineDir, exportRoot)).toBe(false)
    expect(stagedPath.startsWith(`${OFFLINE_ROOT}/`)).toBe(false)
  })
})

// ── KTD3: the engine-config fence ───────────────────────────────────

describe("createEngineConfigFence", () => {
  it("applies a wifi-only change immediately when nothing is exporting", () => {
    const store = createExportSessionStore()
    const applied: boolean[] = []
    const fence = createEngineConfigFence({
      configure: ({ wifiOnly }) => applied.push(wifiOnly),
      session: store,
    })

    fence.setWifiOnly(true)

    expect(applied).toEqual([true])
    fence.dispose()
  })

  it("holds the change while an export is in flight, then applies it", async () => {
    const store = createExportSessionStore()
    const applied: boolean[] = []
    const fence = createEngineConfigFence({
      configure: ({ wifiOnly }) => applied.push(wifiOnly),
      session: store,
    })
    const gate = deferred<ExportOutcome>()

    const run = store.run({ target: SLUG, runId: "run-1" }, () => gate.promise)
    expect(store.getSnapshot().activeCount).toBe(1)

    fence.setWifiOnly(true)
    expect(applied).toEqual([])

    gate.resolve("saved")
    await run

    expect(applied).toEqual([true])
    fence.dispose()
  })

  it("applies only the LAST held value", async () => {
    const store = createExportSessionStore()
    const applied: boolean[] = []
    const fence = createEngineConfigFence({
      configure: ({ wifiOnly }) => applied.push(wifiOnly),
      session: store,
    })
    const gate = deferred<ExportOutcome>()

    const run = store.run({ target: SLUG, runId: "run-1" }, () => gate.promise)
    fence.setWifiOnly(true)
    fence.setWifiOnly(false)
    fence.setWifiOnly(true)
    expect(applied).toEqual([])

    gate.resolve("saved")
    await run

    expect(applied).toEqual([true])
    fence.dispose()
  })

  it("waits for the LAST export of several to settle", async () => {
    const store = createExportSessionStore()
    const applied: boolean[] = []
    const fence = createEngineConfigFence({
      configure: ({ wifiOnly }) => applied.push(wifiOnly),
      session: store,
    })
    const first = deferred<ExportOutcome>()
    const second = deferred<ExportOutcome>()

    const runOne = store.run(
      { target: SLUG, runId: "run-1" },
      () => first.promise,
    )
    const runTwo = store.run(
      { target: OTHER, runId: "run-1" },
      () => second.promise,
    )
    fence.setWifiOnly(true)

    first.resolve("saved")
    await runOne
    expect(applied).toEqual([])

    second.resolve("saved")
    await runTwo
    expect(applied).toEqual([true])
    fence.dispose()
  })

  it("makes no call when an export settles with nothing held", async () => {
    const store = createExportSessionStore()
    const applied: boolean[] = []
    const fence = createEngineConfigFence({
      configure: ({ wifiOnly }) => applied.push(wifiOnly),
      session: store,
    })
    const gate = deferred<ExportOutcome>()

    const run = store.run({ target: SLUG, runId: "run-1" }, () => gate.promise)
    gate.resolve("saved")
    await run

    expect(applied).toEqual([])
    fence.dispose()
  })

  it("contains an engine that is unavailable", () => {
    const store = createExportSessionStore()
    const fence = createEngineConfigFence({
      configure: () => {
        throw new Error("native module missing")
      },
      session: store,
    })

    expect(() => fence.setWifiOnly(true)).not.toThrow()
    fence.dispose()
  })

  it("stops listening once disposed", async () => {
    const store = createExportSessionStore()
    const applied: boolean[] = []
    const fence = createEngineConfigFence({
      configure: ({ wifiOnly }) => applied.push(wifiOnly),
      session: store,
    })
    const gate = deferred<ExportOutcome>()

    const run = store.run({ target: SLUG, runId: "run-1" }, () => gate.promise)
    fence.setWifiOnly(true)
    fence.dispose()

    gate.resolve("saved")
    await run

    expect(applied).toEqual([])
  })
})
