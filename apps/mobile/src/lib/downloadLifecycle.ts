import { decideCancelAction } from "./downloadControls"
import { sanitizeNativeErrorMessage } from "./downloadErrors"
// Type-only imports from the engine are erased at runtime, so this module never
// loads the native downloader — the KTD1 seam stays in downloadEngine.ts.
import type {
  EngineTask,
  MediaDownloadHandlers,
  MediaDownloadSpec,
  NativeInterruptionMeta,
} from "./downloadEngine"
import { reachabilityFromInterruption, resolveBundle } from "./downloadOutcome"
import {
  attemptIdFromPendingPath,
  buildRequestRecord,
  buildSwapSnapshot,
  isStorageBlocked,
  newDownloadNonce,
  requestTotalBytes,
  swapRevertFields,
  type DownloadTelemetry,
  type StartDownloadRequest,
  type StartDownloadResult,
} from "./downloadRequestBuilders"
import {
  buildCommittedPath,
  buildPendingPath,
  buildPosterPath,
  buildSubtitlePath,
} from "./offlineFiles"
import {
  isBatchPlaceholderRecord,
  isLiveDownloadRecord,
  type OfflineDownloadRecord,
  type SwapFrom,
} from "./offlineManifest"
import { validateActionUrl } from "./validateUrl"

// The pure request/record builders live in downloadRequestBuilders.ts (split
// so this factory file stays navigable); re-exported so existing import sites
// keep one module path.
export {
  attemptIdFromPendingPath,
  buildReattachRequest,
  buildRequestRecord,
  buildSwapSnapshot,
  isStorageBlocked,
  newDownloadNonce,
  requestTotalBytes,
  retryFailedDownload,
  swapRevertFields,
} from "./downloadRequestBuilders"
export type {
  DownloadTelemetry,
  RequestRecordState,
  RetryDownloadDeps,
  StartDownloadRequest,
  StartDownloadResult,
} from "./downloadRequestBuilders"

// ── Lifecycle factory ───────────────────────────────────────────────

export type MediaUrlResolution = {
  mediaUrl: string
  subtitleUrl: string | null
}

export type DownloadLifecycleDeps = {
  /** Live record lookup (the provider's records ref). */
  getRecord: (videoSlug: string) => OfflineDownloadRecord | undefined
  writeRecord: (record: OfflineDownloadRecord) => Promise<void>
  removeRecord: (videoSlug: string) => Promise<void>
  /** Fresh URL from stable identity (U4); null on failure — must never throw. */
  reresolveMediaUrl: (args: {
    dubDocumentId: string
    renditionDocumentId: string
    qualityLabel: string
    totalBytes: number
    subtitleLanguageSlug: string | null
  }) => Promise<MediaUrlResolution | null>
  /** Live wifi-only preference read, for restarts (no request carries it). */
  allowCellularForRestart: () => boolean
  /** Full batch-scope teardown (queue entry + slot + pending-swap) on cancel/delete. */
  onLeaveBatchScope: (videoSlug: string) => void
  /** Supersede keeps the occupancy slot: drop queue entry + pending-swap only (R14). */
  onSupersedeScope: (videoSlug: string) => void
  offlineRoot: string
  /** Optional Datadog sink (U8); absent in unit tests so emits no-op. */
  telemetry?: DownloadTelemetry
  engine: {
    start: (
      spec: MediaDownloadSpec,
      handlers: MediaDownloadHandlers,
    ) => EngineTask
    wire: (task: EngineTask, handlers: MediaDownloadHandlers) => void
    pause: (task: EngineTask) => Promise<void>
    resume: (task: EngineTask) => Promise<void>
    stop: (task: EngineTask, opts?: { supersede?: boolean }) => Promise<void>
  }
  fs: {
    ensureVideoDir: (videoSlug: string) => Promise<unknown>
    freeDiskBytes: () => Promise<number>
    fileExists: (uri: string) => Promise<boolean>
    moveFile: (from: string, to: string) => Promise<unknown>
    removeUri: (uri: string) => Promise<unknown>
    removeVideoDir: (videoSlug: string) => Promise<unknown>
    downloadToFile: (url: string, destination: string) => Promise<unknown>
  }
  notifyIosBackgroundComplete: (jobId: string) => void
}

