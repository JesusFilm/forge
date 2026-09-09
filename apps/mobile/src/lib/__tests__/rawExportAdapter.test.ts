import type { ExportReportSignal } from "../../components/ExportReportHost"
import {
  createExportSessionStore,
  type ExportStagingNote,
  type ExportStoragePort,
} from "../exportSession"
import type { OfflineDownloadRecord } from "../offlineManifest"
import type {
  LibraryPermissionResponse,
  RawExportRendition,
  RawExportTransferHooks,
  RawExportTransferReport,
  RawExportTransferSpec,
} from "../rawExport"
import { RAW_EXPORT_ALBUM_NAME } from "../rawExportConstants"
import { createRawExportAdapter } from "../rawExportAdapter"
import { buildExportRoot, buildExportTaskId } from "../transferPort"

const ROOT = buildExportRoot("file:///docs/")
const SLUG = "the-birth-of-jesus"
const TITLE = "The Birth of Jesus"
const STAGING_DIR = `${ROOT}/${SLUG}`
const STAGED = `${STAGING_DIR}/The_Birth_of_Jesus.mp4`
const OFFLINE_FILE = `file:///docs/offline-downloads/${SLUG}/rend-high.mp4`
const OFFLINE_BYTES = "offline-bytes"

/** What the engine reports back: the destination it was given, scheme removed. */
function schemeless(uri: string): string {
  return uri.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
}

const RENDITION: RawExportRendition = {
  documentId: "rend-high",
  qualityLabel: "High",
  url: "https://cdn.example/high.mp4",
  sizeBytes: 1_000,
}

const GRANTED: LibraryPermissionResponse = {
  granted: true,
  status: "granted",
  canAskAgain: true,
  accessPrivileges: "addOnly",
}

/**
 * Every gated field is set independently, so a fixture that flips ONE gate
 * cannot fail three at once and pass a test for the wrong reason.
 */
