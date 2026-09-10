/**
 * KTD1: the one seam both transfer consumers cross. The background engine is
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

export { classifyInterruption as translateInterruptionForOffline } from "./downloadOutcome"
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
 * The engine's reported location in the root's URI form, because the library
 * write still needs the `file://` the engine stripped. Null outside the root,
 * which is neither ours to save nor ours to delete.
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

export function createTransferPort(deps: TransferPortDeps) {
  const live = new Map<string, EngineTask>()

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
        // exception: the adapter signals it after the staging note lands.
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
          onInterruption: (classification, meta) =>
            settle({
              kind: "interrupted",
              interruption:
                meta?.interruption ??
                interruptionFromClassification(classification),
            }),
        },
      )
      live.set(spec.id, task)
    })

  /** R24: cancel is the only control an export exposes over its transfer. */
  const stopExportTransfer = async (taskId: string): Promise<void> => {
    const task = live.get(taskId)
    if (!task) return
    live.delete(taskId)
    await deps.stop(task)
  }

  return { runExportTransfer, stopExportTransfer, signalBackgroundCompletion }
}
