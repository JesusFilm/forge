import { telemetryErrorMessage } from "./downloadErrors"
import type { TransferInterruption } from "./downloadOutcome"
import type { DownloadTelemetry } from "./downloadRequestBuilders"
import type { ExportOutcome } from "./exportSession"
import { STORAGE_RESERVE_BYTES } from "./offlineConstants"
import { RAW_EXPORT_ID_PREFIX } from "./rawExportConstants"
import type { StorageGate } from "./seriesDownloadEnqueue"
import { validateActionUrl } from "./validateUrl"

/**
 * Every raw-export decision: the storage gate, the destination folder's display
 * name, the transfer spec and the interruption translation. Pure and React-free,
 * with each crossing injected, so jest needs no native module. All imports here
 * are type-only or plain constants.
 */

// ── Export task id (KTD2) ───────────────────────────────────────────

/** The namespaced transfer id. It can never collide with a bare video slug,
 *  which is what the offline delete path keys a whole directory on. */
export function buildExportTaskId(videoSlug: string): string {
  return `${RAW_EXPORT_ID_PREFIX}${videoSlug}`
}

export function isExportTaskId(taskId: string): boolean {
  return taskId.startsWith(RAW_EXPORT_ID_PREFIX)
}

/** The video slug an export id targets; null for any other id. */
export function exportTargetFromTaskId(taskId: string): string | null {
  return isExportTaskId(taskId)
    ? taskId.slice(RAW_EXPORT_ID_PREFIX.length)
    : null
}

// ── Storage gate (R8, KTD9) ─────────────────────────────────────────

export type ExportSizing = {
  /** Catalogue size of one export; null when the rendition size is unknown. */
  sizeBytes: number | null
}

export type ExportStorageGateInput = {
  /** One entry per saved copy the run will produce. */
  exports: ExportSizing[]
  freeBytes: number
  reserveBytes?: number
}

function knownBytes(exports: ExportSizing[]): number[] {
  return exports
    .map((item) => item.sizeBytes)
    .filter(
      (size): size is number =>
        typeof size === "number" && size > 0 && Number.isFinite(size),
    )
}

/**
 * Peak use, not cumulative use: the run stages ONE file at a time and deletes
 * each staged copy after its folder copy, so the peak is the largest single
 * file plus every saved copy plus the reserve. A reused offline copy skips the
 * transfer but still duplicates into the folder, so it counts the same.
 *
 * KTD9: this extends the aggregate fail-closed gate. An unreadable free reading
 * blocks, and an unknown rendition size makes the total a LOWER bound.
 */
export function evaluateExportStorageGate(
  input: ExportStorageGateInput,
): StorageGate {
  const { exports, freeBytes } = input
  const reserveBytes = input.reserveBytes ?? STORAGE_RESERVE_BYTES

  if (!Number.isFinite(freeBytes) || freeBytes <= 0) {
    return { kind: "unreadable-free" }
  }

  const sizes = knownBytes(exports)
  const savedBytes = sizes.reduce((total, size) => total + size, 0)
  const stagedPeakBytes = sizes.length > 0 ? Math.max(...sizes) : 0
  const requiredBytes = savedBytes + stagedPeakBytes + reserveBytes

  if (freeBytes < requiredBytes) {
    return { kind: "insufficient", requiredBytes, freeBytes }
  }
  return {
    kind: "ok",
    requiredBytes,
    freeBytes,
    lowerBound: sizes.length !== exports.length,
  }
}

// ── The destination folder ──────────────────────────────────────────

/**
 * The folder the viewer picked. The uri is opaque to every module but the
 * runtime binding: iOS hands back a security-scoped `file://` url and Android a
 * SAF `content://` tree.
 */
export type ExportFolder = {
  uri: string
}

/**
 * The on-disk name of the Files app's "On My iPhone" root. It is what the
 * picker returns for that choice, and it is not a name a viewer ever sees, so
 * the confirmation falls back to naming the Files app instead. Observed on the
 * iPhone 17 Pro Max simulator, iOS 26.5, 2026-09-15.
 */
