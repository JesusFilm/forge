import type { TransferInterruption } from "../downloadOutcome"
import { STORAGE_RESERVE_BYTES } from "../offlineConstants"
import {
  buildExportTaskId,
  buildExportTransferSpec,
  createRawExportDecider,
  decideExportInterruption,
  evaluateExportStorageGate,
  exportFolderName,
  exportTargetFromTaskId,
  isExportTaskId,
  RAW_EXPORT_MAX_RESUMES,
  type RawExportDeps,
  type RawExportRendition,
  type RawExportRequest,
  type RawExportTransferReport,
  type RawExportTransferSpec,
} from "../rawExport"
import { RAW_EXPORT_ID_PREFIX } from "../rawExportConstants"

const MB = 1024 * 1024
const GB = 1024 * MB

const SLUG = "birth-of-jesus"
const STAGED_PATH = "file:///app/raw-exports/birth-of-jesus/video.mp4"

const RENDITION: RawExportRendition = {
  documentId: "rendition-highest",
  qualityLabel: "Highest",
  url: "https://cdn.example/birth-of-jesus/highest.mp4",
  sizeBytes: 100 * MB,
}

function makeRequest(
  overrides: Partial<RawExportRequest> = {},
): RawExportRequest {
  return {
    videoSlug: SLUG,
    rendition: RENDITION,
    stagedPath: STAGED_PATH,
    wifiOnly: false,
    ...overrides,
  }
}

const DONE: RawExportTransferReport = {
  kind: "done",
  stagedPath: STAGED_PATH,
  bytesTotal: 100 * MB,
}

function interrupted(
  interruption: TransferInterruption,
): RawExportTransferReport {
  return { kind: "interrupted", interruption }
}

/**
 * The decider under test with every crossing injected. `pause` and `resume` sit
 * on the transfer double only to prove R24: an export never calls them.
 */
function harness(
  options: {
    freeBytes?: number
    reports?: (RawExportTransferReport | Error)[]
  } = {},
) {
  const specs: RawExportTransferSpec[] = []
  const reports = options.reports ?? [DONE]
  let reportIndex = 0

  const transfer = {
    run: jest.fn(async (spec: RawExportTransferSpec) => {
      specs.push(spec)
      const next = reports[Math.min(reportIndex, reports.length - 1)]
      reportIndex += 1
      if (next instanceof Error) throw next
      return next
    }),
    stop: jest.fn(async () => undefined),
    pause: jest.fn(),
    resume: jest.fn(),
  }

  const fs = {
    freeDiskBytes: jest.fn(async () => options.freeBytes ?? 100 * GB),
  }
  const telemetry = { info: jest.fn(), warn: jest.fn() }
  const deps: RawExportDeps = { fs, transfer, telemetry }

  return {
    decider: createRawExportDecider(deps),
    specs,
    transfer,
    fs,
    telemetry,
  }
}

describe("export task id", () => {
  it("carries the raw-export prefix and never equals the bare slug", () => {
    const id = buildExportTaskId(SLUG)
    expect(id).toBe(`${RAW_EXPORT_ID_PREFIX}${SLUG}`)
    expect(id).not.toBe(SLUG)
    expect(id.startsWith(RAW_EXPORT_ID_PREFIX)).toBe(true)
  })

  it("recognises its own ids and rejects a bare slug", () => {
    expect(isExportTaskId(buildExportTaskId(SLUG))).toBe(true)
    expect(isExportTaskId(SLUG)).toBe(false)
    expect(exportTargetFromTaskId(buildExportTaskId(SLUG))).toBe(SLUG)
    expect(exportTargetFromTaskId(SLUG)).toBeNull()
  })

  it("keeps the prefix even when the slug is empty", () => {
    expect(buildExportTaskId("")).toBe(RAW_EXPORT_ID_PREFIX)
    expect(isExportTaskId(buildExportTaskId(""))).toBe(true)
  })
})

