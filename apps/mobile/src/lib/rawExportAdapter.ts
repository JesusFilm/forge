/**
 * The raw export's impure edge: the staging file, the device-library write and
 * the app-state gate. Every crossing arrives injected — the transfer port, the
 * filesystem, the photo library, the app state and the report channel — so this
 * module imports no native code and jest needs no native mock.
 *
 * Wiring for the app (owned by the surfaces that start an export): `port` is
 * `createTransferPort` over `downloadEngine`, `fs.copyFile` is `copyAsync` from
 * `expo-file-system/legacy`, `library` is `expo-media-library`, `getAppState`
 * reads `AppState.currentState`, and `report` is `publishExportReport`.
 */

import type { ExportReportSignal } from "../components/ExportReportHost"
import type { DownloadTelemetry } from "./downloadRequestBuilders"
import {
  getExportSessionStore,
  type ExportAlbumIntent,
  type ExportOutcome,
  type ExportSessionStore,
  type ExportStagingNote,
} from "./exportSession"
import type { OfflineDownloadRecord } from "./offlineManifest"
import {
  createRawExportDecider,
  type ExportBlock,
  type LibraryPermissionResponse,
  type RawExportRendition,
  type RawExportRequest,
  type RawExportTransferHooks,
  type RawExportTransferReport,
  type RawExportTransferSpec,
} from "./rawExport"
import { RAW_EXPORT_ALBUM_NAME } from "./rawExportConstants"
import {
  buildExportTaskId,
  buildStagedExportPath,
  exportStagingDir,
  isUnderExportRoot,
} from "./transferPort"

/** The photo-library surface, narrowed to the calls an add-only grant allows. */
export type ExportLibraryPort = {
  getPermission: () => Promise<LibraryPermissionResponse>
  requestPermission: () => Promise<LibraryPermissionResponse>
  /** iOS: the only add-only-safe write. It cannot name an album (R17). */
  saveToLibrary: (uri: string) => Promise<unknown>
  createAsset: (uri: string) => Promise<unknown>
  createAlbum: (
    albumName: string,
    asset: unknown,
    copyAsset: boolean,
  ) => Promise<unknown>
}

export type ExportFileSystemPort = {
  ensureDirectory: (uri: string) => Promise<unknown>
  removeUri: (uri: string) => Promise<unknown>
  copyFile: (from: string, to: string) => Promise<unknown>
  fileExists: (uri: string) => Promise<boolean>
  freeDiskBytes: () => Promise<number>
}

export type ExportTransferPort = {
  runExportTransfer: (
    spec: RawExportTransferSpec,
    hooks: RawExportTransferHooks,
  ) => Promise<RawExportTransferReport>
  stopExportTransfer: (taskId: string) => Promise<void>
  signalBackgroundCompletion: (taskId: string) => void
}

export type RawExportAdapterDeps = {
  /** KTD2: the staging root, a SIBLING of the offline root. */
  exportRoot: string
  port: ExportTransferPort
  fs: ExportFileSystemPort
  library: ExportLibraryPort
  /** R17: only Android can create the named album under an add-only grant. */
  platform: "ios" | "android"
  /** KTD4: `AppState.currentState`; the library write needs "active". */
  getAppState: () => string
  /** R13: read-only. An export never creates, replaces or deletes a record. */
  findOfflineRecord: (
    videoSlug: string,
  ) => OfflineDownloadRecord | null | undefined
  report: (signal: ExportReportSignal) => void
  session?: ExportSessionStore
  telemetry?: DownloadTelemetry
  reserveBytes?: number
}

export type RawExportInput = {
  videoSlug: string
  runId: string
  title: string | null
  rendition: RawExportRendition
  wifiOnly: boolean
  seriesSlug?: string | null
  /** Episodes this run covers, so the report folds them into one. */
  runSize?: number
  runExports?: RawExportRequest["runExports"]
  subtitleHiddenByRawMode?: RawExportRequest["subtitleHiddenByRawMode"]
}

export type RawExportResult =
  /** R27: the target is already exporting, so nothing started. */
  | { kind: "already-exporting" }
  /** KTD4: staged, but the library write waits for an active app. */
  | { kind: "deferred"; stagedPath: string }
  | {
      kind: "settled"
      outcome: ExportOutcome
      albumIntent: ExportAlbumIntent | null
      reused: boolean
    }

export type RawExportAdapter = ReturnType<typeof createRawExportAdapter>

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Viewer-facing reason for a block. The raw error text never reaches here. */
function blockDetail(block: ExportBlock): string {
  switch (block.reason) {
    case "insufficient-storage":
      return "There is not enough free space on this device."
    case "unreadable-free":
      return "The app could not read the free space on this device."
    case "wifi-only-on-cellular":
      return "Wi-Fi only is on and this device is on mobile data."
  }
}

