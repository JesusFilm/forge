/**
 * KTD1: the seam a transfer consumer crosses to reach the engine. The engine is
 * record-agnostic in name only — its task ids are bare slugs, its interruption
 * vocabulary returns offline states, and its background-completion signal is
 * keyed by that same id. This port owns those three crossings.
 *
 * It has ONE consumer today, the raw export. Moving the offline lifecycle onto
 * it is out of scope; the name describes the seam's purpose, not a second
 * caller. Every engine function arrives injected, so jest needs no native mock.
 */

// Type-only imports are erased at runtime, so this module never loads the
// native downloader. The engine seam stays in downloadEngine.ts.
import type {
  EngineTask,
  MediaDownloadHandlers,
  MediaDownloadSpec,
} from "./downloadEngine"
import type {
  OutcomeClassification,
  TransferInterruption,
} from "./downloadOutcome"
import { joinUnderRoot, sanitizeSegment } from "./offlineFiles"
import type {
  RawExportTransferHooks,
  RawExportTransferReport,
  RawExportTransferSpec,
} from "./rawExport"
import {
  RAW_EXPORT_DIR_NAME,
  RAW_EXPORT_MAX_FILENAME_LENGTH,
} from "./rawExportConstants"

// ── Id namespace (KTD2) ─────────────────────────────────────────────

// Re-exported rather than redefined: the decision core already owns the
// prefix, and one alias keeps consumers reading a single seam.
export {
  buildExportTaskId,
  exportTargetFromTaskId,
  isExportTaskId,
} from "./rawExport"

// ── Interruption translation, one per consumer (KTD1) ───────────────

// Only the export's translation lives here. The offline lifecycle still calls
// `classifyInterruption` directly, so re-exporting it under a port name would
// advertise a crossing that does not happen.
export { decideExportInterruption as translateInterruptionForExport } from "./rawExport"

// ── Staging-path namespace (KTD2) ───────────────────────────────────

const FILE_EXTENSION = ".mp4"

/**
 * The export staging root, a SIBLING of the offline root. It must never sit
 * inside it, because the offline root is also the player's trust prefix.
 */
export function buildExportRoot(
  documentDirectory: string | null | undefined,
): string {
  const base = documentDirectory ?? ""
  const withSlash = base === "" || base.endsWith("/") ? base : `${base}/`
  return `${withSlash}${RAW_EXPORT_DIR_NAME}`
}

/** One directory per target, so two exports can never share a staged file. */
export function exportStagingDir(root: string, videoSlug: string): string {
  return joinUnderRoot(root, videoSlug)
}

/**
 * R34: the saved asset takes its name from the staged file, so the viewer-legible
 * name has to live in the path. The title is untrusted, so it is sanitized on
 * the same basis as every other segment and then bounded.
 */
export function buildExportFileName(
  title: string | null | undefined,
  fallbackName: string,
): string {
  const source = title && title.trim().length > 0 ? title : fallbackName
  // A leading dot would stage a hidden file, which the launch sweep and any
  // operator listing the root would both miss.
  const safe = sanitizeSegment(source).replace(/^\.+/, "_")
  const stem = safe.slice(
    0,
    RAW_EXPORT_MAX_FILENAME_LENGTH - FILE_EXTENSION.length,
  )
  return `${stem === "" ? "_" : stem}${FILE_EXTENSION}`
}

/**
 * `Jesus.mp4` at index 2 becomes `Jesus (2).mp4`; index 1 is the bare name. The
 * stem gives up whatever the suffix needs, so a de-duplicated name still fits
 * the same bound the staged name was built to.
 */
export function suffixFileName(fileName: string, index: number): string {
  if (index <= 1) return fileName
  const dot = fileName.lastIndexOf(".")
  const hasExtension = dot > 0
  const stem = hasExtension ? fileName.slice(0, dot) : fileName
  const extension = hasExtension ? fileName.slice(dot) : ""
  const suffix = ` (${index})`
  const room = RAW_EXPORT_MAX_FILENAME_LENGTH - extension.length - suffix.length
  const trimmed = room > 0 ? stem.slice(0, room) : ""
  return `${trimmed}${suffix}${extension}`
}

/** Where one export stages its bytes. Every dynamic segment is sanitized. */
export function buildStagedExportPath(args: {
  root: string
  videoSlug: string
  title: string | null | undefined
  fallbackName: string
}): string {
  return joinUnderRoot(
    args.root,
    args.videoSlug,
    buildExportFileName(args.title, args.fallbackName),
  )
}

/** The scheme and its separator (`file://`), or "" for a bare path. */
function schemeOf(uri: string): string {
  const schemeEnd = uri.indexOf("://")
  return schemeEnd >= 0 ? uri.slice(0, schemeEnd + 3) : ""
}

/** Resolve `.` and `..` segments, and drop the scheme, so two forms of one
 *  location compare equal. */
function normalizePathBody(uri: string): string {
  const body = uri.slice(schemeOf(uri).length)
  const resolved: string[] = []
  for (const segment of body.split("/")) {
    if (segment === "" || segment === ".") continue
    if (segment === "..") {
      resolved.pop()
      continue
    }
    resolved.push(segment)
  }
  const lead = body.startsWith("/") ? "/" : ""
  return `${lead}${resolved.join("/")}`
}

/** Resolve `.` and `..` segments so a containment check reads the real path. */
export function normalizeUri(uri: string): string {
  return `${schemeOf(uri)}${normalizePathBody(uri)}`
}

/**
 * True when `path` resolves to the export root or something inside it. The
 * engine reports a location with the scheme stripped, so only the path bodies
 * compare — keeping the scheme makes this permanently false.
 */