const IOS_LOCAL_FILES_ROOT = "File Provider Storage"

/**
 * What the confirmation calls the folder. Android's SAF uri ends in an opaque
 * tree id whose readable half follows a colon, so the last path segment is
 * decoded and then cut there. Null means "no viewer-legible name".
 */
export function exportFolderName(uri: string): string | null {
  const withoutQuery = uri.split(/[?#]/)[0].replace(/\/+$/, "")
  const lastSegment = withoutQuery.split("/").pop()
  if (!lastSegment) return null
  let decoded = lastSegment
  try {
    decoded = decodeURIComponent(lastSegment)
  } catch {
    // A malformed escape is not worth failing an export that already saved.
  }
  const afterColon = decoded.slice(decoded.lastIndexOf(":") + 1)
  const name = afterColon.trim()
  if (name.length === 0 || name === IOS_LOCAL_FILES_ROOT) return null
  return name
}

// ── Interruption translation (KTD11, R24, R26) ──────────────────────

/** R24: an export has no paused state, so it resumes at most this many times. */
export const RAW_EXPORT_MAX_RESUMES = 1

export type ExportInterruptionDecision =
  | { kind: "resume" }
  | { kind: "terminate"; outcome: "failed" | "blocked" | "cancelled" }

/**
 * KTD11: the shared engine classifies three kinds as PAUSED, and an export has
 * no paused state. A self-healing stop resumes the same id once and then fails;
 * a wifi-only stop is a policy refusal, so it blocks; a viewer cancel is never
 * a failure.
 */
export function decideExportInterruption(
  interruption: TransferInterruption,
  state: { resumesUsed: number },
): ExportInterruptionDecision {
  switch (interruption.kind) {
    case "connectivity":
    case "backgroundedTransient":
      return state.resumesUsed < RAW_EXPORT_MAX_RESUMES
        ? { kind: "resume" }
        : { kind: "terminate", outcome: "failed" }
    case "wifiOnlyOnCellular":
      return { kind: "terminate", outcome: "blocked" }
    case "userCancel":
      return { kind: "terminate", outcome: "cancelled" }
    case "httpError":
    case "integrity":
    case "storageFull":
      return { kind: "terminate", outcome: "failed" }
  }
}

// ── Transfer spec (R9, R23) ─────────────────────────────────────────

export type RawExportRendition = {
  /** Rendition identity, so a completed offline copy can be matched (R36). */
  documentId: string
  qualityLabel: string
  url: string
  /** Catalogue size; null when unknown, which makes the total a lower bound. */
  sizeBytes: number | null
}

/** Structurally a `MediaDownloadSpec` minus the offline-only fields. */
export type RawExportTransferSpec = {
  id: string
  url: string
  destination: string
  /** R9: false whenever the wifi-only preference is on. */
  allowCellular: boolean
}

/** R23: the input names no subtitle, so a hidden subtitle cannot reach the wire. */
export function buildExportTransferSpec(input: {
  videoSlug: string
  rendition: RawExportRendition
  stagedPath: string
  wifiOnly: boolean
}): RawExportTransferSpec {
  return {
    id: buildExportTaskId(input.videoSlug),
    url: input.rendition.url,
    destination: input.stagedPath,
    allowCellular: !input.wifiOnly,
  }
}

// ── The decider ─────────────────────────────────────────────────────

export type RawExportTransferHooks = {
  onProgress?: (progress: {
    bytesDownloaded: number
    bytesTotal: number
  }) => void
}

export type RawExportTransferReport =
  | { kind: "done"; stagedPath: string; bytesTotal: number }
  | { kind: "interrupted"; interruption: TransferInterruption }

export type RawExportDeps = {
  fs: { freeDiskBytes: () => Promise<number> }
  /** The staging transfer. R24 gives it no pause and no resume. */
  transfer: {
    run: (
      spec: RawExportTransferSpec,
      hooks: RawExportTransferHooks,
    ) => Promise<RawExportTransferReport>
    stop: (taskId: string) => Promise<void> | void
  }
  telemetry?: DownloadTelemetry
  reserveBytes?: number
}

export type RawExportRequest = {
  videoSlug: string
  rendition: RawExportRendition
  /** Where the port stages the bytes, outside the offline root. */
  stagedPath: string
  wifiOnly: boolean
  /**
   * R23: the sheet still holds the viewer's subtitle choice while raw mode hides
   * it. It is accepted here and ignored, so no caller can slip it into a spec.
   */
  subtitleHiddenByRawMode?: {
    languageSlug: string
    url: string
    sizeBytes?: number | null
  } | null
  /** Every saved copy still ahead in this run; defaults to this export alone. */
  runExports?: ExportSizing[]
  onProgress?: RawExportTransferHooks["onProgress"]
}

export type ExportBlock =
  | { reason: "insufficient-storage"; requiredBytes: number; freeBytes: number }
  | { reason: "unreadable-free" }
  | { reason: "wifi-only-on-cellular" }
  /** The rendition URL failed the CMS-URL check every consumer of admin data
   *  runs before handing a URL to the native downloader. */
  | { reason: "invalid-url" }

export type ExportFailure = {
  cause: TransferInterruption["kind"] | "transferError"
  /** Already sanitized. A transfer error carries the signed media URL, so the
   *  field never holds raw text — not even before it reaches telemetry. */
  errorMessage: string | null
}

/** The terminal vocabulary is the session store's, minus the states this
 *  module cannot reach (`saved` needs the copy into the folder; `abandoned`
 *  needs a process death). */
type TerminalOutcome = Extract<
  ExportOutcome,
  "blocked" | "cancelled" | "failed"
>

export type RawExportAdmission =
  | {
      kind: "admitted"
      spec: RawExportTransferSpec
      storage: Extract<StorageGate, { kind: "ok" }>
    }
  | { kind: "blocked"; block: ExportBlock }
  | { kind: "failed"; failure: ExportFailure }

export type RawExportStageResult =
  | {
      outcome: "staged"
      stagedPath: string
      bytesTotal: number
      spec: RawExportTransferSpec
    }
  | { outcome: Extract<TerminalOutcome, "blocked">; block: ExportBlock }
  | { outcome: Extract<TerminalOutcome, "cancelled"> }
  | { outcome: Extract<TerminalOutcome, "failed">; failure: ExportFailure }

/**
 * One export's decisions, from admission to a staged file. The copy into the
 * viewer's folder, the staging note and the file removals belong to the port, so
 * this factory stops at the staged bytes.
 */
export function createRawExportDecider(deps: RawExportDeps) {
  const info = (message: string, context: Record<string, unknown>): void => {
    deps.telemetry?.info(message, context)
  }
  const warn = (message: string, context: Record<string, unknown>): void => {
    deps.telemetry?.warn(message, context)
  }

  const readFreeBytes = async (): Promise<number> => {
    try {
      return await deps.fs.freeDiskBytes()
    } catch {
      // A failed read is unreadable, and KTD9 blocks on unreadable.
      return 0
    }
  }

  const admit = async (
    request: RawExportRequest,
  ): Promise<RawExportAdmission> => {
    // The rendition URL is admin-sourced, and CLAUDE.md requires every such URL
    // to pass validateUrl before it reaches the native downloader. The offline
    // path guards the same field in downloadLifecycle; this is its twin.
    if (!validateActionUrl(request.rendition.url)) {
      info("raw_export.blocked", {
        export_state: "blocked",
        export_block_reason: "invalid-url",
      })
      return { kind: "blocked", block: { reason: "invalid-url" } }
    }

    const freeBytes = await readFreeBytes()
    const gate = evaluateExportStorageGate({
      exports: request.runExports ?? [
        { sizeBytes: request.rendition.sizeBytes },
      ],
      freeBytes,
      reserveBytes: deps.reserveBytes,
    })

    if (gate.kind === "unreadable-free") {
      info("raw_export.blocked", {
        export_state: "blocked",
        export_target: request.videoSlug,
        export_block_reason: "unreadable-free",
      })
      return { kind: "blocked", block: { reason: "unreadable-free" } }
    }
    if (gate.kind === "insufficient") {
      info("raw_export.blocked", {
        export_state: "blocked",
        export_target: request.videoSlug,
        export_block_reason: "insufficient-storage",
        export_required_bytes: gate.requiredBytes,
        export_free_bytes: gate.freeBytes,
      })
      return {
        kind: "blocked",
        block: {
          reason: "insufficient-storage",
          requiredBytes: gate.requiredBytes,
          freeBytes: gate.freeBytes,
        },
      }
    }

    // No permission step: the viewer already named a folder, and the picker
    // that asked is the consent. A folder the app cannot write to fails at the
    // copy, which is the only place that can tell.
    return {
      kind: "admitted",
      spec: buildExportTransferSpec({
        videoSlug: request.videoSlug,
        rendition: request.rendition,
        stagedPath: request.stagedPath,
        wifiOnly: request.wifiOnly,
      }),
      storage: gate,
    }
  }

  const stageExport = async (
    request: RawExportRequest,
  ): Promise<RawExportStageResult> => {
    const admission = await admit(request)
    if (admission.kind === "blocked") {
      return { outcome: "blocked", block: admission.block }
    }
    if (admission.kind === "failed") {
      return { outcome: "failed", failure: admission.failure }
    }

    const { spec } = admission
    const hooks: RawExportTransferHooks = { onProgress: request.onProgress }
    let resumesUsed = 0

    for (;;) {
      let report: RawExportTransferReport
      try {
        report = await deps.transfer.run(spec, hooks)
      } catch (error) {
        const failure: ExportFailure = {
          cause: "transferError",
          errorMessage: telemetryErrorMessage(error),
        }
        warn("raw_export.failed", {
          export_state: "failed",
          export_target: request.videoSlug,
          export_failure_cause: failure.cause,
          error_message: failure.errorMessage,
        })
        return { outcome: "failed", failure }
      }

      if (report.kind === "done") {
        return {
          outcome: "staged",
          stagedPath: report.stagedPath,
          bytesTotal: report.bytesTotal,
          spec,
        }
      }

      const decision = decideExportInterruption(report.interruption, {
        resumesUsed,
      })
      if (decision.kind === "resume") {
        resumesUsed += 1
        info("raw_export.resumed", {
          export_state: "resuming",
          export_target: request.videoSlug,
          export_resumes_used: resumesUsed,
          export_interruption: report.interruption.kind,
        })
        continue
      }

      if (decision.outcome === "cancelled") {
        info("raw_export.cancelled", {
          export_state: "cancelled",
          export_target: request.videoSlug,
        })
        return { outcome: "cancelled" }
      }
      if (decision.outcome === "blocked") {
        info("raw_export.blocked", {
          export_state: "blocked",
          export_target: request.videoSlug,
          export_block_reason: "wifi-only-on-cellular",
        })
        return {
          outcome: "blocked",
          block: { reason: "wifi-only-on-cellular" },
        }
      }
      const failure: ExportFailure = {
        cause: report.interruption.kind,
        errorMessage: null,
      }
      warn("raw_export.failed", {
        export_state: "failed",
        export_target: request.videoSlug,
        export_failure_cause: failure.cause,
        export_resumes_used: resumesUsed,
      })
      return { outcome: "failed", failure }
    }
  }

  /** R24: cancel is the only control an export exposes. */
  const cancel = async (videoSlug: string): Promise<void> => {
    await deps.transfer.stop(buildExportTaskId(videoSlug))
  }

  return { admit, stageExport, cancel }
}

export type RawExportDecider = ReturnType<typeof createRawExportDecider>