function offlineRecord(
  overrides: Partial<OfflineDownloadRecord> = {},
): OfflineDownloadRecord {
  return {
    version: 1,
    videoSlug: SLUG,
    dubDocumentId: "dub-1",
    renditionDocumentId: "rend-high",
    qualityLabel: "High",
    title: TITLE,
    subtitleLanguageSlug: null,
    state: "downloaded",
    committedPath: OFFLINE_FILE,
    pendingPath: null,
    posterPath: null,
    bytesWritten: 1_000,
    totalBytes: 1_000,
    ...overrides,
  }
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

type HarnessOptions = {
  platform?: "ios" | "android"
  appState?: string
  permission?: LibraryPermissionResponse
  record?: OfflineDownloadRecord | null
  freeBytes?: number
  seedFiles?: Record<string, string>
  transfer?: (
    spec: RawExportTransferSpec,
    hooks: RawExportTransferHooks,
  ) => Promise<RawExportTransferReport>
}

function makeHarness(options: HarnessOptions = {}) {
  const files = new Map<string, string>(Object.entries(options.seedFiles ?? {}))
  const dirs = new Set<string>()
  const order: string[] = []
  const reports: ExportReportSignal[] = []
  const specs: RawExportTransferSpec[] = []
  const store = createExportSessionStore({ storage: memoryStorage() })
  const appState = { value: options.appState ?? "active" }

  const fs = {
    ensureDirectory: jest.fn(async (uri: string) => {
      dirs.add(uri)
    }),
    removeUri: jest.fn(async (uri: string) => {
      dirs.delete(uri)
      for (const key of [...files.keys()]) {
        if (key === uri || key.startsWith(`${uri}/`)) files.delete(key)
      }
    }),
    copyFile: jest.fn(async (from: string, to: string) => {
      const body = files.get(from)
      if (body === undefined) throw new Error(`missing source ${from}`)
      order.push("copy")
      files.set(to, body)
    }),
    fileExists: jest.fn(async (uri: string) => files.has(uri)),
    freeDiskBytes: jest.fn(async () => options.freeBytes ?? 500_000_000_000),
  }

  const library = {
    getPermission: jest.fn(async () => options.permission ?? GRANTED),
    requestPermission: jest.fn(async () => options.permission ?? GRANTED),
    saveToLibrary: jest.fn(async (uri: string) => {
      order.push(`save:${uri}`)
    }),
    createAsset: jest.fn(async (uri: string) => {
      order.push(`asset:${uri}`)
      return { id: "asset-1", uri }
    }),
    createAlbum: jest.fn(async (name: string) => {
      order.push(`album:${name}`)
      return { id: "album-1", title: name }
    }),
  }

  const defaultTransfer = async (
    spec: RawExportTransferSpec,
  ): Promise<RawExportTransferReport> => {
    files.set(spec.destination, "transferred-bytes")
    return { kind: "done", stagedPath: spec.destination, bytesTotal: 1_000 }
  }

  const port = {
    runExportTransfer: jest.fn(
      async (spec: RawExportTransferSpec, hooks: RawExportTransferHooks) => {
        order.push("transfer")
        specs.push(spec)
        return (options.transfer ?? defaultTransfer)(spec, hooks)
      },
    ),
    stopExportTransfer: jest.fn(async () => undefined),
    signalBackgroundCompletion: jest.fn((taskId: string) => {
      order.push(`signal:${taskId}`)
    }),
  }

  const adapter = createRawExportAdapter({
    exportRoot: ROOT,
    port,
    fs,
    library,
    platform: options.platform ?? "android",
    getAppState: () => appState.value,
    findOfflineRecord: () => options.record ?? null,
    report: (signal) => reports.push(signal),
    session: store,
  })

  return {
    adapter,
    appState,
    dirs,
    files,
    fs,
    library,
    order,
    port,
    reports,
    specs,
    store,
    filesUnderRoot: () =>
      [...files.keys()].filter((key) => key.startsWith(`${ROOT}/`)),
  }
}

function exportInput(overrides: Record<string, unknown> = {}) {
  return {
    videoSlug: SLUG,
    runId: "run-1",
    title: TITLE,
    rendition: RENDITION,
    wifiOnly: false,
    ...overrides,
  }
}

describe("a successful export", () => {
  it("transfers, saves into the album, and leaves the export root empty", async () => {
    const h = makeHarness()
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toEqual({
      kind: "settled",
      outcome: "saved",
      albumIntent: "album",
      reused: false,
    })
    expect(h.library.createAsset).toHaveBeenCalledWith(STAGED)
    expect(h.library.createAlbum).toHaveBeenCalledWith(
      RAW_EXPORT_ALBUM_NAME,
      expect.anything(),
      false,
    )
    expect(h.filesUnderRoot()).toEqual([])
    expect(h.reports).toEqual([
      expect.objectContaining({
        runId: "run-1",
        target: SLUG,
        outcome: "saved",
        albumIntent: "album",
      }),
    ])
    expect(await h.store.readStagingNote(SLUG)).toBeNull()
  })

  it("saves to the library on iOS and never asks for an album", async () => {
    const h = makeHarness({ platform: "ios" })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "saved", albumIntent: "library" })
    expect(h.library.saveToLibrary).toHaveBeenCalledWith(STAGED)
    expect(h.library.createAlbum).not.toHaveBeenCalled()
    expect(h.library.createAsset).not.toHaveBeenCalled()
    expect(h.filesUnderRoot()).toEqual([])
  })

  it("still saves when the album cannot be created (R17)", async () => {
    const h = makeHarness()
    h.library.createAlbum.mockRejectedValueOnce(new Error("no album"))
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "saved", albumIntent: "library" })
    expect(h.library.createAsset).toHaveBeenCalledWith(STAGED)
    expect(h.reports[0]).toMatchObject({
      outcome: "saved",
      albumIntent: "library",
    })
    expect(h.filesUnderRoot()).toEqual([])
  })

  it("signals iOS background completion once, at the end of staging", async () => {
    const h = makeHarness()
    await h.adapter.exportVideo(exportInput())

    expect(h.port.signalBackgroundCompletion).toHaveBeenCalledTimes(1)
    expect(h.order).toEqual([
      "transfer",
      `signal:${buildExportTaskId(SLUG)}`,
      `asset:${STAGED}`,
      `album:${RAW_EXPORT_ALBUM_NAME}`,
    ])
  })

  it("names the staged file from the video title (R34)", async () => {
    const h = makeHarness()
    await h.adapter.exportVideo(
      exportInput({ title: `../../${"A".repeat(400)} secret` }),
    )

    const saved = h.library.createAsset.mock.calls[0][0]
    expect(saved.startsWith(`${STAGING_DIR}/`)).toBe(true)
    expect(saved).not.toContain(SLUG.toUpperCase())
    const name = saved.slice(`${STAGING_DIR}/`.length)
    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith(".mp4")).toBe(true)
    expect(name).not.toContain(" ")
    expect(name.split("/")).toHaveLength(1)
  })

  it("fetches the rendition the sheet selected, not a default", async () => {
    const h = makeHarness()
    await h.adapter.exportVideo(
      exportInput({
        rendition: {
          documentId: "rend-low",
          qualityLabel: "Low",
          url: "https://cdn.example/low.mp4",
          sizeBytes: 12,
        },
        wifiOnly: true,
      }),
    )

    expect(h.specs[0]).toMatchObject({
      id: buildExportTaskId(SLUG),
      url: "https://cdn.example/low.mp4",
      destination: STAGED,
      allowCellular: false,
    })
  })
})