describe("export storage gate (R8)", () => {
  it("counts one staged copy beside the folder copy plus the reserve", () => {
    const gate = evaluateExportStorageGate({
      exports: [{ sizeBytes: 100 * MB }],
      freeBytes: 10 * GB,
    })
    expect(gate).toEqual({
      kind: "ok",
      requiredBytes: 200 * MB + STORAGE_RESERVE_BYTES,
      freeBytes: 10 * GB,
      lowerBound: false,
    })
  })

  it("counts one staged copy of the largest file across a whole run", () => {
    const gate = evaluateExportStorageGate({
      exports: [
        { sizeBytes: 20 * MB },
        { sizeBytes: 100 * MB },
        { sizeBytes: 50 * MB },
      ],
      freeBytes: 10 * GB,
    })
    expect(gate).toMatchObject({
      kind: "ok",
      requiredBytes: 170 * MB + 100 * MB + STORAGE_RESERVE_BYTES,
    })
  })

  it("blocks when free space is one byte below the required total", () => {
    const required = 200 * MB + STORAGE_RESERVE_BYTES
    expect(
      evaluateExportStorageGate({
        exports: [{ sizeBytes: 100 * MB }],
        freeBytes: required - 1,
      }),
    ).toEqual({
      kind: "insufficient",
      requiredBytes: required,
      freeBytes: required - 1,
    })
  })

  it("admits free space exactly equal to the required total", () => {
    const required = 200 * MB + STORAGE_RESERVE_BYTES
    expect(
      evaluateExportStorageGate({
        exports: [{ sizeBytes: 100 * MB }],
        freeBytes: required,
      }),
    ).toMatchObject({ kind: "ok", requiredBytes: required })
  })

  it("flags an unknown rendition size as a lower bound", () => {
    const gate = evaluateExportStorageGate({
      exports: [{ sizeBytes: 100 * MB }, { sizeBytes: null }],
      freeBytes: 10 * GB,
    })
    expect(gate).toEqual({
      kind: "ok",
      requiredBytes: 200 * MB + STORAGE_RESERVE_BYTES,
      freeBytes: 10 * GB,
      lowerBound: true,
    })
  })

  it("keeps the reserve when every size is unknown", () => {
    expect(
      evaluateExportStorageGate({
        exports: [{ sizeBytes: null }, { sizeBytes: null }],
        freeBytes: 10 * GB,
      }),
    ).toEqual({
      kind: "ok",
      requiredBytes: STORAGE_RESERVE_BYTES,
      freeBytes: 10 * GB,
      lowerBound: true,
    })
  })

  it("blocks an unreadable free-space reading rather than allowing it", () => {
    expect(
      evaluateExportStorageGate({ exports: [{ sizeBytes: 1 }], freeBytes: 0 }),
    ).toEqual({ kind: "unreadable-free" })
    expect(evaluateExportStorageGate({ exports: [], freeBytes: -1 })).toEqual({
      kind: "unreadable-free",
    })
  })
})