export function createRawExportAdapter(deps: RawExportAdapterDeps) {
  const store = (): ExportSessionStore =>
    deps.session ?? getExportSessionStore()
  const info = (message: string, context: Record<string, unknown>): void => {
    deps.telemetry?.info(message, context)
  }
  const warn = (message: string, context: Record<string, unknown>): void => {
    deps.telemetry?.warn(message, context)
  }

  /** A cleanup fault must never replace the outcome the export reached. */
  const safeRemove = async (uri: string): Promise<void> => {
    try {
      await deps.fs.removeUri(uri)
    } catch {
      // Deliberately ignored; see the note above.
    }
  }

  const albumIntentForPlatform = (): ExportAlbumIntent =>
    deps.platform === "android" ? "album" : "library"

  /**
   * R17: the asset lands in the library FIRST, so a missing album can never
   * fail an export — it only changes what the confirmation names.
   */
  const writeToLibrary = async (
    stagedPath: string,
    intent: ExportAlbumIntent,
  ): Promise<{ intent: ExportAlbumIntent }> => {
    if (intent !== "album") {
      await deps.library.saveToLibrary(stagedPath)
      return { intent: "library" }
    }
    const asset = await deps.library.createAsset(stagedPath)
    try {
      await deps.library.createAlbum(RAW_EXPORT_ALBUM_NAME, asset, false)
      return { intent: "album" }
    } catch (error) {
      warn("raw_export.album_unavailable", {
        export_state: "saved",
        export_album_intent: "library",
        error_message: errorMessageOf(error),
      })
      return { intent: "library" }
    }
  }

  /**
   * KTD14: the match is exact and non-empty. Rendition identities are not
   * reliably unique in the sheet's own data, where an unset value is "".
   */
  const findReusableCopy = async (
    videoSlug: string,
    renditionDocumentId: string,
  ): Promise<string | null> => {
    if (renditionDocumentId.length === 0) return null
    const record = deps.findOfflineRecord(videoSlug)
    if (!record || record.state !== "downloaded") return null
    if (record.renditionDocumentId !== renditionDocumentId) return null
    const committedPath = record.committedPath
    if (!committedPath) return null
    return (await deps.fs.fileExists(committedPath)) ? committedPath : null
  }

  async function exportVideo(input: RawExportInput): Promise<RawExportResult> {
    const target = input.videoSlug
    const taskId = buildExportTaskId(target)
    const albumIntent = albumIntentForPlatform()
    const stagingDir = exportStagingDir(deps.exportRoot, target)
    const initialPath = buildStagedExportPath({
      root: deps.exportRoot,
      videoSlug: target,
      title: input.title,
      fallbackName: target,
    })

    let deferred = false
    let reused = false
    let stagedPath = initialPath
    let achievedIntent: ExportAlbumIntent | null = null
    let canAskAgain: boolean | undefined
    let detail: string | null = null

    const result = await store().run(
      {
        target,
        runId: input.runId,
        title: input.title,
        seriesSlug: input.seriesSlug ?? null,
        onCancel: () => {
          void deps.port.stopExportTransfer(taskId)
        },
      },
      async (handle): Promise<ExportOutcome> => {
        const request: RawExportRequest = {
          videoSlug: target,
          rendition: input.rendition,
          stagedPath: initialPath,
          wifiOnly: input.wifiOnly,
          subtitleHiddenByRawMode: input.subtitleHiddenByRawMode ?? null,
          runExports: input.runExports,
          onProgress: ({ bytesDownloaded, bytesTotal }) =>
            handle.publishProgress(
              bytesTotal > 0 ? bytesDownloaded / bytesTotal : 0,
            ),
        }

        const decider = createRawExportDecider({
          fs: { freeDiskBytes: deps.fs.freeDiskBytes },
          library: {
            getPermission: deps.library.getPermission,
            requestPermission: deps.library.requestPermission,
          },
          transfer: {
            run: async (spec, hooks) => {
              await deps.fs.ensureDirectory(stagingDir)
              // The note lands BEFORE the bytes, so a process killed mid-transfer
              // leaves a discardable stage rather than an unattributable file.
              await handle.stage({ stagedPath: initialPath, albumIntent })
              return deps.port.runExportTransfer(spec, hooks)
            },
            stop: (id) => deps.port.stopExportTransfer(id),
          },
          telemetry: deps.telemetry,
          reserveBytes: deps.reserveBytes,
        })

        try {
          const reusable = await findReusableCopy(
            target,
            input.rendition.documentId,
          )

          if (reusable) {
            const admission = await decider.admit(request)
            if (admission.kind === "blocked") {
              detail = blockDetail(admission.block)
              return "blocked"
            }
            if (admission.kind === "refused") {
              canAskAgain = admission.refusal.canAskAgain
              return "refused"
            }
            if (admission.kind === "failed") return "failed"

            await deps.fs.ensureDirectory(stagingDir)
            await handle.stage({ stagedPath: initialPath, albumIntent })
            // R38: the library gets a DUPLICATE, so a platform that consumes
            // what it is handed cannot destroy the offline copy.
            await deps.fs.copyFile(reusable, initialPath)
            reused = true
          } else {
            const staged = await decider.stageExport(request)
            if (staged.outcome === "blocked") {
              detail = blockDetail(staged.block)
              return "blocked"
            }
            if (staged.outcome === "refused") {
              canAskAgain = staged.refusal.canAskAgain
              return "refused"
            }
            if (staged.outcome === "cancelled") return "cancelled"
            if (staged.outcome === "failed") return "failed"
            // The engine reports where the bytes landed; a location outside the
            // export root is not ours to save or delete.
            if (isUnderExportRoot(staged.stagedPath, deps.exportRoot)) {
              stagedPath = staged.stagedPath
            }
          }

          await handle.stage({ stagedPath, albumIntent })
          await handle.markTransferFinished()
          // End of staging, not end of the export: a missed signal throttles
          // later background transfers app-wide, offline ones included.
          deps.port.signalBackgroundCompletion(taskId)

          if (handle.isCancelRequested()) return "cancelled"

          if (deps.getAppState() !== "active") {
            // KTD4: a completion callback does not imply the foreground, so the
            // note outlives this run and a later transition finishes the write.
            handle.deferStagingNote()
            deferred = true
            return "abandoned"
          }

          const written = await writeToLibrary(stagedPath, albumIntent)
          achievedIntent = written.intent
          info("raw_export.saved", {
            export_state: "saved",
            export_target: target,
            export_album_intent: achievedIntent,
            export_reused: reused,
          })
          return "saved"
        } catch (error) {
          warn("raw_export.failed", {
            export_state: "failed",
            export_target: target,
            export_failure_cause: "libraryWriteError",
            error_message: errorMessageOf(error),
          })
          return "failed"
        } finally {
          // R18: every terminal outcome leaves the export root empty. The
          // deferred hand-off is the one exit that must keep its staged file.
          if (!deferred) await safeRemove(stagingDir)
        }
      },
    )

    if (!result.started) return { kind: "already-exporting" }
    if (deferred) return { kind: "deferred", stagedPath }

    deps.report({
      runId: input.runId,
      target,
      outcome: result.outcome,
      runSize: input.runSize,
      title: input.title,
      albumIntent: achievedIntent ?? undefined,
      canAskAgain,
      detail,
    })
    return {
      kind: "settled",
      outcome: result.outcome,
      albumIntent: achievedIntent,
      reused,
    }
  }

  /**
   * R28: finish the library write a killed or backgrounded process never ran.
   * The note is persisted JSON, so a path outside the export root is neither
   * saved nor deleted.
   */
  async function completeStagedExport(
    note: ExportStagingNote,
  ): Promise<ExportOutcome> {
    const stagingDir = exportStagingDir(deps.exportRoot, note.target)
    let outcome: ExportOutcome = "abandoned"
    let intent: ExportAlbumIntent | null = null

    try {
      const usable =
        isUnderExportRoot(note.stagedPath, deps.exportRoot) &&
        (await deps.fs.fileExists(note.stagedPath))
      if (usable) {
        const written = await writeToLibrary(note.stagedPath, note.albumIntent)
        intent = written.intent
        outcome = "saved"
      }
    } catch (error) {
      warn("raw_export.failed", {
        export_state: "failed",
        export_target: note.target,
        export_failure_cause: "libraryWriteError",
        error_message: errorMessageOf(error),
      })
      outcome = "failed"
    } finally {
      await safeRemove(stagingDir)
      await store()
        .clearStagingNote(note.target)
        .catch(() => undefined)
    }

    deps.report({
      runId: note.runId,
      target: note.target,
      outcome,
      albumIntent: intent ?? undefined,
    })
    return outcome
  }

  /** R18: an export interrupted during staging leaves no file behind. */
  async function discardStagedExport(
    note: ExportStagingNote,
  ): Promise<ExportOutcome> {
    await safeRemove(exportStagingDir(deps.exportRoot, note.target))
    await store()
      .clearStagingNote(note.target)
      .catch(() => undefined)
    deps.report({
      runId: note.runId,
      target: note.target,
      outcome: "abandoned",
    })
    return "abandoned"
  }

  /** R22, R30: the viewer's cancel channel for one target. */
  function cancelExport(videoSlug: string): boolean {
    return store().requestCancel(videoSlug)
  }

  return {
    exportVideo,
    completeStagedExport,
    discardStagedExport,
    cancelExport,
  }
}
