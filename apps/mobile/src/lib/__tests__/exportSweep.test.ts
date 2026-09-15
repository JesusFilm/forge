import { documentDirectory } from "expo-file-system/legacy"

import type { ExportReportSignal } from "../../components/ExportReportHost"
import { reconcile, type ReconcileAction } from "../downloadReconciliation"
import {
  createExportSessionStore,
  EXPORT_STAGING_NOTE_VERSION,
  EXPORT_STAGING_NOTES_STORAGE_KEY,
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
  RawExportTransferReport,
  RawExportTransferSpec,
} from "../rawExport"
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
    version: EXPORT_STAGING_NOTE_VERSION,
    target: SLUG,
    runId: "run-1",
    stagedPath: STAGED,
    ...overrides,
  }
}

/**
 * A note the photo-library build wrote. `transferFinished` once selected a
 * "finish" action. The type dropped the field, so the helper asserts the shape.
 */
function legacyNote(overrides: Partial<ExportStagingNote> = {}) {
  return {
    ...note({ version: 1, ...overrides }),
    albumIntent: "album",
    transferFinished: true,
  } as ExportStagingNote
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
      discardStagedExport: async (staged) => {
        calls.push(`discard:${staged.target}`)
        return "abandoned"
      },
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
  it("AE13: discards a surviving note, and removes its directory only once", () => {
    const interrupted = note()

    const actions = planExportSweep({
      notes: [interrupted],
      stagedEntries: [SLUG],
      liveTaskIds: new Set(),
    })

    // `discard` deletes the directory itself, so the orphan pass must not queue
    // a second removal for the same target.
    expect(actions).toEqual([
      { action: "discard", note: interrupted, stopTaskId: null },
    ])
  })

  it("names the surviving export task so the sweep can stop it first", () => {
    const interrupted = note()

    const actions = planExportSweep({
      notes: [interrupted],
      stagedEntries: [SLUG],
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

  it("discards a legacy note that recorded a finished transfer", () => {
    // The folder grant died with the process that staged the bytes, so there
    // is nowhere to finish the copy — the old "finish" action has no successor.
    const finished = legacyNote()

    const actions = planExportSweep({
      notes: [finished],
      stagedEntries: [SLUG],
      liveTaskIds: new Set(),
    })

    expect(actions).toEqual([
      { action: "discard", note: finished, stopTaskId: null },
    ])
  })

  it("discards a note whose directory never landed, and stops its task", () => {
    // The kill-before-the-first-byte case: the run wrote the note, but the
    // engine had not made the directory yet. A silent drop would leave a
    // surviving native task with nothing that tracks it.
    const stale = note()

    const actions = planExportSweep({
      notes: [stale],
      stagedEntries: [],
      liveTaskIds: new Set([buildExportTaskId(SLUG)]),
    })

    expect(actions).toEqual([
      { action: "discard", note: stale, stopTaskId: buildExportTaskId(SLUG) },
    ])
  })

  it("discards a note whose directory never landed, with no live task", () => {
    const stale = note()

    const actions = planExportSweep({
      notes: [stale],
      stagedEntries: [],
      liveTaskIds: new Set(),
    })

    expect(actions).toEqual([
      { action: "discard", note: stale, stopTaskId: null },
    ])
  })

  it("deletes a staged directory that no note claims", () => {
    const kept = note()

    const actions = planExportSweep({
      notes: [kept],
      stagedEntries: [SLUG, OTHER],
      liveTaskIds: new Set(),
    })

    expect(actions).toEqual([
      { action: "discard", note: kept, stopTaskId: null },
      { action: "removeStagedDir", target: OTHER },
    ])
  })

  it("deletes every orphan directory when there are no notes at all", () => {
    const actions = planExportSweep({
      notes: [],
      stagedEntries: [SLUG, OTHER],
      liveTaskIds: new Set(),
    })

    expect(actions).toEqual([
      { action: "removeStagedDir", target: SLUG },
      { action: "removeStagedDir", target: OTHER },
    ])
  })

  it("matches a directory entry against the SANITIZED target", () => {
    // `sanitizeSegment` names the staging directory, so a target that sanitizes
    // would otherwise read as an unclaimed directory and get a second removal.
    const odd = note({ target: "a/b c" })

    const actions = planExportSweep({
      notes: [odd],
      stagedEntries: ["a_b_c"],
      liveTaskIds: new Set(),
    })

    expect(actions).toEqual([
      { action: "discard", note: odd, stopTaskId: null },
    ])
  })

  it("sweeps every note, not just the first", () => {
    const one = note({ target: SLUG })
    const two = note({ target: OTHER, runId: "run-2" })

    const actions = planExportSweep({
      notes: [one, two],
      stagedEntries: [SLUG, OTHER],
      liveTaskIds: new Set([buildExportTaskId(OTHER)]),
    })

    expect(actions).toEqual([
      { action: "discard", note: one, stopTaskId: null },
      { action: "discard", note: two, stopTaskId: buildExportTaskId(OTHER) },
    ])
  })
})

describe("applyExportSweep", () => {
  it("routes each action to its own effect", async () => {
    const interrupted = note({ target: OTHER })
    const { calls, effects } = recordingEffects()

    await applyExportSweep(
      [
        { action: "discard", note: interrupted, stopTaskId: null },
        { action: "removeStagedDir", target: "orphan" },
      ],
      effects,
    )

    expect(calls).toEqual([`discard:${OTHER}`, "removeDir:orphan"])
  })

  it("stops a surviving transfer BEFORE it removes the stage", async () => {
    const interrupted = note()
    const taskId = buildExportTaskId(SLUG)
    const { calls, effects } = recordingEffects()

    await applyExportSweep(
      [{ action: "discard", note: interrupted, stopTaskId: taskId }],
      effects,
    )

    expect(calls).toEqual([`stop:${taskId}`, `discard:${SLUG}`])
  })

  it("keeps sweeping after a discard throws", async () => {
    const { calls, effects } = recordingEffects({
      adapter: {
        discardStagedExport: async () => {
          throw new Error("storage fault")
        },
      },
    })

    await applyExportSweep(
      [
        { action: "discard", note: note(), stopTaskId: null },
        { action: "removeStagedDir", target: "orphan" },
      ],
      effects,
    )

    expect(calls).toEqual(["removeDir:orphan"])
  })

  it("keeps sweeping after an orphan removal throws", async () => {
    const { calls, effects } = recordingEffects({
      removeStagedDir: async (target) => {
        if (target === "orphan") throw new Error("storage fault")
        calls.push(`removeDir:${target}`)
      },
    })

    await applyExportSweep(
      [
        { action: "removeStagedDir", target: "orphan" },
        { action: "discard", note: note(), stopTaskId: null },
      ],
      effects,
    )

    expect(calls).toEqual([`discard:${SLUG}`])
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

function memoryStorage() {
  const values = new Map<string, string>()
  const port: ExportStoragePort = {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => {
      values.set(key, value)
    },
    remove: async (key) => {
      values.delete(key)
    },
  }
  return { port, values }
}

function adapterHarness(seedFiles: Record<string, string>) {
  const files = new Map<string, string>(Object.entries(seedFiles))
  const reports: ExportReportSignal[] = []
  const storage = memoryStorage()
  const store = createExportSessionStore({ storage: storage.port })

  const destination = {
    pickFolder: jest.fn(async () => ({
      uri: "content://tree/primary%3ADownload",
    })),
    listNames: jest.fn(async (): Promise<readonly string[]> => []),
    copyInto: jest.fn(async () => undefined),
    removeIfExists: jest.fn(async () => undefined),
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
      pauseExportTransfer: jest.fn(async () => true),
      resumeExportTransfer: jest.fn(async () => true),
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
    destination,
    findOfflineRecord: () => null,
    report: (signal) => reports.push(signal),
    session: store,
  })

  const effects: ExportSweepEffects = {
    adapter,
    removeStagedDir: async (target) => {
      files.delete(exportStagingDir(ROOT, target))
    },
    stopExportTask: async () => undefined,
  }

  return { adapter, destination, effects, files, reports, storage, store }
}

describe("the sweep composed with the real export adapter", () => {
  it("AE13: deletes the partial stage and reports it unfinished", async () => {
    const h = adapterHarness({ [STAGED]: "partial-bytes" })
    const interrupted = note()

    await applyExportSweep(
      planExportSweep({
        notes: [interrupted],
        stagedEntries: [SLUG],
        liveTaskIds: new Set(),
      }),
      h.effects,
    )

    expect(h.files.has(STAGED)).toBe(false)
    expect(h.destination.copyInto).not.toHaveBeenCalled()
    expect(h.destination.pickFolder).not.toHaveBeenCalled()
    expect(h.reports).toEqual([
      { runId: "run-1", target: SLUG, outcome: "abandoned" },
    ])
  })

  it("discards a finished stage the photo-library build left, and never asks for a folder", async () => {
    // The v1 note carries `transferFinished: true`, which the old sweep
    // completed into the library. The store still reads v1, so this build can
    // remove those files. The sweep has no folder to copy them into.
    const h = adapterHarness({ [STAGED]: "whole-bytes" })
    h.storage.values.set(
      EXPORT_STAGING_NOTES_STORAGE_KEY,
      JSON.stringify({ [SLUG]: legacyNote() }),
    )
    const notes = await h.store.listStagingNotes()
    expect(notes).toHaveLength(1)

    await applyExportSweep(
      planExportSweep({
        notes,
        stagedEntries: [SLUG],
        liveTaskIds: new Set(),
      }),
      h.effects,
    )

    expect(h.destination.pickFolder).not.toHaveBeenCalled()
    expect(h.destination.copyInto).not.toHaveBeenCalled()
    expect(h.files.has(STAGED)).toBe(false)
    expect(await h.store.listStagingNotes()).toEqual([])
    expect(h.reports).toEqual([
      { runId: "run-1", target: SLUG, outcome: "abandoned" },
    ])
  })

  it("clears a note whose stage is gone from storage, and reports it abandoned", async () => {
    const h = adapterHarness({})
    await h.store.writeStagingNote({
      target: SLUG,
      runId: "run-1",
      stagedPath: STAGED,
    })
    const notes = await h.store.listStagingNotes()

    await applyExportSweep(
      planExportSweep({
        notes,
        stagedEntries: [],
        liveTaskIds: new Set(),
      }),
      h.effects,
    )

    expect(await h.store.listStagingNotes()).toEqual([])
    expect(h.destination.copyInto).not.toHaveBeenCalled()
    expect(h.reports).toEqual([
      { runId: "run-1", target: SLUG, outcome: "abandoned" },
    ])
  })

  it("folds a series note's runSize into the abandoned report", async () => {
    const h = adapterHarness({ [STAGED]: "partial-bytes" })
    const interrupted = note({ runSize: 5 })

    await applyExportSweep(
      planExportSweep({
        notes: [interrupted],
        stagedEntries: [SLUG],
        liveTaskIds: new Set(),
      }),
      h.effects,
    )

    expect(h.reports).toEqual([
      { runId: "run-1", target: SLUG, outcome: "abandoned", runSize: 5 },
    ])
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