describe("export folder name", () => {
  it("names an iOS security-scoped folder by its decoded last segment", () => {
    expect(
      exportFolderName(
        "file:///private/var/mobile/Library/Mobile%20Documents/com~apple~CloudDocs/Jesus%20Film",
      ),
    ).toBe("Jesus Film")
  })

  it("does not name the iOS 'On My iPhone' root by its on-disk folder", () => {
    // Observed 2026-09-15 on the iPhone 17 Pro Max simulator: picking
    // "On My iPhone" returns this url, and the card read "Saved to File
    // Provider Storage." A subfolder under it keeps its own name.
    const root =
      "file:///private/var/mobile/Containers/Shared/AppGroup/8EE60D14-FB96-4C7F-8AB2-6A86FECB6B90/File%20Provider%20Storage/"
    expect(exportFolderName(root)).toBeNull()
    expect(exportFolderName(`${root}Sermons/`)).toBe("Sermons")
  })

  it("keeps only what follows the colon in an Android SAF tree uri", () => {
    expect(
      exportFolderName(
        "content://com.android.externalstorage.documents/tree/primary%3ADownload",
      ),
    ).toBe("Download")
  })

  it("keeps the sub-path of a nested Android SAF folder after the colon", () => {
    expect(
      exportFolderName(
        "content://com.android.externalstorage.documents/tree/primary%3AMovies%2FJesus%20Film",
      ),
    ).toBe("Movies/Jesus Film")
  })

  it("ignores trailing slashes, a query and a fragment", () => {
    expect(exportFolderName("file:///Movies/Jesus%20Film/")).toBe("Jesus Film")
    expect(exportFolderName("file:///Movies/Jesus%20Film///")).toBe(
      "Jesus Film",
    )
    expect(
      exportFolderName(
        "content://com.android.externalstorage.documents/tree/primary%3ADownload?mode=rw#top",
      ),
    ).toBe("Download")
  })

  it("returns null when nothing readable is left", () => {
    expect(exportFolderName("")).toBeNull()
    expect(exportFolderName("file:///")).toBeNull()
    expect(exportFolderName("file:///%20")).toBeNull()
    expect(
      exportFolderName(
        "content://com.android.externalstorage.documents/tree/primary%3A",
      ),
    ).toBeNull()
  })

  it("falls back to the raw segment on a malformed percent escape", () => {
    expect(exportFolderName("file:///Movies/Jesus%20Film%")).toBe(
      "Jesus%20Film%",
    )
    expect(exportFolderName("file:///Movies/%E0%A4%A")).toBe("%E0%A4%A")
  })
})

describe("interruption translation (KTD11, R24, R26)", () => {
  it("resumes the export exactly once", () => {
    expect(RAW_EXPORT_MAX_RESUMES).toBe(1)
  })

  it("resumes once on connectivity loss, then terminates as failed", () => {
    expect(
      decideExportInterruption({ kind: "connectivity" }, { resumesUsed: 0 }),
    ).toEqual({ kind: "resume" })
    expect(
      decideExportInterruption({ kind: "connectivity" }, { resumesUsed: 1 }),
    ).toEqual({ kind: "terminate", outcome: "failed" })
  })

  it("resumes once on a backgrounded-transient stop, then terminates as failed", () => {
    expect(
      decideExportInterruption(
        { kind: "backgroundedTransient" },
        { resumesUsed: 0 },
      ),
    ).toEqual({ kind: "resume" })
    expect(
      decideExportInterruption(
        { kind: "backgroundedTransient" },
        { resumesUsed: 1 },
      ),
    ).toEqual({ kind: "terminate", outcome: "failed" })
  })

  it("terminates wifi-only-on-cellular as blocked, never failed", () => {
    for (const resumesUsed of [0, 1, 2]) {
      expect(
        decideExportInterruption(
          { kind: "wifiOnlyOnCellular" },
          { resumesUsed },
        ),
      ).toEqual({ kind: "terminate", outcome: "blocked" })
    }
  })

  it("terminates a viewer cancel as cancelled, never failed", () => {
    for (const resumesUsed of [0, 1]) {
      expect(
        decideExportInterruption({ kind: "userCancel" }, { resumesUsed }),
      ).toEqual({ kind: "terminate", outcome: "cancelled" })
    }
  })

  it("terminates every terminal cause as failed without a resume", () => {
    const terminal: TransferInterruption[] = [
      { kind: "httpError", status: 404 },
      { kind: "integrity" },
      { kind: "storageFull" },
    ]
    for (const interruption of terminal) {
      expect(
        decideExportInterruption(interruption, { resumesUsed: 0 }),
      ).toEqual({ kind: "terminate", outcome: "failed" })
    }
  })
})