describe("terminal outcomes leave nothing staged", () => {
  it("reports a refusal and stages nothing (AE4)", async () => {
    const h = makeHarness({
      permission: { granted: false, status: "denied", canAskAgain: false },
    })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "refused" })
    expect(h.port.runExportTransfer).not.toHaveBeenCalled()
    expect(h.library.saveToLibrary).not.toHaveBeenCalled()
    expect(h.library.createAsset).not.toHaveBeenCalled()
    expect(h.filesUnderRoot()).toEqual([])
    expect(h.reports[0]).toMatchObject({
      outcome: "refused",
      canAskAgain: false,
    })
  })

  it("reports a block before any transfer starts", async () => {
    const h = makeHarness({ freeBytes: 1 })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "blocked" })
    expect(h.port.runExportTransfer).not.toHaveBeenCalled()
    expect(h.filesUnderRoot()).toEqual([])
    expect(h.reports[0]?.detail).toEqual(expect.any(String))
  })

  it("deletes the staged file when the transfer fails", async () => {
    const h = makeHarness({
      transfer: async (spec) => {
        // The engine leaves partial bytes behind, which the export must remove.
        h.files.set(spec.destination, "partial")
        return {
          kind: "interrupted",
          interruption: { kind: "httpError", status: 404 },
        }
      },
    })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "failed" })
    expect(h.library.createAsset).not.toHaveBeenCalled()
    expect(h.filesUnderRoot()).toEqual([])
  })

  it("deletes the staged file when the library write fails", async () => {
    const h = makeHarness()
    h.library.createAsset.mockRejectedValueOnce(new Error("library is full"))
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "failed" })
    expect(h.filesUnderRoot()).toEqual([])
    expect(h.reports[0]).toMatchObject({ outcome: "failed" })
  })

  it("cancels before the library write and keeps nothing staged", async () => {
    const h = makeHarness({
      transfer: async (spec) => {
        h.files.set(spec.destination, "partial")
        h.store.requestCancel(SLUG)
        return { kind: "interrupted", interruption: { kind: "userCancel" } }
      },
    })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "cancelled" })
    expect(h.library.createAsset).not.toHaveBeenCalled()
    expect(h.port.stopExportTransfer).toHaveBeenCalledWith(
      buildExportTaskId(SLUG),
    )
    expect(h.filesUnderRoot()).toEqual([])
  })

  it("refuses a second export of a target already in flight (R27)", async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const h = makeHarness({
      transfer: async (spec) => {
        await gate
        h.files.set(spec.destination, "bytes")
        return { kind: "done", stagedPath: spec.destination, bytesTotal: 1 }
      },
    })

    const first = h.adapter.exportVideo(exportInput())
    await Promise.resolve()
    const second = await h.adapter.exportVideo(exportInput())
    expect(second).toEqual({ kind: "already-exporting" })

    release()
    await expect(first).resolves.toMatchObject({ outcome: "saved" })
    // Two requests, one transfer: the refused one never reached the engine.
    expect(h.port.runExportTransfer).toHaveBeenCalledTimes(1)
    expect(h.library.createAsset).toHaveBeenCalledTimes(1)
  })
})

