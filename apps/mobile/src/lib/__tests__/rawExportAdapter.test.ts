import type { ExportReportSignal } from "../../components/ExportReportHost"
import {
  createExportSessionStore,
  EXPORT_STAGING_NOTE_VERSION,
  type ExportStagingNote,
  type ExportStoragePort,
} from "../exportSession"
import type { OfflineDownloadRecord } from "../offlineManifest"
import type {
  ExportFolder,
  RawExportRendition,
  RawExportTransferHooks,
  RawExportTransferReport,
  RawExportTransferSpec,
} from "../rawExport"
import { createRawExportAdapter } from "../rawExportAdapter"
import { buildExportRoot, buildExportTaskId } from "../transferPort"

const ROOT = buildExportRoot("file:///docs/")
const SLUG = "the-birth-of-jesus"
const TITLE = "The Birth of Jesus"
const FILE_NAME = "The_Birth_of_Jesus.mp4"
const STAGING_DIR = `${ROOT}/${SLUG}`
const STAGED = `${STAGING_DIR}/${FILE_NAME}`
const OFFLINE_FILE = `file:///docs/offline-downloads/${SLUG}/rend-high.mp4`
const OFFLINE_BYTES = "offline-bytes"

/** An Android SAF tree: the readable half of its last segment follows a colon. */
const FOLDER: ExportFolder = {
  uri: "content://com.android.externalstorage.documents/tree/primary%3ADownload",
}
const FOLDER_NAME = "Download"

/** What the engine reports back: the destination it was given, scheme removed. */
function schemeless(uri: string): string {
  return uri.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
}

function destinationKey(folder: ExportFolder, fileName: string): string {
  return `${folder.uri}/${fileName}`
}

const RENDITION: RawExportRendition = {
  documentId: "rend-high",
  qualityLabel: "High",
  url: "https://cdn.example/high.mp4",
  sizeBytes: 1_000,
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
  record?: OfflineDownloadRecord | null
  freeBytes?: number
  seedFiles?: Record<string, string>
  /** Names already taken in FOLDER before the export starts. */
  seedFolderFiles?: string[]
  transfer?: (
    spec: RawExportTransferSpec,
    hooks: RawExportTransferHooks,
  ) => Promise<RawExportTransferReport>
}

function makeHarness(options: HarnessOptions = {}) {
  const files = new Map<string, string>(Object.entries(options.seedFiles ?? {}))
  const folderFiles = new Map<string, string>(
    (options.seedFolderFiles ?? []).map((name) => [
      destinationKey(FOLDER, name),
      "already-there",
    ]),
  )
  const dirs = new Set<string>()
  const order: string[] = []
  const reports: ExportReportSignal[] = []
  const specs: RawExportTransferSpec[] = []
  const store = createExportSessionStore({ storage: memoryStorage() })

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

  const destination = {
    pickFolder: jest.fn(async (): Promise<ExportFolder | null> => FOLDER),
    // One listing answers every candidate name. Android resolves no per-name
    // probe against a SAF tree, so the port reads the whole folder once.
    listNames: jest.fn(
      async (folder: ExportFolder): Promise<readonly string[]> =>
        [...folderFiles.keys()]
          .filter((key) => key.startsWith(`${folder.uri}/`))
          .map((key) => key.slice(`${folder.uri}/`.length)),
    ),
    copyInto: jest.fn(
      async (args: {
        stagedPath: string
        folder: ExportFolder
        fileName: string
      }) => {
        // The real copy reads the staged bytes, so a missing stage is a fault.
        const body = files.get(args.stagedPath)
        if (body === undefined) {
          throw new Error(`missing staged ${args.stagedPath}`)
        }
        order.push(`copy-into:${args.fileName}`)
        folderFiles.set(destinationKey(args.folder, args.fileName), body)
      },
    ),
    removeIfExists: jest.fn(
      async (args: { folder: ExportFolder; fileName: string }) => {
        const key = destinationKey(args.folder, args.fileName)
        if (folderFiles.delete(key)) order.push(`remove:${args.fileName}`)
      },
    ),
  }

  const telemetry = { info: jest.fn(), warn: jest.fn() }

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
    pauseExportTransfer: jest.fn(async () => true),
    resumeExportTransfer: jest.fn(async () => true),
    signalBackgroundCompletion: jest.fn((taskId: string) => {
      order.push(`signal:${taskId}`)
    }),
  }

  const adapter = createRawExportAdapter({
    exportRoot: ROOT,
    port,
    fs,
    destination,
    findOfflineRecord: () => options.record ?? null,
    report: (signal) => reports.push(signal),
    session: store,
    telemetry,
  })

  return {
    adapter,
    destination,
    dirs,
    files,
    fs,
    order,
    port,
    reports,
    specs,
    store,
    telemetry,
    filesUnderRoot: () =>
      [...files.keys()].filter((key) => key.startsWith(`${ROOT}/`)),
    inFolder: (fileName: string) =>
      folderFiles.get(destinationKey(FOLDER, fileName)),
    /** Stands in for the bytes a part-way copy leaves under the final name. */
    writeIntoFolder: (fileName: string, body: string) => {
      folderFiles.set(destinationKey(FOLDER, fileName), body)
    },
    folderNames: () =>
      [...folderFiles.keys()].map((key) => key.slice(`${FOLDER.uri}/`.length)),
  }
}