export function isUnderExportRoot(path: string, root: string): boolean {
  const target = normalizePathBody(path)
  const base = normalizePathBody(root)
  return target === base || target.startsWith(`${base}/`)
}

/**
 * The engine's reported location in the root's URI form, because the copy into
 * the chosen folder still needs the `file://` the engine stripped. Null outside
 * the root, which is neither ours to save nor ours to delete.
 */
export function adoptStagedPath(location: string, root: string): string | null {
  if (!isUnderExportRoot(location, root)) return null
  return `${schemeOf(root)}${normalizePathBody(location)}`
}

// ── The transfer runner ─────────────────────────────────────────────

export type TransferPortDeps = {
  start: (
    spec: MediaDownloadSpec,
    handlers: MediaDownloadHandlers,
  ) => EngineTask
  stop: (task: EngineTask) => Promise<void> | void
  pause: (task: EngineTask) => Promise<void> | void
  resume: (task: EngineTask) => Promise<void> | void
  /** iOS: tells the OS the background-session work for this id is finished. */
  notifyBackgroundComplete: (taskId: string) => void
}

export type TransferPort = ReturnType<typeof createTransferPort>

/**
 * The engine reports a classification and, in practice, the raw interruption
 * beside it. The raw one is optional in the type, so this keeps the export's
 * vocabulary complete without inventing an outcome the engine did not report.
 */
function interruptionFromClassification(
  classification: OutcomeClassification,
): TransferInterruption {
  switch (classification.state) {
    case "canceled":
      return { kind: "userCancel" }
    case "paused":
      return { kind: "connectivity" }
    default:
      return { kind: "integrity" }
  }
}

type LiveTransfer = {
  task: EngineTask
  /** Set BEFORE the engine is asked to pause — see `onInterruption` below. */
  paused: boolean
  /** Lets a viewer stop settle the promise the engine will never settle. */
  settle: (report: RawExportTransferReport) => void
}

export function createTransferPort(deps: TransferPortDeps) {
  const live = new Map<string, LiveTransfer>()

  /** The shared background-session handler is released promptly, so this never
   *  rejects into a staged export that has already succeeded. */
  const signalBackgroundCompletion = (taskId: string): void => {
    try {
      deps.notifyBackgroundComplete(taskId)
    } catch {
      // Deliberately ignored; see the note above.
    }
  }

  const runExportTransfer = (
    spec: RawExportTransferSpec,
    hooks: RawExportTransferHooks,
  ): Promise<RawExportTransferReport> =>
    new Promise<RawExportTransferReport>((resolve) => {
      let settled = false
      const settle = (report: RawExportTransferReport): void => {
        if (settled) return
        settled = true
        live.delete(spec.id)
        // Every engine-reported terminal path signals. The done path is the one
        // exception: the adapter signals it after the copy lands.
        if (report.kind === "interrupted") signalBackgroundCompletion(spec.id)
        resolve(report)
      }

      const task = deps.start(
        {
          id: spec.id,
          url: spec.url,
          destination: spec.destination,
          allowCellular: spec.allowCellular,
        },
        {
          onProgress: (progress) => hooks.onProgress?.(progress),
          onDone: ({ location, bytesTotal }) =>
            settle({
              kind: "done",
              stagedPath: location || spec.destination,
              bytesTotal,
            }),
          onInterruption: (classification, meta) => {
            const interruption =
              meta?.interruption ??
              interruptionFromClassification(classification)
            // The engine reports a viewer pause AS a cancellation, so a paused
            // entry swallows exactly that one kind and stays pending. Anything
            // else — `connectivity` is the mapper's catch-all — must still
            // settle, or a real failure during a paused window goes unreported.
            if (
              live.get(spec.id)?.paused &&
              interruption.kind === "userCancel"
            ) {
              return
            }
            settle({ kind: "interrupted", interruption })
          },
        },
      )
      live.set(spec.id, { task, paused: false, settle })
    })

  /**
   * Viewer cancel. It settles the promise ITSELF: a paused task has already
   * delivered its terminal event, so `deps.stop` produces no further callback
   * and the run would otherwise await forever — holding the target's session
   * slot, its staging directory and the engine-config fence for the whole
   * process.
   */
  const stopExportTransfer = async (taskId: string): Promise<void> => {
    const entry = live.get(taskId)
    if (!entry) return
    live.delete(taskId)
    entry.settle({
      kind: "interrupted",
      interruption: { kind: "userCancel" },
    })
    await deps.stop(entry.task)
  }

  /**
   * Suspend in place, keeping the handle and the bytes already on disk.
   *
   * Answers whether it actually suspended. There is no live transfer to hold
   * while an episode reuses a local copy, and the engine can reject the call —
   * in both cases the caller must not leave the viewer looking at a held ring
   * over a transfer that is still running.
   */
  const pauseExportTransfer = async (taskId: string): Promise<boolean> => {
    const entry = live.get(taskId)
    if (!entry) return false
    if (entry.paused) return true
    entry.paused = true
    try {
      await deps.pause(entry.task)
      return true
    } catch {
      entry.paused = false
      return false
    }
  }

  /** Continue the suspended transfer — never a restart from zero. */
  const resumeExportTransfer = async (taskId: string): Promise<boolean> => {
    const entry = live.get(taskId)
    if (!entry) return false
    if (!entry.paused) return true
    entry.paused = false
    try {
      await deps.resume(entry.task)
      return true
    } catch {
      // Restore the swallow guard: the transfer is still suspended, so a
      // pause-as-cancel callback must keep being read as a pause.
      entry.paused = true
      return false
    }
  }

  return {
    runExportTransfer,
    stopExportTransfer,
    pauseExportTransfer,
    resumeExportTransfer,
    signalBackgroundCompletion,
  }
}