describe("the location the engine reports (KTD2)", () => {
  const ENGINE_NAMED = `${STAGING_DIR}/Engine_Named.mp4`

  it("adopts a scheme-less location inside the export root", async () => {
    const h = makeHarness({
      transfer: async () => {
        h.files.set(ENGINE_NAMED, "transferred-bytes")
        return {
          kind: "done",
          stagedPath: schemeless(ENGINE_NAMED),
          bytesTotal: 1_000,
        }
      },
    })
    await h.adapter.exportVideo(exportInput())

    // The library keeps receiving a `file://` URI, never the bare path.
    expect(h.library.createAsset).toHaveBeenCalledWith(ENGINE_NAMED)
    expect(h.filesUnderRoot()).toEqual([])
  })

  it("keeps the initial path when the location resolves outside the root", async () => {
    const h = makeHarness({
      seedFiles: { [OFFLINE_FILE]: OFFLINE_BYTES },
      transfer: async (spec) => {
        h.files.set(spec.destination, "transferred-bytes")
        return {
          kind: "done",
          stagedPath: schemeless(OFFLINE_FILE),
          bytesTotal: 1_000,
        }
      },
    })
    await h.adapter.exportVideo(exportInput())

    expect(h.library.createAsset).toHaveBeenCalledWith(STAGED)
    expect(h.library.createAsset).toHaveBeenCalledTimes(1)
    expect(h.files.get(OFFLINE_FILE)).toBe(OFFLINE_BYTES)
  })
})

