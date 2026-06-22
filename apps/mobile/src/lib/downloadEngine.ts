import {
  cleanup,
  completeHandler,
  createDownloadTask,
  getExistingDownloadTasks,
  setConfig,
} from "@kesha-antonov/react-native-background-downloader"

import { mapNativeError } from "./downloadErrors"
import {
  classifyInterruption,
  type OutcomeClassification,
} from "./downloadOutcome"

/**
 * Thin swappable adapter over the native background-download module (KTD1),
 * confining the native surface to one file; decisions live in the pure core.
 * Runtime behavior (background, reattach, notifications) is device-verified only.
 */

export type EngineTask = ReturnType<typeof createDownloadTask>

/**
 * Apply global engine config. iOS wifi-only is global (`allowsCellularAccess`);
 * Android's metered flag is per-download in {@link startMediaDownload}. The
 * persistent Android notification is required by the foreground service.
 */
export function configureDownloadEngine(opts: { wifiOnly: boolean }): void {
  setConfig({
    allowsCellularAccess: !opts.wifiOnly,
    showNotificationsEnabled: true,
    progressInterval: 1000,
  })
}

export type MediaDownloadHandlers = {
  /** Fires once when the transfer begins, carrying the OS-reported size. */
  onBegin?: (p: { expectedBytes: number }) => void
  onProgress: (p: { bytesDownloaded: number; bytesTotal: number }) => void
  onDone: (p: { location: string; bytesTotal: number }) => void
  onInterruption: (classification: OutcomeClassification) => void
}

/**
 * Bind native task events to our handlers. Shared by {@link startMediaDownload}
 * and {@link wireExistingTask}: a reattached task carries NO callbacks, so its
 * events fire into the void until re-bound here.
 */
function attachHandlers(
  task: EngineTask,
  handlers: MediaDownloadHandlers,
): EngineTask {
  return task
    .begin(({ expectedBytes }) => handlers.onBegin?.({ expectedBytes }))
    .progress(({ bytesDownloaded, bytesTotal }) =>
      handlers.onProgress({ bytesDownloaded, bytesTotal }),
    )
    .done(({ location, bytesTotal }) =>
      handlers.onDone({ location, bytesTotal }),
    )
    .error((params) =>
      handlers.onInterruption(classifyInterruption(mapNativeError(params))),
    )
}

export type MediaDownloadSpec = {
  /** Stable task id (the video slug, so reattach can map back to a record). */
  id: string
  url: string
  destination: string
  headers?: Record<string, string | null>
  /** Per-download cellular override (drives the Android metered flag). */
  allowCellular: boolean
}

/**
 * Start a media download, wiring native events to the pure core: progress and
 * completion pass through; errors are mapped + classified into
 * paused/failed/canceled before reaching the caller.
 */
export function startMediaDownload(
  spec: MediaDownloadSpec,
  handlers: MediaDownloadHandlers,
): EngineTask {
  // The library strips a leading `file://` from `destination` itself, so expo's
  // `documentDirectory` URI is fine to pass through.
  const task = createDownloadTask({
    id: spec.id,
    url: spec.url,
    destination: spec.destination,
    headers: spec.headers,
    isAllowedOverMetered: spec.allowCellular,
    isAllowedOverRoaming: spec.allowCellular,
  })

  attachHandlers(task, handlers)
  // start() begins the native transfer; without it no event fires and the
  // record stays "downloading" at 0 bytes. Reattached tasks are already running,
  // so wireExistingTask must NOT call start() (errors "already started").
  task.start()
  return task
}

/**
 * Re-bind handlers onto a task recovered via {@link listExistingDownloadTasks}
 * after an app restart. Without it, a post-relaunch completion fires done into a
 * callback-less task and never reaches the committed state.
 */
export function wireExistingTask(
  task: EngineTask,
  handlers: MediaDownloadHandlers,
): void {
  attachHandlers(task, handlers)
}

/** Live native tasks surviving from a prior session — feeds reconciliation. */
export function listExistingDownloadTasks(): Promise<EngineTask[]> {
  return getExistingDownloadTasks()
}

/** iOS: tell the OS the background-session work for this job is finished. */
export function notifyIosBackgroundComplete(jobId: string): void {
  void completeHandler(jobId)
}

/** Release native event listeners before hot reload / teardown. */
export function cleanupDownloadEngine(): void {
  cleanup()
}