describe("transfer spec (R9, R23)", () => {
  it("forbids cellular use when the wifi-only preference is on (AE17)", () => {
    const spec = buildExportTransferSpec({
      videoSlug: SLUG,
      rendition: RENDITION,
      stagedPath: STAGED_PATH,
      wifiOnly: true,
    })
    expect(spec.allowCellular).toBe(false)
  })

  it("allows cellular use when the wifi-only preference is off", () => {
    const spec = buildExportTransferSpec({
      videoSlug: SLUG,
      rendition: RENDITION,
      stagedPath: STAGED_PATH,
      wifiOnly: false,
    })
    expect(spec.allowCellular).toBe(true)
  })

  it("transfers the chosen rendition into the staged path under a namespaced id", () => {
    const spec = buildExportTransferSpec({
      videoSlug: SLUG,
      rendition: RENDITION,
      stagedPath: STAGED_PATH,
      wifiOnly: false,
    })
    expect(spec).toEqual({
      id: buildExportTaskId(SLUG),
      url: RENDITION.url,
      destination: STAGED_PATH,
      allowCellular: true,
    })
  })

  it("lets a hidden subtitle change neither the transfer nor the size total", async () => {
    const hidden = {
      languageSlug: "spanish",
      url: "https://cdn.example/birth-of-jesus/es.vtt",
      sizeBytes: 40 * 1024,
    }
    const plain = harness()
    const withSubtitle = harness()

    await plain.decider.stageExport(makeRequest())
    await withSubtitle.decider.stageExport(
      makeRequest({ subtitleHiddenByRawMode: hidden }),
    )

    expect(withSubtitle.specs).toEqual(plain.specs)
    expect(JSON.stringify(withSubtitle.specs)).not.toContain(hidden.url)
    expect(
      evaluateExportStorageGate({
        exports: [{ sizeBytes: RENDITION.sizeBytes }],
        freeBytes: 10 * GB,
      }),
    ).toMatchObject({ requiredBytes: 200 * MB + STORAGE_RESERVE_BYTES })
  })
})

