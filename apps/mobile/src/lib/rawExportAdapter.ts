/**
 * The raw export's impure edge: the staging file and the copy into the folder
 * the viewer picked. Every crossing arrives injected — the transfer port, the
 * filesystem, the destination and the report channel — so this module imports no
 * native code and jest needs no native mock.
 *
 * Wiring for the app (owned by the surfaces that start an export): `port` is
 * `createTransferPort` over `downloadEngine`, `fs.copyFile` is `copyAsync` from
 * `expo-file-system/legacy`, `destination` is `expo-file-system`'s `Directory`
 * and `File`, and `report` is `publishExportReport`.
 */

import type { ExportReportSignal } from "../components/ExportReportHost"
import { telemetryErrorMessage } from "./downloadErrors"
import type { DownloadTelemetry } from "./downloadRequestBuilders"
import {
  getExportSessionStore,
  type ExportOutcome,
  type ExportSessionStore,
  type ExportStagingNote,
} from "./exportSession"
import type { OfflineDownloadRecord } from "./offlineManifest"
import {
  createRawExportDecider,
  exportFolderName,
  type ExportBlock,
  type ExportFolder,
  type RawExportRendition,
  type RawExportRequest,
  type RawExportTransferHooks,
  type RawExportTransferReport,
  type RawExportTransferSpec,
} from "./rawExport"
import {
  adoptStagedPath,
  buildExportFileName,
  buildExportTaskId,
  buildStagedExportPath,
  exportStagingDir,
  suffixFileName,
} from "./transferPort"

/** Where a finished export lands, and how the viewer names it. */
export type ExportDestinationPort = {
  /**
   * Present the platform's folder picker. Null means no folder — a dismissal or
   * a picker that could not open, which are the same thing to the caller.
   */
  pickFolder: () => Promise<ExportFolder | null>
  /**
   * Every entry name in the folder. The free-name search reads the whole list
   * once, because Android resolves no per-name probe against a SAF tree.
   */
  listNames: (folder: ExportFolder) => Promise<readonly string[]>
  /**
   * Copy the staged file into the folder under `fileName`. It resolves only
   * once the bytes are there, so a resolution is what lets the stage be deleted.
   */
  copyInto: (args: {
    stagedPath: string
    folder: ExportFolder
    fileName: string
  }) => Promise<void>
  /** Remove a file the folder holds under this name, if it holds one. */
  removeIfExists: (args: {
    folder: ExportFolder
    fileName: string
  }) => Promise<void>
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
  /** Resolves false when there was no live transfer to hold, or the engine
   *  refused — the session then rolls its optimistic flag back. */
  pauseExportTransfer: (taskId: string) => Promise<boolean>
  resumeExportTransfer: (taskId: string) => Promise<boolean>
  signalBackgroundCompletion: (taskId: string) => void
}

export type RawExportAdapterDeps = {
  /** KTD2: the staging root, a SIBLING of the offline root. */
  exportRoot: string
  port: ExportTransferPort
  fs: ExportFileSystemPort
  destination: ExportDestinationPort
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
  /** The folder the viewer picked before the run started. */
  folder: ExportFolder
  seriesSlug?: string | null
  /** Episodes this run covers, so the report folds them into one. */
  runSize?: number
  runExports?: RawExportRequest["runExports"]
  subtitleHiddenByRawMode?: RawExportRequest["subtitleHiddenByRawMode"]
}

export type RawExportResult =
  /** R27: the target is already exporting, so nothing started. */
  | { kind: "already-exporting" }
  | {
      kind: "settled"
      outcome: ExportOutcome
      reused: boolean
    }

export type RawExportAdapter = ReturnType<typeof createRawExportAdapter>

/** Viewer-facing reason for a block. The raw error text never reaches here. */
function blockDetail(block: ExportBlock): string {
  switch (block.reason) {
    case "insufficient-storage":
      return "There is not enough free space on this device."
    case "unreadable-free":
      return "The app could not read the free space on this device."
    case "wifi-only-on-cellular":
      return "Wi-Fi only is on and this device is on mobile data."
    case "invalid-url":
      return "This video's download address could not be used."
  }
}