describe("reuse of a completed offline copy (R36, R38)", () => {
  const seeded = { [OFFLINE_FILE]: OFFLINE_BYTES }

  it("duplicates the offline copy and starts no transfer (AE19)", async () => {
    const h = makeHarness({ record: offlineRecord(), seedFiles: seeded })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "saved", reused: true })
    expect(h.port.runExportTransfer).not.toHaveBeenCalled()
    expect(h.fs.copyFile).toHaveBeenCalledWith(OFFLINE_FILE, STAGED)
  })

  it("leaves the offline copy present and unmodified (AE22)", async () => {
    const h = makeHarness({ record: offlineRecord(), seedFiles: seeded })
    await h.adapter.exportVideo(exportInput())

    expect(h.files.get(OFFLINE_FILE)).toBe(OFFLINE_BYTES)
    expect(h.filesUnderRoot()).toEqual([])
  })

  it("hands the library the duplicate, never the offline path", async () => {
    const h = makeHarness({ record: offlineRecord(), seedFiles: seeded })
    await h.adapter.exportVideo(exportInput())

    expect(h.library.createAsset).toHaveBeenCalledWith(STAGED)
    expect(h.library.createAsset).not.toHaveBeenCalledWith(OFFLINE_FILE)
    expect(STAGED).not.toBe(OFFLINE_FILE)
  })

  it("transfers when the selected rendition differs (AE20)", async () => {
    const h = makeHarness({ record: offlineRecord(), seedFiles: seeded })
    await h.adapter.exportVideo(
      exportInput({ rendition: { ...RENDITION, documentId: "rend-low" } }),
    )

    expect(h.port.runExportTransfer).toHaveBeenCalledTimes(1)
    expect(h.fs.copyFile).not.toHaveBeenCalled()
  })

  it("never matches an empty rendition identity (AE21)", async () => {
    const stored = makeHarness({
      record: offlineRecord({ renditionDocumentId: "" }),
      seedFiles: seeded,
    })
    await stored.adapter.exportVideo(
      exportInput({ rendition: { ...RENDITION, documentId: "" } }),
    )
    expect(stored.port.runExportTransfer).toHaveBeenCalledTimes(1)

    const selected = makeHarness({ record: offlineRecord(), seedFiles: seeded })
    await selected.adapter.exportVideo(
      exportInput({ rendition: { ...RENDITION, documentId: "" } }),
    )
    expect(selected.port.runExportTransfer).toHaveBeenCalledTimes(1)
  })

  it("never reuses a copy that is in flight, paused or unverified", async () => {
    const states = ["queued", "downloading", "paused", "failed"] as const
    for (const state of states) {
      const h = makeHarness({
        record: offlineRecord({ state }),
        seedFiles: seeded,
      })
      await h.adapter.exportVideo(exportInput())
      expect(h.port.runExportTransfer).toHaveBeenCalledTimes(1)
    }

    const noPath = makeHarness({
      record: offlineRecord({ committedPath: null }),
      seedFiles: seeded,
    })
    await noPath.adapter.exportVideo(exportInput())
    expect(noPath.port.runExportTransfer).toHaveBeenCalledTimes(1)
  })

  it("transfers when the committed file is gone from disk", async () => {
    const h = makeHarness({ record: offlineRecord() })
    await h.adapter.exportVideo(exportInput())

    expect(h.port.runExportTransfer).toHaveBeenCalledTimes(1)
    expect(h.fs.copyFile).not.toHaveBeenCalled()
  })
})

describe("the library write waits for an active app (KTD4)", () => {
  it("defers the note, writes nothing, and keeps the staged file", async () => {
    const h = makeHarness({ appState: "background" })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toEqual({ kind: "deferred", stagedPath: STAGED })
    expect(h.library.createAsset).not.toHaveBeenCalled()
    expect(h.library.saveToLibrary).not.toHaveBeenCalled()
    expect(h.files.has(STAGED)).toBe(true)
    expect(h.reports).toEqual([])

    const note = await h.store.readStagingNote(SLUG)
    expect(note).toMatchObject({
      target: SLUG,
      stagedPath: STAGED,
      albumIntent: "album",
      transferFinished: true,
    })
  })
})

describe("a series run's staged note carries its run size", () => {
  it("keeps the run size on a deferred note so the sweep folds the run", async () => {
    const h = makeHarness({ appState: "background" })
    await h.adapter.exportVideo(
      exportInput({ runSize: 12, seriesSlug: "life-of-jesus" }),
    )

    expect(await h.store.readStagingNote(SLUG)).toMatchObject({
      target: SLUG,
      runSize: 12,
      transferFinished: true,
    })
  })
})