describe("stageExport", () => {
  it("stages the file when the storage gate admits it", async () => {
    const h = harness()
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toEqual({
      outcome: "staged",
      stagedPath: STAGED_PATH,
      bytesTotal: 100 * MB,
      spec: {
        id: buildExportTaskId(SLUG),
        url: RENDITION.url,
        destination: STAGED_PATH,
        allowCellular: true,
      },
    })
    expect(h.transfer.run).toHaveBeenCalledTimes(1)
    expect(h.telemetry.warn).not.toHaveBeenCalled()
  })

  it("blocks before any transfer starts when the required total exceeds free space (AE5)", async () => {
    const h = harness({ freeBytes: 150 * MB })
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toEqual({
      outcome: "blocked",
      block: {
        reason: "insufficient-storage",
        requiredBytes: 200 * MB + STORAGE_RESERVE_BYTES,
        freeBytes: 150 * MB,
      },
    })
    expect(h.transfer.run).not.toHaveBeenCalled()
    expect(h.telemetry.warn).not.toHaveBeenCalled()
  })

  it("blocks an unreadable free-space reading and starts nothing", async () => {
    const h = harness({ freeBytes: 0 })
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toEqual({
      outcome: "blocked",
      block: { reason: "unreadable-free" },
    })
    expect(h.transfer.run).not.toHaveBeenCalled()
  })

  it("blocks when the free-space read itself throws", async () => {
    const h = harness()
    h.fs.freeDiskBytes.mockRejectedValueOnce(new Error("statfs failed"))
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toEqual({
      outcome: "blocked",
      block: { reason: "unreadable-free" },
    })
    expect(h.transfer.run).not.toHaveBeenCalled()
  })

  it("resumes the same transfer once after connectivity loss", async () => {
    const h = harness({
      reports: [interrupted({ kind: "connectivity" }), DONE],
    })
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toMatchObject({ outcome: "staged" })
    expect(h.transfer.run).toHaveBeenCalledTimes(2)
    expect(h.specs[1]).toEqual(h.specs[0])
  })

  it("fails after a second connectivity loss", async () => {
    const h = harness({ reports: [interrupted({ kind: "connectivity" })] })
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toMatchObject({
      outcome: "failed",
      failure: { cause: "connectivity" },
    })
    expect(h.transfer.run).toHaveBeenCalledTimes(2)
  })

  it("fails after a second backgrounded-transient stop", async () => {
    const h = harness({
      reports: [interrupted({ kind: "backgroundedTransient" })],
    })
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toMatchObject({
      outcome: "failed",
      failure: { cause: "backgroundedTransient" },
    })
    expect(h.transfer.run).toHaveBeenCalledTimes(2)
  })

  it("blocks a wifi-only-on-cellular stop instead of failing it", async () => {
    const h = harness({
      reports: [interrupted({ kind: "wifiOnlyOnCellular" })],
    })
    const result = await h.decider.stageExport(makeRequest({ wifiOnly: true }))
    expect(result).toEqual({
      outcome: "blocked",
      block: { reason: "wifi-only-on-cellular" },
    })
    expect(h.transfer.run).toHaveBeenCalledTimes(1)
    expect(h.telemetry.warn).not.toHaveBeenCalled()
  })

  it("reports a viewer cancel as cancelled, never as a failure", async () => {
    const h = harness({ reports: [interrupted({ kind: "userCancel" })] })
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toEqual({ outcome: "cancelled" })
    expect(h.telemetry.warn).not.toHaveBeenCalled()
  })

  it("fails when the transfer itself throws, keeping the message", async () => {
    const h = harness({ reports: [new Error("staging path is unwritable")] })
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toEqual({
      outcome: "failed",
      failure: {
        cause: "transferError",
        errorMessage: "staging path is unwritable",
      },
    })
    expect(h.telemetry.warn).toHaveBeenCalled()
  })

  it("never pauses or resumes the transfer, and exposes only cancel", async () => {
    const h = harness({
      reports: [interrupted({ kind: "connectivity" }), DONE],
    })
    await h.decider.stageExport(makeRequest())
    expect(h.transfer.pause).not.toHaveBeenCalled()
    expect(h.transfer.resume).not.toHaveBeenCalled()
    expect(Object.keys(h.decider)).not.toContain("pause")
    expect(Object.keys(h.decider)).not.toContain("resume")
    await h.decider.cancel(SLUG)
    expect(h.transfer.stop).toHaveBeenCalledWith(buildExportTaskId(SLUG))
  })

  it("forwards transfer progress to the caller", async () => {
    const onProgress = jest.fn()
    const specs: RawExportTransferSpec[] = []
    const deps: RawExportDeps = {
      fs: { freeDiskBytes: async () => 100 * GB },
      transfer: {
        run: async (spec, hooks) => {
          specs.push(spec)
          hooks.onProgress?.({ bytesDownloaded: 5, bytesTotal: 10 })
          return DONE
        },
        stop: async () => undefined,
      },
    }
    const decider = createRawExportDecider(deps)
    await decider.stageExport(makeRequest({ onProgress }))
    expect(onProgress).toHaveBeenCalledWith({
      bytesDownloaded: 5,
      bytesTotal: 10,
    })
    expect(specs).toHaveLength(1)
  })

  it("admits an export with the estimate flag the gate produced", async () => {
    const h = harness()
    const admission = await h.decider.admit(
      makeRequest({ rendition: { ...RENDITION, sizeBytes: null } }),
    )
    expect(admission).toMatchObject({
      kind: "admitted",
      storage: { kind: "ok", lowerBound: true },
    })
  })

  it("admits straight from the storage gate with no permission step", async () => {
    const h = harness()
    const admission = await h.decider.admit(makeRequest())
    // toEqual pins the whole shape, so no grant flag or refusal can return.
    expect(admission).toEqual({
      kind: "admitted",
      spec: {
        id: buildExportTaskId(SLUG),
        url: RENDITION.url,
        destination: STAGED_PATH,
        allowCellular: true,
      },
      storage: {
        kind: "ok",
        requiredBytes: 200 * MB + STORAGE_RESERVE_BYTES,
        freeBytes: 100 * GB,
        lowerBound: false,
      },
    })
    expect(h.fs.freeDiskBytes).toHaveBeenCalledTimes(1)
    expect(h.transfer.run).not.toHaveBeenCalled()
  })
})