type Harness = ReturnType<typeof makeHarness>

/** R18: the staged file AND its directory go, whichever way the export ended. */
function expectStageRemoved(h: Harness): void {
  expect(h.filesUnderRoot()).toEqual([])
  expect(h.fs.removeUri).toHaveBeenCalledWith(STAGING_DIR)
}

function exportInput(overrides: Record<string, unknown> = {}) {
  return {
    videoSlug: SLUG,
    runId: "run-1",
    title: TITLE,
    rendition: RENDITION,
    wifiOnly: false,
    folder: FOLDER,
    ...overrides,
  }
}

describe("a successful export", () => {
  it("transfers, copies into the folder, and leaves the export root empty", async () => {
    const h = makeHarness()
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toEqual({ kind: "settled", outcome: "saved", reused: false })
    expect(h.destination.copyInto).toHaveBeenCalledWith({
      stagedPath: STAGED,
      folder: FOLDER,
      fileName: FILE_NAME,
    })
    expect(h.inFolder(FILE_NAME)).toBe("transferred-bytes")
    expectStageRemoved(h)
    expect(h.reports).toEqual([
      expect.objectContaining({
        runId: "run-1",
        target: SLUG,
        outcome: "saved",
        title: TITLE,
        folderName: FOLDER_NAME,
      }),
    ])
    expect(await h.store.readStagingNote(SLUG)).toBeNull()
  })

  it("never presents the picker itself; the folder arrives already picked", async () => {
    const h = makeHarness()
    await h.adapter.exportVideo(exportInput())

    expect(h.destination.pickFolder).not.toHaveBeenCalled()
  })

  it("reports a null folder name when the uri has none, so the card says Files", async () => {
    const h = makeHarness()
    const result = await h.adapter.exportVideo(
      exportInput({ folder: { uri: "file:///" } }),
    )

    expect(result).toMatchObject({ outcome: "saved" })
    expect(h.reports[0]).toMatchObject({ outcome: "saved", folderName: null })
  })

  it("takes the (2) suffix when the name is already in the folder", async () => {
    const h = makeHarness({ seedFolderFiles: [FILE_NAME] })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "saved" })
    // ONE listing answers the whole search — never a probe per candidate.
    expect(h.destination.listNames).toHaveBeenCalledTimes(1)
    expect(h.destination.listNames).toHaveBeenCalledWith(FOLDER)
    expect(h.destination.copyInto).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "The_Birth_of_Jesus (2).mp4" }),
    )
    // The file that was there first is not touched.
    expect(h.inFolder(FILE_NAME)).toBe("already-there")
    expect(h.folderNames()).toEqual([FILE_NAME, "The_Birth_of_Jesus (2).mp4"])
  })

  it("stops searching at the fiftieth name and lets the copy report the collision", async () => {
    const h = makeHarness()
    // Every candidate the search can reach is already in the folder.
    h.destination.listNames.mockResolvedValue([
      FILE_NAME,
      ...Array.from(
        { length: 49 },
        (_, index) => `The_Birth_of_Jesus (${index + 2}).mp4`,
      ),
    ])
    await h.adapter.exportVideo(exportInput())

    expect(h.destination.listNames).toHaveBeenCalledTimes(1)
    expect(h.destination.copyInto).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: "The_Birth_of_Jesus (50).mp4" }),
    )
  })

  it("signals iOS background completion once, AFTER the copy", async () => {
    const h = makeHarness()
    await h.adapter.exportVideo(exportInput())

    // The signal releases the shared background-session handler, and iOS may
    // suspend the process once it lands. Signalling first left the ~165MB copy
    // of a background-finished download with no background window.
    expect(h.port.signalBackgroundCompletion).toHaveBeenCalledTimes(1)
    expect(h.order).toEqual([
      "transfer",
      `copy-into:${FILE_NAME}`,
      `signal:${buildExportTaskId(SLUG)}`,
    ])
  })

  it("names the file in the folder from the video title (R34)", async () => {
    const h = makeHarness()
    await h.adapter.exportVideo(
      exportInput({ title: `../../${"A".repeat(400)} secret` }),
    )

    const [args] = h.destination.copyInto.mock.calls[0]
    expect(args.fileName).toContain("AAAA")
    expect(args.fileName).not.toContain(SLUG)
    expect(args.fileName.length).toBeLessThanOrEqual(120)
    expect(args.fileName.endsWith(".mp4")).toBe(true)
    expect(args.fileName).not.toContain(" ")
    expect(args.fileName).not.toContain("/")
    expect(args.fileName.startsWith(".")).toBe(false)
    // The folder receives the very name the file was staged under.
    expect(args.stagedPath).toBe(`${STAGING_DIR}/${args.fileName}`)
  })

  it("falls back to the slug when the title is blank", async () => {
    const h = makeHarness()
    await h.adapter.exportVideo(exportInput({ title: "   " }))

    expect(h.destination.copyInto).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: `${SLUG}.mp4` }),
    )
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
  it("reports a block before any transfer starts", async () => {
    const h = makeHarness({ freeBytes: 1 })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "blocked" })
    expect(h.port.runExportTransfer).not.toHaveBeenCalled()
    expect(h.destination.copyInto).not.toHaveBeenCalled()
    expectStageRemoved(h)
    expect(h.reports[0]).toMatchObject({
      outcome: "blocked",
      detail: expect.any(String),
    })
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
    expect(h.destination.copyInto).not.toHaveBeenCalled()
    expectStageRemoved(h)
  })

  it("fails with destinationWriteError when the copy into the folder throws", async () => {
    const h = makeHarness()
    h.destination.copyInto.mockRejectedValueOnce(new Error("folder is gone"))
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "failed" })
    expect(h.folderNames()).toEqual([])
    expectStageRemoved(h)
    expect(h.reports[0]).toMatchObject({ outcome: "failed" })
    expect(h.telemetry.warn).toHaveBeenCalledWith(
      "raw_export.failed",
      expect.objectContaining({
        export_state: "failed",
        export_target: SLUG,
        export_failure_cause: "destinationWriteError",
      }),
    )
  })

  it("removes the truncated file a part-way copy left in the folder (R18)", async () => {
    // `File.copy` is a plain non-atomic byte copy on both platforms, so an
    // interrupted copy leaves a partial file under the FINAL name in the
    // viewer's own folder, and nothing else ever removes it.
    const h = makeHarness()
    h.destination.copyInto.mockImplementationOnce(async (args) => {
      h.writeIntoFolder(args.fileName, "truncated")
      throw new Error("copy died half way")
    })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "failed" })
    expect(h.destination.removeIfExists).toHaveBeenCalledWith({
      folder: FOLDER,
      fileName: FILE_NAME,
    })
    expect(h.folderNames()).toEqual([])
    expectStageRemoved(h)
  })

  it("keeps the export failed when the destination cleanup ALSO throws", async () => {
    // A cleanup fault must never replace the outcome the export reached.
    const h = makeHarness()
    h.destination.copyInto.mockRejectedValueOnce(new Error("copy died"))
    h.destination.removeIfExists.mockRejectedValueOnce(new Error("tree gone"))
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "failed" })
    expect(h.reports[0]).toMatchObject({ outcome: "failed" })
  })

  it("fails with destinationWriteError when the folder listing throws", async () => {
    const h = makeHarness()
    h.destination.listNames.mockRejectedValueOnce(new Error("tree revoked"))
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "failed" })
    expect(h.destination.copyInto).not.toHaveBeenCalled()
    expectStageRemoved(h)
    expect(h.telemetry.warn).toHaveBeenCalledWith(
      "raw_export.failed",
      expect.objectContaining({
        export_failure_cause: "destinationWriteError",
      }),
    )
  })

  it("cancels before the copy and keeps nothing staged", async () => {
    const h = makeHarness({
      transfer: async (spec) => {
        h.files.set(spec.destination, "partial")
        h.store.requestCancel(SLUG)
        return { kind: "interrupted", interruption: { kind: "userCancel" } }
      },
    })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "cancelled" })
    expect(h.destination.copyInto).not.toHaveBeenCalled()
    expect(h.port.stopExportTransfer).toHaveBeenCalledWith(
      buildExportTaskId(SLUG),
    )
    expectStageRemoved(h)
  })

  it("reports a cancel that lands during the copy and keeps the copied file (R22)", async () => {
    const h = makeHarness()
    const copy = h.destination.copyInto.getMockImplementation()
    h.destination.copyInto.mockImplementationOnce(async (args) => {
      h.store.requestCancel(SLUG)
      await copy?.(args)
    })
    const result = await h.adapter.exportVideo(exportInput())

    expect(result).toMatchObject({ outcome: "cancelled" })
    expect(h.inFolder(FILE_NAME)).toBe("transferred-bytes")
    expectStageRemoved(h)
    expect(h.reports[0]).toMatchObject({ outcome: "cancelled" })
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
    expect(h.destination.copyInto).toHaveBeenCalledTimes(1)
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

    // The copy keeps receiving a `file://` URI, never the bare path, and the
    // folder still gets the title-derived name rather than the engine's.
    expect(h.destination.copyInto).toHaveBeenCalledWith({
      stagedPath: ENGINE_NAMED,
      folder: FOLDER,
      fileName: FILE_NAME,
    })
    expectStageRemoved(h)
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

    expect(h.destination.copyInto).toHaveBeenCalledWith(
      expect.objectContaining({ stagedPath: STAGED }),
    )
    expect(h.destination.copyInto).toHaveBeenCalledTimes(1)
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
    expect(h.inFolder(FILE_NAME)).toBe(OFFLINE_BYTES)
  })

  it("leaves the offline copy present and unmodified (AE22)", async () => {
    const h = makeHarness({ record: offlineRecord(), seedFiles: seeded })
    await h.adapter.exportVideo(exportInput())

    expect(h.files.get(OFFLINE_FILE)).toBe(OFFLINE_BYTES)
    expectStageRemoved(h)
  })

  it("hands the folder the duplicate, never the offline path", async () => {
    const h = makeHarness({ record: offlineRecord(), seedFiles: seeded })
    await h.adapter.exportVideo(exportInput())

    expect(h.destination.copyInto).toHaveBeenCalledWith(
      expect.objectContaining({ stagedPath: STAGED }),
    )
    expect(h.destination.copyInto).not.toHaveBeenCalledWith(
      expect.objectContaining({ stagedPath: OFFLINE_FILE }),
    )
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

describe("the staging note", () => {
  it("lands before the bytes and carries the run size, so the sweep folds the run", async () => {
    const seen: (ExportStagingNote | null)[] = []
    const h = makeHarness({
      transfer: async (spec) => {
        seen.push(await h.store.readStagingNote(SLUG))
        h.files.set(spec.destination, "transferred-bytes")
        return { kind: "done", stagedPath: spec.destination, bytesTotal: 1_000 }
      },
    })
    await h.adapter.exportVideo(
      exportInput({ runSize: 12, seriesSlug: "life-of-jesus" }),
    )

    expect(seen).toEqual([
      expect.objectContaining({
        target: SLUG,
        runId: "run-1",
        stagedPath: STAGED,
        runSize: 12,
      }),
    ])
    expect(await h.store.readStagingNote(SLUG)).toBeNull()
  })
})

describe("picking the folder", () => {
  it("hands back what the picker returns, a dismissal included", async () => {
    const h = makeHarness()
    await expect(h.adapter.pickExportFolder()).resolves.toEqual(FOLDER)

    h.destination.pickFolder.mockResolvedValueOnce(null)
    await expect(h.adapter.pickExportFolder()).resolves.toBeNull()
  })

  it("starts no export and reports nothing on its own", async () => {
    const h = makeHarness()
    await h.adapter.pickExportFolder()

    expect(h.port.runExportTransfer).not.toHaveBeenCalled()
    expect(h.destination.copyInto).not.toHaveBeenCalled()
    expect(h.reports).toEqual([])
  })
})

describe("discarding a staged export the sweep found", () => {
  function note(overrides: Partial<ExportStagingNote> = {}): ExportStagingNote {
    return {
      version: EXPORT_STAGING_NOTE_VERSION,
      target: SLUG,
      runId: "run-1",
      stagedPath: STAGED,
      ...overrides,
    }
  }

  it("discards a staged export and reports it unfinished", async () => {
    const h = makeHarness({ seedFiles: { [STAGED]: "staged-bytes" } })
    await h.store.writeStagingNote(note())

    const outcome = await h.adapter.discardStagedExport(note())

    expect(outcome).toBe("abandoned")
    expect(h.destination.copyInto).not.toHaveBeenCalled()
    expectStageRemoved(h)
    expect(await h.store.readStagingNote(SLUG)).toBeNull()
    expect(h.reports[0]).toMatchObject({ outcome: "abandoned" })
  })

  it("discards a note whose file is already gone, without a fault", async () => {
    const h = makeHarness()
    const outcome = await h.adapter.discardStagedExport(note())

    expect(outcome).toBe("abandoned")
    expect(h.reports[0]).toMatchObject({ outcome: "abandoned" })
  })

  it("removes only the target's staging directory, never the note's own path", async () => {
    const h = makeHarness({ seedFiles: { [OFFLINE_FILE]: OFFLINE_BYTES } })
    const outcome = await h.adapter.discardStagedExport(
      note({ stagedPath: OFFLINE_FILE }),
    )

    expect(outcome).toBe("abandoned")
    expect(h.fs.removeUri).toHaveBeenCalledWith(STAGING_DIR)
    expect(h.fs.removeUri).not.toHaveBeenCalledWith(OFFLINE_FILE)
    expect(h.files.get(OFFLINE_FILE)).toBe(OFFLINE_BYTES)
  })

  it("reports the run size the note carries, so a run folds into one card", async () => {
    const h = makeHarness()
    await h.adapter.discardStagedExport(note({ runSize: 12 }))

    expect(h.reports[0]).toMatchObject({ outcome: "abandoned", runSize: 12 })
  })

  it("skips a discard a live export of the same target already owns (R27)", async () => {
    // The relaunch sweep and a retry of the same video race: discarding the
    // old partial file would also delete the directory the retry writes into.
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
    await h.store.writeStagingNote(note({ stagedPath: stale }))
    const live = h.adapter.exportVideo(exportInput())
    const swept = await h.adapter.discardStagedExport(
      note({ stagedPath: stale }),
    )

    expect(swept).toBe("abandoned")
    expect(h.reports).toEqual([])
    expect(h.files.get(stale)).toBe("old-partial")
    expect(await h.store.readStagingNote(SLUG)).not.toBeNull()

    release()
    await expect(live).resolves.toMatchObject({ outcome: "saved" })
  })
})
