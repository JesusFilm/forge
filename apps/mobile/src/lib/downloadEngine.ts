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
  type TransferInterruption,
} from "./downloadOutcome"

/**
 * Thin swappable adapter over the native background-download module (KTD1),
 * confining the native surface to one file; decisions live in the pure core.
 * Runtime behavior (background, reattach, notifications) is device-verified only.
 */

export type EngineTask = ReturnType<typeof createDownloadTask>

let appliedWifiOnly: boolean | undefined

/**
 * Apply global engine config. iOS wifi-only is global (`allowsCellularAccess`);
 * Android's metered flag is per-download in {@link startMediaDownload}. The
 * persistent Android notification is required by the foreground service.
 *
 * IDEMPOTENT BY CONTRACT: the native `setConfig` mutates `allowsCellularAccess`,
 * which the library applies by tearing down and recreating the shared
 * URLSession — and that CANCELS every in-flight download (they surface as
 * errorCode -999 "cancelled"). A series fans out many downloads, so re-applying
 * an unchanged config mid-series would cancel the ones already running. Skip the
 * native call when nothing changed so configuration only ever happens on first
 * apply and on an actual wifi-only toggle.
 */
export function configureDownloadEngine(opts: { wifiOnly: boolean }): void {
  if (opts.wifiOnly === appliedWifiOnly) return
  appliedWifiOnly = opts.wifiOnly
  setConfig({
    allowsCellularAccess: !opts.wifiOnly,
    showNotificationsEnabled: true,
    progressInterval: 1000,
  })
}

/** Test-only: clear the cached config so each case starts from a clean slate. */
export function __resetEngineConfigForTest(): void {
  appliedWifiOnly = undefined
}

/**
 * U8/R25/R31: the un-collapsed native error + interruption, so the lifecycle can
 * emit the raw code/message and reachability before classification flattens them.
 */
export type NativeInterruptionMeta = {
  raw: { error: string; errorCode: number }
  interruption: TransferInterruption
}

export type MediaDownloadHandlers = {
  /** Fires once when the transfer begins, carrying the OS-reported size. */
  onBegin?: (p: { expectedBytes: number }) => void
  onProgress: (p: { bytesDownloaded: number; bytesTotal: number }) => void
  onDone: (p: { location: string; bytesTotal: number }) => void
  onInterruption: (
    classification: OutcomeClassification,
    meta?: NativeInterruptionMeta,
  ) => void
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
    .error((params) => {
      const interruption = mapNativeError(params)
      handlers.onInterruption(classifyInterruption(interruption), {
        raw: params,
        interruption,
      })
    })
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

/** Pause a live transfer (KTD1). iOS may implement this as cancel-with-resume-data. */
export function pauseTask(task: EngineTask): Promise<void> {
  return Promise.resolve(task.pause())
}

/** Resume a paused transfer. */
export function resumeTask(task: EngineTask): Promise<void> {
  return Promise.resolve(task.resume())
}

/**
 * Re-bind a task's events to no-ops so its OWN late terminal callbacks are inert.
 * Used by supersede so a stopped old-language task can't fire onDone/onInterruption.
 */
function neutralizeHandlers(task: EngineTask): void {
  task
    .begin(() => {})
    .progress(() => {})
    .done(() => {})
    .error(() => {})
}

/**
 * Stop (cancel) a transfer. `supersede` neutralizes this task's own callbacks
 * first (KTD3) — used by the language-switch, which reuses the slug id for the
 * replacement. Neutralizing THIS task is only part of the fix: because the native
 * library dispatches terminal events by slug id to whichever task currently holds
 * it, the caller must also await this stop before the replacement claims the slug,
 * or guard the new record's onInterruption against a pre-onBegin cancel.
 */
export function stopTask(
  task: EngineTask,
  opts: { supersede?: boolean } = {},
): Promise<void> {
  if (opts.supersede) neutralizeHandlers(task)
  return Promise.resolve(task.stop())
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