export type DownloadLifecycle = ReturnType<typeof createDownloadLifecycle>

type HandlerArgs = {
  videoSlug: string
  committedPath: string
  pendingPath: string
  /** R26: per-attempt id (the pending nonce) threaded into every terminal emit. */
  attemptId: string
  /** Total-size fallback when the OS hasn't reported one yet. */
  fallbackTotalBytes: number
  subtitleLanguageSlug: string | null
  subtitleUrl: string | null
  /** U6: lazy subtitle-URL resolver for the reattach path (no persisted URL). */
  resolveSubtitleUrl?: () => Promise<string | null>
  posterUrl: string | null
}

/**
 * The per-video Download Record lifecycle: start/Swap/restart flows, the native
 * event handlers that commit or revert, and in-flight controls. React-free with
 * injected engine/fs/manifest ports so jest exercises it without native mocks.
 */
export function createDownloadLifecycle(deps: DownloadLifecycleDeps) {
  // U2: live native task handles keyed by slug so pause/resume/cancel/supersede
  // can act on an in-flight transfer; entries drop at terminal events.
  const taskRegistry = new Map<string, EngineTask>()

  // U3: dedupe concurrent restarts (double-tap resume). A restart re-resolves
  // for ~10s before its task registers, so guard synchronously.
  const restarting = new Set<string>()

  const deleteDownload = async (videoSlug: string): Promise<void> => {
    // A deleted slug must not restart from the batch queue (R14), nor keep
    // occupying the batch slot / pending-swap flag (review #5).
    deps.onLeaveBatchScope(videoSlug)
    // R1: stop the in-flight native transfer BEFORE removing files/record, so
    // it doesn't keep downloading and no late done-callback writes into the
    // removed dir. No live task (already downloaded/failed) → just remove.
    const task = taskRegistry.get(videoSlug)
    if (task) {
      taskRegistry.delete(videoSlug)
      try {
        await deps.engine.stop(task)
      } catch {
        // Best-effort stop; remove regardless so the UI stays consistent.
      }
    }
    await deps.fs.removeVideoDir(videoSlug)
    await deps.removeRecord(videoSlug)
  }

  // Build the native event handlers for one download, bound to its identity and
  // sidecars. Shared by start/swap/restart (fresh) and wireTask (reattach) so
  // every path commits identically.
  const telemetry = deps.telemetry

  // R25/R31: surface the raw native code+message (before classification flattens
  // it) and the reachability proxy it implies, ahead of the terminal disposition.
  const emitNativeInterruption = (
    videoSlug: string,
    attemptId: string,
    meta: NativeInterruptionMeta | undefined,
  ) => {
    if (!meta || !telemetry) return
    telemetry.warn("download.native_error", {
      content_id: videoSlug,
      attempt_id: attemptId,
      code: meta.raw.errorCode,
      message: sanitizeNativeErrorMessage(meta.raw.error),
      kind: meta.interruption.kind,
    })
    const reachability = reachabilityFromInterruption(meta.interruption)
    if (reachability) {
      telemetry.info("downloads.reachability", {
        content_id: videoSlug,
        state: reachability,
        cause: meta.interruption.kind,
      })
    }
  }

  const makeHandlers = (args: HandlerArgs): MediaDownloadHandlers => {
    const {
      videoSlug,
      committedPath,
      pendingPath,
      attemptId,
      fallbackTotalBytes,
    } = args

    // U4/KTD3: a `canceled` interruption that lands before this task's onBegin
    // is a stale terminal from a superseded old task that the native layer
    // routed to this reused slug — not a real cancel. Guard the delete on it.
    let hasBegun = false

    const patch = (fields: Partial<OfflineDownloadRecord>) => {
      const current = deps.getRecord(videoSlug)
      if (!current) return
      void deps.writeRecord({ ...current, ...fields })
    }

    // A swap's new download failed — restore the original copy (AE2): drop the
    // new partial and revert the record's identity to the snapshot. The old
    // file was never touched, so it's still playable.
    const revertSwap = (swap: SwapFrom) => {
      void deps.fs.removeUri(pendingPath)
      patch(swapRevertFields(swap))
    }

    const finalize = async (location: string) => {
      try {
        // `location` already equals our pendingPath, so the "move" is a pending
        // -> committed rename. Guard the benign cases (already committed, or
        // source moved by a prior attempt) so they don't force `failed`.
        const source = (await deps.fs.fileExists(location))
          ? location
          : pendingPath
        if (source !== committedPath) {
          if (await deps.fs.fileExists(source)) {
            await deps.fs.moveFile(source, committedPath)
          } else if (!(await deps.fs.fileExists(committedPath))) {
            const swap = deps.getRecord(videoSlug)?.swapFrom
            if (swap) revertSwap(swap)
            else patch({ state: "failed" })
            return
          }
        }
        let subtitleVerified = false
        let subtitleTerminallyFailed = false
        // U6: the reattach path has no persisted subtitle URL, so re-resolve it
        // lazily HERE (at commit) — the media task already survived, so wiring
        // was never blocked on the network round-trip.
        let subtitleUrl = args.subtitleUrl
        if (
          args.subtitleLanguageSlug &&
          !subtitleUrl &&
          args.resolveSubtitleUrl
        ) {
          subtitleUrl = await args.resolveSubtitleUrl()
        }
        if (args.subtitleLanguageSlug && subtitleUrl) {
          // Validate the CMS-sourced URL before fetching (CLAUDE.md rule). An
          // unsafe URL is a terminal subtitle failure — media still completes,
          // the subtitle degrades.
          if (!validateActionUrl(subtitleUrl)) {
            subtitleTerminallyFailed = true
          } else {
            try {
              await deps.fs.downloadToFile(
                subtitleUrl,
                buildSubtitlePath(
                  deps.offlineRoot,
                  videoSlug,
                  args.subtitleLanguageSlug,
                ),
              )
              subtitleVerified = true
            } catch {
              subtitleTerminallyFailed = true
            }
          }
        }
        let posterPath: string | null = null
        // Validate the CMS-sourced poster URL before fetching; an unsafe URL
        // simply leaves the library without a cached poster.
        if (args.posterUrl && validateActionUrl(args.posterUrl)) {
          const target = buildPosterPath(deps.offlineRoot, videoSlug)
          try {
            await deps.fs.downloadToFile(args.posterUrl, target)
            posterPath = target
          } catch {
            posterPath = null
          }
        }
        const bundle = resolveBundle({
          mediaVerified: true,
          subtitleRequested: args.subtitleLanguageSlug != null,
          subtitleVerified,
          subtitleTerminallyFailed,
        })
        if (bundle.kind === "downloaded") {
          patch({
            state: "downloaded",
            committedPath,
            pendingPath: null,
            posterPath,
            subtitleLanguageSlug: bundle.subtitleDegraded
              ? null
              : args.subtitleLanguageSlug,
          })
          // Swap verified: remove the superseded old file. Guard the
          // subtitle-only swap where rendition is unchanged so old path EQUALS
          // new — deleting it would destroy the media we just committed.
          const swap = deps.getRecord(videoSlug)?.swapFrom
          if (swap) {
            if (swap.committedPath !== committedPath) {
              await deps.fs.removeUri(swap.committedPath)
            }
            patch({ swapFrom: null })
          }
        } else {
          const swap = deps.getRecord(videoSlug)?.swapFrom
          if (swap) revertSwap(swap)
          else patch({ state: "failed" })
        }
      } catch {
        const swap = deps.getRecord(videoSlug)?.swapFrom
        if (swap) revertSwap(swap)
        else patch({ state: "failed" })
      }
    }

    const terminalContext = { content_id: videoSlug, attempt_id: attemptId }

    return {
      onBegin: ({ expectedBytes }) => {
        hasBegun = true
        telemetry?.info("download.begin", {
          ...terminalContext,
          expected_bytes: expectedBytes,
        })
        patch({
          totalBytes: expectedBytes > 0 ? expectedBytes : fallbackTotalBytes,
        })
      },
      onProgress: ({ bytesDownloaded, bytesTotal }) =>
        patch({
          bytesWritten: bytesDownloaded,
          totalBytes: bytesTotal || fallbackTotalBytes,
        }),
      onDone: ({ location }) => {
        taskRegistry.delete(videoSlug)
        telemetry?.info("download.done", terminalContext)
        // Signal iOS only AFTER finalize settles; signalling first lets iOS
        // suspend mid-finalize on a background-only launch, cutting sidecars
        // short. `finally` so we always signal — else iOS throttles us.
        void finalize(location).finally(() =>
          deps.notifyIosBackgroundComplete(videoSlug),
        )
      },
      onInterruption: (classification, meta) => {
        // Any native interruption is terminal for this task handle (a
        // connectivity/wifi/background error stops it). A user pause never
        // arrives here — it sets state directly (U3) and keeps the handle.
        taskRegistry.delete(videoSlug)
        const wasPaused = deps.getRecord(videoSlug)?.state === "paused"
        emitNativeInterruption(videoSlug, attemptId, meta)
        const swap = deps.getRecord(videoSlug)?.swapFrom
        if (swap) {
          // A swap was interrupted — keep the original copy intact.
          telemetry?.info("download.interrupted", {
            ...terminalContext,
            disposition: "swap-reverted",
          })
          revertSwap(swap)
        } else if (classification.state === "canceled") {
          // R25: hasBegun + paused separate a genuine user cancel from a stale
          // pre-onBegin supersede terminal (KTD3) and a native pause-as-cancel
          // (KTD2) — so a URLSession-teardown -999 storm stays attributable.
          const cancelKind = !hasBegun
            ? "stale-supersede"
            : wasPaused
              ? "pause-as-cancel"
              : "cancel"
          telemetry?.info("download.interrupted", {
            ...terminalContext,
            disposition: "canceled",
            cancel_kind: cancelKind,
            code: meta?.raw.errorCode,
          })
          if (hasBegun && !wasPaused) {
            void deleteDownload(videoSlug)
          }
        } else {
          telemetry?.info("download.interrupted", {
            ...terminalContext,
            disposition: classification.state,
          })
          patch({ state: classification.state })
        }
        deps.notifyIosBackgroundComplete(videoSlug)
      },
    }
  }

  // The one engine-start seam shared by start/swap/restart: a synchronous
  // engine throw (missing native module, session init) must never strand a
  // phantom "downloading" record, so each caller passes its own cleanup.
  const startEngineTask = async (
    spec: MediaDownloadSpec,
    handlers: MediaDownloadHandlers,
    onFailure: () => Promise<void>,
  ): Promise<boolean> => {
    let task: EngineTask
    try {
      task = deps.engine.start(spec, handlers)
    } catch {
      await onFailure()
      return false
    }
    taskRegistry.set(spec.id, task)
    return true
  }

  // U3: restart an interrupted download — re-resolve the URL, rewrite it
  // `downloading`, start, and register. Best-effort: a null re-resolve
  // (offline / unsafe URL) leaves the record for the next launch.
  const restart = async (record: OfflineDownloadRecord): Promise<void> => {
    if (restarting.has(record.videoSlug)) return
    restarting.add(record.videoSlug)
    try {
      const refreshed = await deps.reresolveMediaUrl({
        dubDocumentId: record.dubDocumentId,
        renditionDocumentId: record.renditionDocumentId,
        qualityLabel: record.qualityLabel,
        totalBytes: record.totalBytes,
        subtitleLanguageSlug: record.subtitleLanguageSlug,
      })
      if (!refreshed || !validateActionUrl(refreshed.mediaUrl)) return
      const nonce = newDownloadNonce()
      const pendingPath =
        record.pendingPath ??
        buildPendingPath(deps.offlineRoot, record.videoSlug, nonce)
      const committedPath = buildCommittedPath(
        deps.offlineRoot,
        record.videoSlug,
        record.renditionDocumentId,
      )
      try {
        // Engine config is applied once at mount — never here. Re-applying
        // recreates the URLSession and cancels sibling restarts.
        await deps.fs.ensureVideoDir(record.videoSlug)
      } catch {
        return
      }
      // D2: bail if the record we captured was deleted OR replaced (a fresh
      // same-slug download started) during the awaits above — writing our stale
      // copy back would clobber the new record and orphan its engine task.
      if (deps.getRecord(record.videoSlug) !== record) return
      await deps.writeRecord({
        ...record,
        state: "downloading",
        committedPath: null,
        pendingPath,
        bytesWritten: 0,
      })
      // Engine throw → mark failed (delete/retry stay available), not a
      // phantom "downloading" with no task.
      await startEngineTask(
        {
          id: record.videoSlug,
          url: refreshed.mediaUrl,
          destination: pendingPath,
          allowCellular: deps.allowCellularForRestart(),
        },
        makeHandlers({
          videoSlug: record.videoSlug,
          committedPath,
          pendingPath,
          attemptId: attemptIdFromPendingPath(pendingPath),
          fallbackTotalBytes: record.totalBytes,
          // U6: restart re-resolves the whole dub, so the fresh subtitle URL
          // is already in hand — thread it straight through.
          subtitleLanguageSlug: record.subtitleLanguageSlug,
          subtitleUrl: refreshed.subtitleUrl,
          posterUrl: null,
        }),
        () => deps.writeRecord({ ...record, state: "failed" }),
      )
    } finally {
      restarting.delete(record.videoSlug)
    }
  }

  const start = async (
    request: StartDownloadRequest,
  ): Promise<StartDownloadResult> => {
    const { videoSlug, rendition } = request
    const existing = deps.getRecord(videoSlug)
    // A BARE `queued` record (no pending, no committed) is the batch's own
    // placeholder from queueBatchRecords — nothing else writes bare-queued — so
    // adopt it (drive to downloading) instead of reporting `exists`.
    const isOwnPlaceholder = isBatchPlaceholderRecord(existing)
    // One copy per video: ignore if a live copy/queue entry already exists.
    if (isLiveDownloadRecord(existing) && !isOwnPlaceholder) {
      return { ok: false, reason: "exists" }
    }

    // U12: refuse before writing a record if the footprint plus the reserve
    // won't fit (isStorageBlocked never blocks on an unreadable free reading).
    const startFreeBytes = await deps.fs.freeDiskBytes()
    const startSizeBytes = requestTotalBytes(request)
    if (isStorageBlocked(startFreeBytes, startSizeBytes)) {
      telemetry?.warn("downloads.storage_blocked", {
        content_id: videoSlug,
        free_bytes: startFreeBytes,
        size_bytes: startSizeBytes,
      })
      // Clean up only our own adopted placeholder — never a pre-existing record.
      if (isOwnPlaceholder) await deps.removeRecord(videoSlug)
      return { ok: false, reason: "insufficient-storage" }
    }
    if (startFreeBytes <= 0) {
      // R29: the free-disk API was unreadable so the gate self-disabled and let
      // the download through — record the blind allow distinctly from a real pass.
      telemetry?.info("downloads.storage_unreadable", {
        content_id: videoSlug,
        size_bytes: startSizeBytes,
      })
    }

    try {
      // Engine config is applied once at mount, NOT per download: re-applying
      // tears down + recreates the URLSession, cancelling every sibling
      // download in flight (the series "stops at N of M" bug).
      await deps.fs.ensureVideoDir(videoSlug)
    } catch {
      if (isOwnPlaceholder) await deps.removeRecord(videoSlug)
      return { ok: false, reason: "error" }
    }

    // A cancel/delete during the awaits above removed our adopted placeholder;
    // proceeding would resurrect the canceled record (review #1). Bail — the
    // cancel already cleaned the record and dir.
    if (isOwnPlaceholder && !deps.getRecord(videoSlug)) {
      return { ok: false, reason: "canceled" }
    }

    const nonce = newDownloadNonce()
    const pendingPath = buildPendingPath(deps.offlineRoot, videoSlug, nonce)
    const committedPath = buildCommittedPath(
      deps.offlineRoot,
      videoSlug,
      rendition.documentId,
    )

    await deps.writeRecord(
      buildRequestRecord(request, "downloading", { pendingPath }),
    )

    // U4: refresh the signed URL right before starting — the sheet's URL may
    // have expired while it sat open. Fall back to the page URL so a transient
    // refresh failure never blocks an otherwise-valid download.
    const fresh = await deps.reresolveMediaUrl({
      dubDocumentId: request.dubDocumentId,
      renditionDocumentId: rendition.documentId,
      qualityLabel: rendition.quality,
      totalBytes: requestTotalBytes(request),
      subtitleLanguageSlug: request.subtitleLanguageSlug,
    })

    // A cancel/delete during the reresolve removed the record we wrote; the
    // native task hasn't started, so starting now would zombie-download into
    // a dir the cancel already removed (review #1). Bail without re-creating.
    if (deps.getRecord(videoSlug)?.state !== "downloading") {
      return { ok: false, reason: "canceled" }
    }

    const mediaUrl = fresh?.mediaUrl ?? rendition.url
    // Validate the CMS-sourced media URL before handing it to the native
    // downloader (CLAUDE.md invariant). Both candidates failing means we have
    // no safe URL — drop the provisional record and report the error.
    if (!validateActionUrl(mediaUrl)) {
      await deps.removeRecord(videoSlug)
      return { ok: false, reason: "error" }
    }

    // The engine can throw synchronously (missing native module, session init
    // failure) — drop the provisional record so no phantom "downloading" row
    // survives a start that never produced a task.
    const started = await startEngineTask(
      {
        id: videoSlug,
        url: mediaUrl,
        destination: pendingPath,
        allowCellular: request.allowCellular,
      },
      makeHandlers({
        videoSlug,
        committedPath,
        pendingPath,
        attemptId: attemptIdFromPendingPath(pendingPath),
        fallbackTotalBytes: requestTotalBytes(request),
        subtitleLanguageSlug: request.subtitleLanguageSlug,
        subtitleUrl: fresh?.subtitleUrl ?? request.subtitleUrl,
        posterUrl: request.posterUrl,
      }),
      () => deps.removeRecord(videoSlug),
    )
    if (!started) return { ok: false, reason: "error" }
    return { ok: true }
  }

  // U8: non-destructive quality/language Swap on an already-downloaded video.
  // The new copy downloads alongside the old (kept playable via swapFrom); on
  // success the old file is deleted, on failure the record reverts (AE2).
  const swap = async (
    request: StartDownloadRequest,
  ): Promise<StartDownloadResult> => {
    const { videoSlug, rendition } = request
    const existing = deps.getRecord(videoSlug)
    // Only a completed copy can be swapped; else treat it as a fresh download.
    if (
      !existing ||
      existing.state !== "downloaded" ||
      !existing.committedPath
    ) {
      return start(request)
    }
    // Identical rendition + subtitle → nothing to change.
    if (
      existing.renditionDocumentId === rendition.documentId &&
      existing.subtitleLanguageSlug === request.subtitleLanguageSlug
    ) {
      return { ok: false, reason: "exists" }
    }
    // The new copy lives alongside the old until verified, so reserve room.
    const swapFreeBytes = await deps.fs.freeDiskBytes()
    const swapSizeBytes = requestTotalBytes(request)
    if (isStorageBlocked(swapFreeBytes, swapSizeBytes)) {
      telemetry?.warn("downloads.storage_blocked", {
        content_id: videoSlug,
        free_bytes: swapFreeBytes,
        size_bytes: swapSizeBytes,
        op: "swap",
      })
      return { ok: false, reason: "insufficient-storage" }
    }
    try {
      // See start: engine config is applied once at mount.
      await deps.fs.ensureVideoDir(videoSlug)
    } catch {
      return { ok: false, reason: "error" }
    }

    const nonce = newDownloadNonce()
    const pendingPath = buildPendingPath(deps.offlineRoot, videoSlug, nonce)
    const committedPath = buildCommittedPath(
      deps.offlineRoot,
      videoSlug,
      rendition.documentId,
    )
    const swapFrom = buildSwapSnapshot(existing, existing.committedPath)
    await deps.writeRecord({
      ...existing,
      renditionDocumentId: rendition.documentId,
      qualityLabel: rendition.quality,
      title: request.title || existing.title,
      subtitleLanguageSlug: request.subtitleLanguageSlug,
      state: "downloading",
      committedPath: null,
      pendingPath,
      bytesWritten: 0,
      totalBytes: requestTotalBytes(request),
      // A watch-route original lacks the batch's per-episode ordering fields;
      // adopt the request's so a later Download All can't leave it sorted last.
      seriesEpisodeIndex:
        request.seriesEpisodeIndex ?? existing.seriesEpisodeIndex,
      durationSeconds: request.durationSeconds ?? existing.durationSeconds,
      swapFrom,
    })

    const fresh = await deps.reresolveMediaUrl({
      dubDocumentId: request.dubDocumentId,
      renditionDocumentId: rendition.documentId,
      qualityLabel: rendition.quality,
      totalBytes: requestTotalBytes(request),
      subtitleLanguageSlug: request.subtitleLanguageSlug,
    })

    // A cancel during the reresolve already reverted the record to the old
    // copy (swapFrom cleared) — starting now would clobber that revert and
    // orphan a new file (review #1 sibling). Bail; the revert stands.
    const midSwap = deps.getRecord(videoSlug)
    if (midSwap?.state !== "downloading" || !midSwap.swapFrom) {
      return { ok: false, reason: "canceled" }
    }

    const mediaUrl = fresh?.mediaUrl ?? rendition.url
    // Validate the CMS-sourced media URL before starting. On failure restore
    // the pre-swap record (the old copy is untouched; no pending file exists
    // yet) so the user keeps their working download.
    if (!validateActionUrl(mediaUrl)) {
      await deps.writeRecord(existing)
      return { ok: false, reason: "error" }
    }

    // Engine start threw before producing a task — restore the pre-swap
    // record (old copy + file untouched; no pending file exists yet).
    const started = await startEngineTask(
      {
        id: videoSlug,
        url: mediaUrl,
        destination: pendingPath,
        allowCellular: request.allowCellular,
      },
      makeHandlers({
        videoSlug,
        committedPath,
        pendingPath,
        attemptId: attemptIdFromPendingPath(pendingPath),
        fallbackTotalBytes: requestTotalBytes(request),
        subtitleLanguageSlug: request.subtitleLanguageSlug,
        subtitleUrl: fresh?.subtitleUrl ?? request.subtitleUrl,
        posterUrl: request.posterUrl,
      }),
      () => deps.writeRecord(existing),
    )
    if (!started) return { ok: false, reason: "error" }
    return { ok: true }
  }

  // Re-bind handlers onto a task that survived an app restart. A reattached
  // task carries no JS callbacks, so its done event would fire into the void.
  const wireTask = (task: EngineTask, record: OfflineDownloadRecord): void => {
    const committedPath =
      record.committedPath ??
      buildCommittedPath(
        deps.offlineRoot,
        record.videoSlug,
        record.renditionDocumentId,
      )
    const pendingPath =
      record.pendingPath ??
      buildPendingPath(deps.offlineRoot, record.videoSlug, "reattach")
    deps.engine.wire(
      task,
      makeHandlers({
        videoSlug: record.videoSlug,
        committedPath,
        pendingPath,
        attemptId: attemptIdFromPendingPath(pendingPath),
        fallbackTotalBytes: record.totalBytes,
        // U6: the surviving task has no persisted subtitle URL — re-resolve it
        // lazily at commit so wiring is never blocked on the network (R3).
        subtitleLanguageSlug: record.subtitleLanguageSlug,
        subtitleUrl: null,
        resolveSubtitleUrl: async () =>
          (
            await deps.reresolveMediaUrl({
              dubDocumentId: record.dubDocumentId,
              renditionDocumentId: record.renditionDocumentId,
              qualityLabel: record.qualityLabel,
              totalBytes: record.totalBytes,
              subtitleLanguageSlug: record.subtitleLanguageSlug,
            })
          )?.subtitleUrl ?? null,
        posterUrl: null,
      }),
    )
    taskRegistry.set(record.videoSlug, task)
  }

  // U3: pause sets state directly and keeps the task handle (a user pause never
  // reaches onInterruption).
  const pause = async (videoSlug: string): Promise<void> => {
    const current = deps.getRecord(videoSlug)
    const task = taskRegistry.get(videoSlug)
    if (!task || current?.state !== "downloading") return
    void deps.writeRecord({ ...current, state: "paused" })
    try {
      await deps.engine.pause(task)
    } catch {
      // Best-effort; the record already reflects paused.
    }
  }

  // Resume continues in place, or restarts cleanly if the task didn't survive
  // the pause/relaunch (R5/AE4).
  const resume = async (videoSlug: string): Promise<void> => {
    const current = deps.getRecord(videoSlug)
    if (current?.state !== "paused") return
    const task = taskRegistry.get(videoSlug)
    if (task) {
      void deps.writeRecord({ ...current, state: "downloading" })
      try {
        await deps.engine.resume(task)
        return
      } catch {
        // Native resume failed — fall through to a clean restart.
      }
    }
    await restart(current)
  }

  const cancel = async (videoSlug: string): Promise<void> => {
    // Leave the batch scope FIRST, before the ignore-check below: a re-download
    // waiter sits as state="downloaded" (decideCancelAction→"ignore"), so
    // dropping after would leave it queued and the pump would resume its swap.
    deps.onLeaveBatchScope(videoSlug)
    const current = deps.getRecord(videoSlug)
    const action = decideCancelAction(current)
    if (action === "ignore" || !current) return
    const task = taskRegistry.get(videoSlug)
    if (task) {
      taskRegistry.delete(videoSlug)
      try {
        await deps.engine.stop(task)
      } catch {
        // Best-effort stop.
      }
    }
    // A swap in flight reverts to the old copy (keep the previously-downloaded
    // file that shares the video dir); a fresh download is removed entirely.
    if (action === "revert" && current.swapFrom) {
      if (current.pendingPath) await deps.fs.removeUri(current.pendingPath)
      void deps.writeRecord({
        ...current,
        ...swapRevertFields(current.swapFrom),
      })
      return
    }
    // A fresh in-flight download → remove it entirely.
    await deps.fs.removeVideoDir(videoSlug)
    await deps.removeRecord(videoSlug)
  }

  // U4: stop the in-flight task WITHOUT removing its record, neutralizing its
  // terminal callbacks so the language-switch replacement can reclaim the slug.
  const supersede = async (videoSlug: string): Promise<void> => {
    // Drop the stale queue entry + any pending-swap flag (keep the occupancy
    // slot — the switch replacement reclaims it); must not race it (R14).
    deps.onSupersedeScope(videoSlug)
    const task = taskRegistry.get(videoSlug)
    if (!task) return
    taskRegistry.delete(videoSlug)
    try {
      await deps.engine.stop(task, { supersede: true })
    } catch {
      // Best-effort supersede stop.
    }
  }

  return {
    start,
    swap,
    restart,
    wireTask,
    pause,
    resume,
    cancel,
    supersede,
    deleteDownload,
  }
}
