import type { TransferInterruption } from "../downloadOutcome"
import { STORAGE_RESERVE_BYTES } from "../offlineConstants"
import {
  buildExportTaskId,
  buildExportTransferSpec,
  classifyLibraryPermission,
  createRawExportDecider,
  decideExportInterruption,
  evaluateExportStorageGate,
  exportTargetFromTaskId,
  isExportTaskId,
  RAW_EXPORT_MAX_RESUMES,
  refusalFromPermission,
  type LibraryPermissionResponse,
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

const GRANTED_FULL: LibraryPermissionResponse = {
  status: "granted",
  granted: true,
  canAskAgain: true,
  accessPrivileges: "all",
}

const GRANTED_ADD_ONLY: LibraryPermissionResponse = {
  status: "granted",
  granted: true,
  canAskAgain: true,
  accessPrivileges: "limited",
}

const REFUSED_FIRST: LibraryPermissionResponse = {
  status: "denied",
  granted: false,
  canAskAgain: true,
}

const REFUSED_PERMANENTLY: LibraryPermissionResponse = {
  status: "denied",
  granted: false,
  canAskAgain: false,
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
    permissions?: LibraryPermissionResponse[]
    requestResponse?: LibraryPermissionResponse
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

  const permissions = options.permissions ?? [GRANTED_FULL]
  let permissionIndex = 0
  const library = {
    getPermission: jest.fn(async () => {
      const response =
        permissions[Math.min(permissionIndex, permissions.length - 1)]
      permissionIndex += 1
      return response
    }),
    requestPermission: jest.fn(
      async () => options.requestResponse ?? GRANTED_FULL,
    ),
  }

  const fs = {
    freeDiskBytes: jest.fn(async () => options.freeBytes ?? 100 * GB),
  }
  const telemetry = { info: jest.fn(), warn: jest.fn() }
  const deps: RawExportDeps = { fs, library, transfer, telemetry }

  return {
    decider: createRawExportDecider(deps),
    specs,
    transfer,
    library,
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
  it("counts one staged copy beside the library copy plus the reserve", () => {
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

describe("library permission classification (R25, R26)", () => {
  it("reads a full grant as granted with full access", () => {
    expect(classifyLibraryPermission(GRANTED_FULL)).toEqual({
      kind: "granted",
      fullAccess: true,
    })
  })

  it("reads an add-only grant as granted without full access", () => {
    expect(classifyLibraryPermission(GRANTED_ADD_ONLY)).toEqual({
      kind: "granted",
      fullAccess: false,
    })
  })

  it("distinguishes a permanent refusal from a first refusal (AE10)", () => {
    const first = classifyLibraryPermission(REFUSED_FIRST)
    const permanent = classifyLibraryPermission(REFUSED_PERMANENTLY)
    expect(first).toEqual({ kind: "refused", canAskAgain: true })
    expect(permanent).toEqual({ kind: "refused", canAskAgain: false })
    if (first.kind !== "refused" || permanent.kind !== "refused") {
      throw new Error("both responses must classify as a refusal")
    }
    expect(refusalFromPermission(first)).toEqual({
      reason: "permission-denied",
      canAskAgain: true,
      offerSettings: false,
    })
    expect(refusalFromPermission(permanent)).toEqual({
      reason: "permission-denied",
      canAskAgain: false,
      offerSettings: true,
    })
  })

  it("fails closed on a missing or unreadable response", () => {
    expect(classifyLibraryPermission(null)).toEqual({
      kind: "refused",
      canAskAgain: true,
    })
    expect(classifyLibraryPermission({})).toEqual({
      kind: "refused",
      canAskAgain: true,
    })
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
  it("stages the file when storage and permission both admit it", async () => {
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
    expect(h.library.requestPermission).not.toHaveBeenCalled()
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

  it("fails, rather than refuses, when the permission read throws", async () => {
    const h = harness()
    h.library.getPermission.mockRejectedValueOnce(new Error("library is gone"))
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toEqual({
      outcome: "failed",
      failure: { cause: "permissionError", errorMessage: "library is gone" },
    })
    expect(h.transfer.run).not.toHaveBeenCalled()
  })

  it("reports a refusal as refused, never as a failure (AE11)", async () => {
    const h = harness({
      permissions: [REFUSED_FIRST],
      requestResponse: REFUSED_FIRST,
    })
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toEqual({
      outcome: "refused",
      refusal: {
        reason: "permission-denied",
        canAskAgain: true,
        offerSettings: false,
      },
    })
    expect(h.transfer.run).not.toHaveBeenCalled()
    expect(h.telemetry.warn).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain("failed")
  })

  it("offers settings on a permanent refusal and does not prompt again (AE10)", async () => {
    const h = harness({ permissions: [REFUSED_PERMANENTLY] })
    const result = await h.decider.stageExport(makeRequest())
    expect(result).toEqual({
      outcome: "refused",
      refusal: {
        reason: "permission-denied",
        canAskAgain: false,
        offerSettings: true,
      },
    })
    expect(h.library.requestPermission).not.toHaveBeenCalled()
    expect(h.telemetry.warn).not.toHaveBeenCalled()
  })

  it("treats a permission revoked between episodes as a refusal, not a transfer failure", async () => {
    const h = harness({
      permissions: [GRANTED_FULL, REFUSED_PERMANENTLY],
      reports: [DONE],
    })
    const first = await h.decider.stageExport(makeRequest())
    const second = await h.decider.stageExport(
      makeRequest({ videoSlug: "the-second-episode" }),
    )
    expect(first).toMatchObject({ outcome: "staged" })
    expect(second).toMatchObject({ outcome: "refused" })
    expect(h.transfer.run).toHaveBeenCalledTimes(1)
    expect(h.telemetry.warn).not.toHaveBeenCalled()
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
      library: {
        getPermission: async () => GRANTED_FULL,
        requestPermission: async () => GRANTED_FULL,
      },
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
      fullAccess: true,
    })
  })
})