describe("finishing a staged export the sweep found", () => {
  function note(overrides: Partial<ExportStagingNote> = {}): ExportStagingNote {
    return {
      version: 1,
      target: SLUG,
      runId: "run-1",
      stagedPath: STAGED,
      albumIntent: "album",
      transferFinished: true,
      ...overrides,
    }
  }

  it("saves the staged file, clears the note and cleans the root", async () => {
    const h = makeHarness({ seedFiles: { [STAGED]: "staged-bytes" } })
    await h.store.writeStagingNote(note())

    const outcome = await h.adapter.completeStagedExport(note())

    expect(outcome).toBe("saved")
    expect(h.library.createAsset).toHaveBeenCalledWith(STAGED)
    expect(h.filesUnderRoot()).toEqual([])
    expect(await h.store.readStagingNote(SLUG)).toBeNull()
    expect(h.reports[0]).toMatchObject({ outcome: "saved" })
  })

  it("reports an abandoned export when the staged file is gone", async () => {
    const h = makeHarness()
    const outcome = await h.adapter.completeStagedExport(note())

    expect(outcome).toBe("abandoned")
    expect(h.library.createAsset).not.toHaveBeenCalled()
  })

  it("refuses a note whose path is outside the export root", async () => {
    const h = makeHarness({ seedFiles: { [OFFLINE_FILE]: OFFLINE_BYTES } })
    const outcome = await h.adapter.completeStagedExport(
      note({ stagedPath: OFFLINE_FILE }),
    )

    expect(outcome).toBe("abandoned")
    expect(h.library.createAsset).not.toHaveBeenCalled()
    expect(h.files.get(OFFLINE_FILE)).toBe(OFFLINE_BYTES)
  })

  it("reports the run size the note carries, so a run folds into one card", async () => {
    const h = makeHarness({ seedFiles: { [STAGED]: "staged-bytes" } })
    await h.adapter.completeStagedExport(note({ runSize: 12 }))
    expect(h.reports[0]).toMatchObject({ outcome: "saved", runSize: 12 })

    const discarded = makeHarness()
    await discarded.adapter.discardStagedExport(
      note({ runSize: 12, transferFinished: false }),
    )
    expect(discarded.reports[0]).toMatchObject({
      outcome: "abandoned",
      runSize: 12,
    })
  })

  it("skips a note a live export of the same target already owns (R27)", async () => {
    // The relaunch sweep and a retry of the same video race: saving the old
    // partial file would also delete the directory the retry writes into.
    const stale = `${STAGING_DIR}/Stale.mp4`
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const h = makeHarness({
      seedFiles: { [stale]: "old-partial" },
      transfer: async (spec) => {
        await gate
        h.files.set(spec.destination, "bytes")
        return { kind: "done", stagedPath: spec.destination, bytesTotal: 1 }
      },
    })

    const live = h.adapter.exportVideo(exportInput())
    const swept = await h.adapter.completeStagedExport(
      note({ stagedPath: stale }),
    )

    expect(swept).toBe("abandoned")
    expect(h.library.createAsset).not.toHaveBeenCalled()
    expect(h.reports).toEqual([])
    expect(h.files.get(stale)).toBe("old-partial")

    release()
    await expect(live).resolves.toMatchObject({ outcome: "saved" })
  })

  it("skips a discard a live export of the same target already owns (R27)", async () => {
    const stale = `${STAGING_DIR}/Stale.mp4`
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const h = makeHarness({
      seedFiles: { [stale]: "old-partial" },
      transfer: async (spec) => {
        await gate
        h.files.set(spec.destination, "bytes")
        return { kind: "done", stagedPath: spec.destination, bytesTotal: 1 }
      },
    })

    // The note the skip must not clear is written first, because the live
    // export writes its own only once its admission checks settle.
    await h.store.writeStagingNote(note({ transferFinished: false }))
    const live = h.adapter.exportVideo(exportInput())
    const swept = await h.adapter.discardStagedExport(
      note({ transferFinished: false }),
    )

    expect(swept).toBe("abandoned")
    expect(h.reports).toEqual([])
    expect(h.files.get(stale)).toBe("old-partial")
    expect(await h.store.readStagingNote(SLUG)).toMatchObject({
      transferFinished: false,
    })

    release()
    await expect(live).resolves.toMatchObject({ outcome: "saved" })
  })

  it("discards a staged export and reports it unfinished", async () => {
    const h = makeHarness({ seedFiles: { [STAGED]: "staged-bytes" } })
    await h.store.writeStagingNote(note({ transferFinished: false }))

    const outcome = await h.adapter.discardStagedExport(
      note({ transferFinished: false }),
    )

    expect(outcome).toBe("abandoned")
    expect(h.filesUnderRoot()).toEqual([])
    expect(await h.store.readStagingNote(SLUG)).toBeNull()
    expect(h.reports[0]).toMatchObject({ outcome: "abandoned" })
  })
})