/** Bound on the de-duplicating name search, so a full folder cannot spin. */
const MAX_NAME_ATTEMPTS = 50

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

  /**
   * A name already in use makes the copy throw, so the free name is found
   * first. One listing answers every candidate, and a folder that already holds
   * all of them keeps the last name so the copy reports the collision.
   */
  const freeFileName = async (
    folder: ExportFolder,
    fileName: string,
  ): Promise<string> => {
    const taken = new Set(await deps.destination.listNames(folder))
    for (let index = 1; index <= MAX_NAME_ATTEMPTS; index += 1) {
      const candidate = suffixFileName(fileName, index)
      if (!taken.has(candidate)) return candidate
    }
    return suffixFileName(fileName, MAX_NAME_ATTEMPTS)
  }

  /** The copy into the viewer's folder — the step that replaces R17's write. */
  const copyToFolder = async (
    stagedPath: string,
    folder: ExportFolder,
    title: string | null,
    fallbackName: string,
  ): Promise<void> => {
    const fileName = await freeFileName(
      folder,
      buildExportFileName(title, fallbackName),
    )
    try {
      await deps.destination.copyInto({ stagedPath, folder, fileName })
    } catch (error) {
      // R18 reaches the destination too: a copy that fails part way leaves a
      // truncated file under the final name, and nothing else ever removes it.
      await deps.destination
        .removeIfExists({ folder, fileName })
        .catch(() => undefined)
      throw error
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
    const stagingDir = exportStagingDir(deps.exportRoot, target)
    const initialPath = buildStagedExportPath({
      root: deps.exportRoot,
      videoSlug: target,
      title: input.title,
      fallbackName: target,
    })

    let reused = false
    let stagedPath = initialPath
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
        // Returned, not discarded: the port answers whether it actually
        // suspended, and the session rolls its flag back when it did not.
        onPause: () => deps.port.pauseExportTransfer(taskId),
        onResume: () => deps.port.resumeExportTransfer(taskId),
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
          transfer: {
            run: async (spec, hooks) => {
              await deps.fs.ensureDirectory(stagingDir)
              // The note lands BEFORE the bytes, so a process killed mid-transfer
              // leaves a discardable stage rather than an unattributable file.
              await handle.stage({
                stagedPath: initialPath,
                runSize: input.runSize,
              })
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
            if (admission.kind === "failed") return "failed"

            await deps.fs.ensureDirectory(stagingDir)
            await handle.stage({
              stagedPath: initialPath,
              runSize: input.runSize,
            })
            // R38: the folder gets a DUPLICATE, so a viewer who later deletes
            // the saved file still has the offline copy.
            await deps.fs.copyFile(reusable, initialPath)
            reused = true
          } else {
            const staged = await decider.stageExport(request)
            if (staged.outcome === "blocked") {
              detail = blockDetail(staged.block)
              return "blocked"
            }
            if (staged.outcome === "cancelled") return "cancelled"
            if (staged.outcome === "failed") return "failed"
            // The engine reports where the bytes landed, with the scheme
            // stripped, and a location outside the export root is not ours.
            const adopted = adoptStagedPath(staged.stagedPath, deps.exportRoot)
            if (adopted) stagedPath = adopted
          }

          await handle.stage({
            stagedPath,
            runSize: input.runSize,
          })

          if (handle.isCancelRequested()) return "cancelled"

          await copyToFolder(stagedPath, input.folder, input.title, target)
          // AFTER the copy, not before it: the signal releases the shared
          // background-session handler, and iOS may suspend the process once it
          // lands. The engine still fires it 30s after IT got the handler, so
          // this buys the copy that window, not an open-ended one.
          deps.port.signalBackgroundCompletion(taskId)
          info("raw_export.saved", {
            export_state: "saved",
            export_target: target,
            export_reused: reused,
          })
          // A stop that landed while the copy was in flight would otherwise be
          // swallowed by the "saved" outcome, and a series run reads that
          // outcome to decide whether to start the next episode. R22 keeps this
          // file: it is already in the viewer's folder.
          if (handle.isCancelRequested()) return "cancelled"
          return "saved"
        } catch (error) {
          warn("raw_export.failed", {
            export_state: "failed",
            export_target: target,
            export_failure_cause: "destinationWriteError",
            error_message: telemetryErrorMessage(error),
          })
          return "failed"
        } finally {
          // R18: every terminal outcome leaves the export root empty.
          await safeRemove(stagingDir)
        }
      },
    )

    if (!result.started) return { kind: "already-exporting" }

    deps.report({
      runId: input.runId,
      target,
      outcome: result.outcome,
      runSize: input.runSize,
      title: input.title,
      folderName: exportFolderName(input.folder.uri),
      detail,
    })
    return {
      kind: "settled",
      outcome: result.outcome,
      reused,
    }
  }

  /**
   * R27 again, not a second lock: a relaunch sweep runs beside a viewer who
   * retries the same video, and the note's staged file and directory belong to
   * whichever of the two holds the target's slot.
   */
  const SKIPPED: ExportOutcome = "abandoned"

  /**
   * Every staged file a killed process left behind. The folder the viewer
   * picked was a live grant, and it died with that process, so the bytes cannot
   * be copied anywhere now — R28's completion path has no equivalent here.
   */
  async function discardStagedExport(
    note: ExportStagingNote,
  ): Promise<ExportOutcome> {
    const result = await store().run(
      { target: note.target, runId: note.runId },
      async (): Promise<ExportOutcome> => {
        await safeRemove(exportStagingDir(deps.exportRoot, note.target))
        return "abandoned"
      },
    )
    if (!result.started) return SKIPPED

    deps.report({
      runId: note.runId,
      target: note.target,
      outcome: result.outcome,
      runSize: note.runSize,
    })
    return result.outcome
  }

  /** R22, R30: the viewer's cancel channel for one target. */
  function cancelExport(videoSlug: string): boolean {
    return store().requestCancel(videoSlug)
  }

  /** The viewer's pause channel. The slot and the partial file both survive. */
  function pauseExport(videoSlug: string): boolean {
    return store().requestPause(videoSlug)
  }

  /** The viewer's resume channel — continues in place, never a restart. */
  function resumeExport(videoSlug: string): boolean {
    return store().requestResume(videoSlug)
  }

  /**
   * Ask the viewer where to save. The surfaces call this BEFORE they start a
   * run, while their sheet is still on screen — a headless run cannot present a
   * picker, and a series threads one answer through every episode.
   */
  function pickExportFolder(): Promise<ExportFolder | null> {
    return deps.destination.pickFolder()
  }

  return {
    exportVideo,
    pickExportFolder,
    discardStagedExport,
    cancelExport,
    pauseExport,
    resumeExport,
  }
}
