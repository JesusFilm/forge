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
 * Thin adapter over the native background-download module (KTD1). Isolating the
 * module here keeps it swappable and confines the native surface to one file.
 * The engine's decisions live in the pure, unit-tested core (downloadOutcome /
 * downloadReconciliation / downloadErrors); this wrapper only translates native
 * events into those and exposes typed operations to DownloadsProvider.
 *
 * Runtime behavior (background continuation, reattach, the Android foreground
 * notification, iOS background-session completion) is verified on real devices —
 * it cannot be exercised in unit tests.
 */

export type EngineTask = ReturnType<typeof createDownloadTask>

/**
 * Apply global engine config. iOS wifi-only is global (NSURLSession
 * `allowsCellularAccess`); the Android per-task metered flag is set per download
 * in {@link startMediaDownload}. The persistent Android notification is required
 * by the foreground service and is enabled here.
 */
export function configureDownloadEngine(opts: { wifiOnly: boolean }): void {
  setConfig({
    allowsCellularAccess: !opts.wifiOnly,
    showNotificationsEnabled: true,
    progressInterval: 1000,
  })
}

export type MediaDownloadHandlers = {
  onProgress: (p: { bytesDownloaded: number; bytesTotal: number }) => void
  onDone: (p: { location: string; bytesTotal: number }) => void
  onInterruption: (classification: OutcomeClassification) => void
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
 * Start a media download and wire its native events to the pure core: progress
 * and completion pass through; an error is mapped to a TransferInterruption and
 * classified into paused/failed/canceled before reaching the caller.
 */
export function startMediaDownload(
  spec: MediaDownloadSpec,
  handlers: MediaDownloadHandlers,
): EngineTask {
  const task = createDownloadTask({
    id: spec.id,
    url: spec.url,
    destination: spec.destination,
    headers: spec.headers,
    isAllowedOverMetered: spec.allowCellular,
    isAllowedOverRoaming: spec.allowCellular,
  })

  task
    .progress(({ bytesDownloaded, bytesTotal }) =>
      handlers.onProgress({ bytesDownloaded, bytesTotal }),
    )
    .done(({ location, bytesTotal }) =>
      handlers.onDone({ location, bytesTotal }),
    )
    .error((params) =>
      handlers.onInterruption(classifyInterruption(mapNativeError(params))),
    )

  return task
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
