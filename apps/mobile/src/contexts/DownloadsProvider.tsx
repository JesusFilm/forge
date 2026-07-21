import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  configureDownloadEngine,
  listExistingDownloadTasks,
  notifyIosBackgroundComplete,
  pauseTask,
  resumeTask,
  startMediaDownload,
  stopTask,
  wireExistingTask,
} from "../lib/downloadEngine"
import { reconcile } from "../lib/downloadReconciliation"
import {
  OFFLINE_ROOT,
  downloadToFile,
  ensureVideoDir,
  fileExists,
  freeDiskBytes,
  moveFile,
  removeUri,
  removeVideoDir,
} from "../lib/offlineFileSystem"
import {
  OFFLINE_INDEX_STORAGE_KEY,
  isBatchPlaceholderRecord,
  isLiveDownloadRecord,
  offlineRecordKey,
  parseOfflineIndex,
  parseOfflineRecord,
  serializeOfflineIndex,
  serializeOfflineRecord,
  type OfflineDownloadRecord,
} from "../lib/offlineManifest"
import {
  canQueueBatchDownload,
  nextBatchAction,
} from "../lib/batchDownloadQueue"
import { normalizeDubMedia } from "../lib/normalizeVideo"
import {
  buildReattachRequest,
  buildRequestRecord,
  createDownloadLifecycle,
  retryFailedDownload,
  type DownloadLifecycle,
  type StartDownloadRequest,
  type StartDownloadResult,
} from "../lib/downloadLifecycle"
import { STORAGE_RESERVE_BYTES } from "../lib/offlineConstants"
import { getApolloClient } from "../lib/apolloClient"
import { datadogLog } from "../lib/datadog"
import { resolveFromMedia } from "../lib/downloadUrlResolution"
import { GET_VIDEO_DUB } from "../lib/queries"
import { useWatchPreferences } from "./WatchPreferencesProvider"

/**
 * App-wide offline-downloads state, mounted at the root layout (not the watch
 * route) so the detail-page badge and My Downloads — both outside the watch
 * route group — can read it. Transfer/background behavior is device-verified.
 */
// Request/result shapes live in the React-free lifecycle lib (todo 013);
// re-exported so existing `from DownloadsProvider` import sites keep working.
export type {
  StartDownloadRequest,
  StartDownloadResult,
} from "../lib/downloadLifecycle"

type DownloadsContextValue = {
  /** False until the persisted manifest has been read. */
  isReady: boolean
  /** The record for a video, or null if it has no offline copy/queue entry. */
  getRecord: (videoSlug: string) => OfflineDownloadRecord | null
  /** Committed, playable local media path for a downloaded video, else null. */
  committedFor: (videoSlug: string) => string | null
  /** Slugs with a usable (downloaded) offline copy. */
  downloadedSlugs: string[]
  /** All offline records (downloaded + in-progress) for the library. */
  offlineRecords: OfflineDownloadRecord[]
  /**
   * Episodes queued for a re-download swap — still `downloaded` (old copy) but
   * pending replacement. Feeds the series ring so a re-download fills from 0.
   */
  pendingSwapSlugs: ReadonlySet<string>
  /** Enqueue an offline download (one copy per video). */
  startDownload: (request: StartDownloadRequest) => Promise<StartDownloadResult>
  /** Swap a downloaded video to a new quality/language, non-destructively. */
  swapDownload: (request: StartDownloadRequest) => Promise<StartDownloadResult>
  /**
   * Series batch entry point (R14): accept an episode into the sequential
   * queue instead of starting immediately — its `queued` placeholder must
   * already be persisted (queueBatchRecords) so badges/cancel-all cover the wait.
   */
  queueBatchDownload: (
    request: StartDownloadRequest,
  ) => Promise<StartDownloadResult>
  /**
   * Durable batch pre-persist (series download-all): write a `queued` record per
   * request synchronously, BEFORE any network await, so a backgrounding mid-batch
   * still completes via the launch reattach (`requeue` re-resolves the URL and
   * restarts). Skips slugs that already carry a live record — those are handled
   * by start/swap/switch — so it never clobbers a swap snapshot. The capped
   * enqueue loop then drives each to `downloading`. Best-effort, never throws.
   */
  queueBatchRecords: (requests: StartDownloadRequest[]) => Promise<void>
  /** Remove an offline copy: its files and its manifest entry. */
  deleteDownload: (videoSlug: string) => Promise<void>
  /** Pause an in-flight download (keeps the task; resume continues in place). */
  pauseDownload: (videoSlug: string) => Promise<void>
  /** Resume a paused download; restarts cleanly if the task didn't survive. */
  resumeDownload: (videoSlug: string) => Promise<void>
  /** Retry a failed download via restart; a no-op on any other state (R21). */
  retryDownload: (videoSlug: string) => Promise<void>
  /** Cancel an in-flight download: stop the transfer and remove it (R1). */
  cancelDownload: (videoSlug: string) => Promise<void>
  /** Stop an in-flight task without deleting its record (U4 language-switch). */
  supersedeDownload: (videoSlug: string) => Promise<void>
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null)

// Re-exported from the lib constant so existing `from DownloadsProvider`
// import sites keep working; the value lives in lib/offlineConstants (KTD6).
export { STORAGE_RESERVE_BYTES }

/**
 * Re-resolve a fresh media URL from a record's stable identity (U4): the manifest
 * stores identity, never the volatile signed URL, so re-fetch `videoDub(id)` and
 * re-pick. `network-only` so cache doesn't hand back the stale URL. Null on failure.
 */
async function reresolveMediaUrl(args: {
  dubDocumentId: string
  renditionDocumentId: string
  qualityLabel: string
  totalBytes: number
  subtitleLanguageSlug: string | null
}): Promise<{ mediaUrl: string; subtitleUrl: string | null } | null> {
  // A hung network-only query would stall the (re)start forever — it has no
  // inherent deadline. Abort after 10s so callers fall back gracefully.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await getApolloClient().query({
      query: GET_VIDEO_DUB,
      variables: { id: args.dubDocumentId },
      fetchPolicy: "network-only",
      context: { fetchOptions: { signal: controller.signal } },
    })
    const media = normalizeDubMedia(res.data?.videoDub ?? null)
    if (!media) {
      // R28: a null re-resolution is the pre-transfer step that leaves a download
      // "stuck queued / never starts" — surface each null branch distinctly.
      datadogLog.warn("downloads.reresolve_failed", { reason: "no-media" })
      return null
    }
    const resolution = resolveFromMedia(media, {
      renditionDocumentId: args.renditionDocumentId,
      qualityLabel: args.qualityLabel,
      totalBytes: args.totalBytes || undefined,
      subtitleLanguageSlug: args.subtitleLanguageSlug,
    })
    if (resolution.kind !== "resolved") {
      datadogLog.warn("downloads.reresolve_failed", { reason: "unresolved" })
      return null
    }
    return {
      mediaUrl: resolution.mediaUrl,
      subtitleUrl: resolution.subtitleUrl,
    }
  } catch {
    // R14/R28: the aborted flag separates the 10s give-up budget from a transport
    // error — a distinction the RUM↔APM durations would otherwise contradict.
    datadogLog.warn("downloads.reresolve_failed", {
      reason: controller.signal.aborted ? "timeout" : "error",
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}

type RecordMap = Record<string, OfflineDownloadRecord>

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<RecordMap>({})
  const [isReady, setIsReady] = useState(false)

  const recordsRef = useRef(records)
  recordsRef.current = records

  // R14: strict-sequential batch queue — pending requests in episode order,
  // the slugs any batch enqueued this session (scopes pump occupancy), and a
  // single-flight guard so overlapping pump wakeups can't double-start.
  const batchQueueRef = useRef<StartDownloadRequest[]>([])
  const batchSlugsRef = useRef<Set<string>>(new Set())
  const batchPumpingRef = useRef(false)
  // Stable handle so the launch-reattach effect (defined before the pump) can
  // wake it after reseeding relaunched placeholders (review #2).
  const batchPumpRef = useRef<() => void>(() => {})

  const dropFromBatchQueue = useCallback((videoSlug: string) => {
    batchQueueRef.current = batchQueueRef.current.filter(
      (request) => request.videoSlug !== videoSlug,
    )
  }, [])

  // Episodes queued for a re-download swap: still `downloaded` (old copy playable)
  // but pending replacement. Reactive so the ring recomputes and counts them 0
  // (a re-download fills from 0). Enqueue adds; pump/cancel/delete removes.
  const [pendingSwapSlugs, setPendingSwapSlugs] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const enterPendingSwap = useCallback((videoSlug: string) => {
    setPendingSwapSlugs((prev) =>
      prev.has(videoSlug) ? prev : new Set(prev).add(videoSlug),
    )
  }, [])
  const leavePendingSwap = useCallback((videoSlug: string) => {
    setPendingSwapSlugs((prev) => {
      if (!prev.has(videoSlug)) return prev
      const next = new Set(prev)
      next.delete(videoSlug)
      return next
    })
  }, [])
  // Single owner for fully leaving the batch scope (queue entry + occupancy slot +
  // pending-swap flag together), so a teardown site can't clear one and leak the
  // rest — a leaked pending flag would pin the ring at "Downloading…" (review).
  const removeFromBatchScope = useCallback(
    (videoSlug: string) => {
      dropFromBatchQueue(videoSlug)
      batchSlugsRef.current.delete(videoSlug)
      leavePendingSwap(videoSlug)
    },
    [dropFromBatchQueue, leavePendingSwap],
  )

  // Supersede's narrower teardown: the language-switch replacement reclaims the
  // occupancy slot, so only the queue entry + pending-swap flag drop (R14).
  const onSupersedeScope = useCallback(
    (videoSlug: string) => {
      dropFromBatchQueue(videoSlug)
      leavePendingSwap(videoSlug)
    },
    [dropFromBatchQueue, leavePendingSwap],
  )

  const { wifiOnly } = useWatchPreferences()
  // Read inside the launch-reattach effect without making it re-run (and re-queue
  // downloads) every time the preference toggles.
  const wifiOnlyRef = useRef(wifiOnly)
  wifiOnlyRef.current = wifiOnly

  // Hydrate the sharded manifest on mount. Bulletproof: any read/parse failure
  // degrades to an empty manifest rather than throwing during boot.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const indexRaw = await AsyncStorage.getItem(OFFLINE_INDEX_STORAGE_KEY)
        const slugs = parseOfflineIndex(indexRaw)
        const entries = await Promise.all(
          slugs.map(async (slug) => {
            const raw = await AsyncStorage.getItem(
              offlineRecordKey(slug),
            ).catch(() => null)
            return [slug, parseOfflineRecord(raw)] as const
          }),
        )
        if (cancelled) return
        const next: RecordMap = {}
        for (const [slug, record] of entries) if (record) next[slug] = record
        setRecords(next)
      } catch {
        // R17: a swallowed manifest read degrades the whole offline library to
        // empty until a good read lands — the "my downloads disappeared" class.
        datadogLog.warn("manifest.hydrate_failed", {})
        // First launch or read failure — empty manifest already applied.
      } finally {
        if (!cancelled) setIsReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const writeRecord = useCallback(async (record: OfflineDownloadRecord) => {
    // Only rewrite the index when the slug SET changes (a brand-new record);
    // patching an existing record leaves it identical, so skip it — rewriting
    // on every progress tick doubles AsyncStorage churn for no benefit.
    const isNew = !(record.videoSlug in recordsRef.current)
    const next = { ...recordsRef.current, [record.videoSlug]: record }
    recordsRef.current = next
    setRecords(next)
    try {
      if (isNew) {
        // multiSet so the record and the index that lists it land together — a
        // record present in the index but missing on disk reads back as null.
        await AsyncStorage.multiSet([
          [offlineRecordKey(record.videoSlug), serializeOfflineRecord(record)],
          [OFFLINE_INDEX_STORAGE_KEY, serializeOfflineIndex(Object.keys(next))],
        ])
      } else {
        await AsyncStorage.setItem(
          offlineRecordKey(record.videoSlug),
          serializeOfflineRecord(record),
        )
      }
    } catch {
      // R17: a swallowed write means the record won't survive a relaunch — the
      // "my downloads disappeared" class; in-memory still applies this session.
      datadogLog.warn("manifest.persist_failed", {
        op: isNew ? "create" : "update",
      })
    }
  }, [])

  const removeRecord = useCallback(async (videoSlug: string) => {
    const next = { ...recordsRef.current }
    delete next[videoSlug]
    recordsRef.current = next
    setRecords(next)
    try {
      await AsyncStorage.removeItem(offlineRecordKey(videoSlug))
      await AsyncStorage.setItem(
        OFFLINE_INDEX_STORAGE_KEY,
        serializeOfflineIndex(Object.keys(next)),
      )
    } catch {
      // R17: swallowed removal — the record may resurrect on relaunch; in-memory
      // removal already took effect this session.
      datadogLog.warn("manifest.persist_failed", { op: "remove" })
    }
  }, [])

  // Composition root (todo 013): the engine-facing lifecycle lives in lib; the
  // provider owns manifest state + batch orchestration and injects them here.
  // Created once — every dep closes over stable refs/callbacks.
  const lifecycleRef = useRef<DownloadLifecycle | null>(null)
  if (lifecycleRef.current === null) {
    lifecycleRef.current = createDownloadLifecycle({
      getRecord: (videoSlug) => recordsRef.current[videoSlug],
      writeRecord,
      removeRecord,
      reresolveMediaUrl,
      allowCellularForRestart: () => !wifiOnlyRef.current,
      onLeaveBatchScope: removeFromBatchScope,
      onSupersedeScope,
      offlineRoot: OFFLINE_ROOT,
      // U8: the provider owns the Datadog import; the lifecycle stays SDK-free.
      telemetry: datadogLog,
      engine: {
        start: startMediaDownload,
        wire: wireExistingTask,
        pause: pauseTask,
        resume: resumeTask,
        stop: stopTask,
      },
      fs: {
        ensureVideoDir,
        freeDiskBytes,
        fileExists,
        moveFile,
        removeUri,
        removeVideoDir,
        downloadToFile,
      },
      notifyIosBackgroundComplete,
    })
  }
  const lifecycle = lifecycleRef.current

  const queueBatchRecords = useCallback(
    async (requests: StartDownloadRequest[]) => {
      for (const request of requests) {
        const existing = recordsRef.current[request.videoSlug]
        // A live record (downloaded / in-progress) is driven by start/swap/switch;
        // overwriting it with `queued` would discard its committedPath / swapFrom.
        // Only fresh or previously-terminal slugs need a queued placeholder.
        if (isLiveDownloadRecord(existing)) {
          continue
        }
        await writeRecord(buildRequestRecord(request, "queued"))
      }
    },
    [writeRecord],
  )

  // Apply the global engine config once hydrated and whenever wifi-only changes.
  useEffect(() => {
    if (!isReady) return
    try {
      configureDownloadEngine({ wifiOnly })
    } catch {
      // Engine unavailable (build without the native module) — read surface
      // still works; downloads are inert until a proper dev build.
    }
  }, [isReady, wifiOnly])

  // Defensive launch reattach: reconcile records vs live tasks + on-disk files,
  // drop orphans, then RE-BIND handlers onto surviving tasks. A reattached task
  // carries no JS callbacks, so its done event would otherwise fire into the void.
  useEffect(() => {
    if (!isReady) return
    let cancelled = false
    void (async () => {
      try {
        const tasks = await listExistingDownloadTasks().catch(() => [])
        const liveTaskSlugs = new Set(tasks.map((task) => task.id))
        const current = Object.values(recordsRef.current)
        // Snapshot pending paths up front so a cleanupOrphanPending action can
        // still find the file to delete even if the record was dropped earlier
        // in the action loop (e.g. a canceled record).
        const pendingPathBySlug = new Map<string, string>()
        for (const record of current) {
          if (record.pendingPath) {
            pendingPathBySlug.set(record.videoSlug, record.pendingPath)
          }
        }
        const committedFileSlugs = new Set<string>()
        const pendingFileSlugs = new Set<string>()
        await Promise.all(
          current.map(async (record) => {
            if (
              record.committedPath &&
              (await fileExists(record.committedPath))
            ) {
              committedFileSlugs.add(record.videoSlug)
            }
            if (record.pendingPath && (await fileExists(record.pendingPath))) {
              pendingFileSlugs.add(record.videoSlug)
            }
          }),
        )
        if (cancelled) return
        const actions = reconcile({
          records: current,
          liveTaskSlugs,
          pendingFileSlugs,
          committedFileSlugs,
        })

        // R27: one disposition tally per cold start — the diagnostic for
        // "downloads lost / stuck / duplicated after relaunch."
        const reconcileTally = actions.reduce<Record<string, number>>(
          (acc, a) => ({ ...acc, [a.action]: (acc[a.action] ?? 0) + 1 }),
          {},
        )
        datadogLog.info("downloads.reconcile", {
          total: actions.length,
          ...reconcileTally,
        })

        const droppedSlugs = new Set<string>()
        for (const action of actions) {
          if (cancelled) return
          if (action.action === "dropRecord") {
            droppedSlugs.add(action.videoSlug)
            await removeRecord(action.videoSlug)
          } else if (
            action.action === "requeue" ||
            action.action === "repair"
          ) {
            const record = recordsRef.current[action.videoSlug]
            if (record && isBatchPlaceholderRecord(record)) {
              // A relaunched batch placeholder re-enters the sequential queue —
              // restarting it directly would fan out every queued episode as a
              // concurrent native task, abandoning R14 ordering (review #2).
              batchQueueRef.current = [
                ...batchQueueRef.current,
                buildReattachRequest(record, !wifiOnlyRef.current),
              ]
              batchSlugsRef.current.add(record.videoSlug)
            } else if (record) {
              await lifecycle.restart(record)
            }
          } else if (action.action === "cleanupOrphanPending") {
            // A `.pending` partial with no in-flight record backing it — delete
            // the leaked bytes and clear the stale path so it isn't re-flagged
            // on the next launch.
            const pending = pendingPathBySlug.get(action.videoSlug)
            if (pending) await removeUri(pending)
            const record = recordsRef.current[action.videoSlug]
            if (record?.pendingPath) {
              await writeRecord({ ...record, pendingPath: null })
            }
          }
        }
        if (cancelled) return
        for (const task of tasks) {
          const record = recordsRef.current[task.id]
          if (!record || droppedSlugs.has(task.id)) continue
          if (
            record.state !== "downloading" &&
            record.state !== "queued" &&
            record.state !== "paused"
          ) {
            continue
          }
          // U6/R3: wireTask re-binds handlers and re-resolves the subtitle URL
          // lazily at commit, so wiring is never blocked on the network.
          lifecycle.wireTask(task, record)
        }
        // Drain any placeholders reseeded above (a pure-requeue reconcile may
        // not touch `records`, so the records-effect alone won't wake the pump).
        batchPumpRef.current()
      } catch {
        // Reattach is best-effort and must never break boot.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isReady, removeRecord, writeRecord, lifecycle])

  // R14: drain the batch queue — start the head episode when the single slot
  // is free, drop stale heads. Single-flight; every terminal path mutates
  // `records`, whose effect below re-invokes the pump, so no missed wakeups.
  const pumpBatchQueue = useCallback(() => {
    if (batchPumpingRef.current) return
    batchPumpingRef.current = true
    void (async () => {
      try {
        while (true) {
          const action = nextBatchAction(
            recordsRef.current,
            batchQueueRef.current,
            batchSlugsRef.current,
          )
          if (action.kind === "empty") {
            // Batch fully drained: release the occupancy scope so a later
            // manual download of a once-batched slug can't hold the slot.
            const stillActive = Object.values(recordsRef.current).some(
              (r) =>
                batchSlugsRef.current.has(r.videoSlug) &&
                (r.state === "downloading" || r.state === "paused"),
            )
            if (!stillActive) {
              batchSlugsRef.current = new Set()
              datadogLog.info("batch.pump", {
                disposition: "occupancy-released",
              })
            }
            return
          }
          if (action.kind === "wait") return
          if (action.kind === "drop") {
            // Terminal disposition (stale/failed/gone head, occupancy already 0):
            // leave the whole batch scope so a pending-swap flag can't leak and
            // pin the ring at "Downloading…" (review: correctness/reliability).
            datadogLog.info("batch.pump", {
              disposition: "drop",
              content_id: action.videoSlug,
            })
            removeFromBatchScope(action.videoSlug)
            continue
          }
          dropFromBatchQueue(action.request.videoSlug)
          // A still-`downloaded` head is a re-download → swap it (non-destructive,
          // keeps the old copy until the new verifies); a bare placeholder is a
          // fresh start. Either way it runs to a terminal state before the next.
          const isSwap =
            recordsRef.current[action.request.videoSlug]?.state === "downloaded"
          const result = isSwap
            ? await lifecycle.swap(action.request)
            : await lifecycle.start(action.request)
          // R30: the per-episode disposition — the diagnostic for "download-all
          // stopped at N of M."
          datadogLog.info("batch.pump", {
            disposition: isSwap ? "swap" : "start",
            content_id: action.request.videoSlug,
            result: result.ok ? "ok" : result.reason,
          })
          // A pump-time failure removes the adopted placeholder, silently erasing
          // the episode the sheet accepted — resurface it as `failed` so the badge
          // /Library offer delete/retry (review #4; a failed swap reverts instead).
          if (
            !result.ok &&
            result.reason !== "exists" &&
            result.reason !== "canceled" &&
            !recordsRef.current[action.request.videoSlug]
          ) {
            datadogLog.info("batch.pump", {
              disposition: "failed-resurface",
              content_id: action.request.videoSlug,
            })
            await writeRecord(buildRequestRecord(action.request, "failed"))
          }
          // Processed → no longer a pending swap. Done AFTER the swap wrote its
          // `downloading` record, so the ring never blips through "done" (an
          // in-flight `downloading` reads as its byte fraction, not full).
          leavePendingSwap(action.request.videoSlug)
        }
      } finally {
        batchPumpingRef.current = false
      }
    })()
  }, [
    lifecycle,
    dropFromBatchQueue,
    removeFromBatchScope,
    writeRecord,
    leavePendingSwap,
  ])
  batchPumpRef.current = pumpBatchQueue

  useEffect(() => {
    if (!isReady) return
    pumpBatchQueue()
  }, [records, isReady, pumpBatchQueue])

  // R14: accept a batch episode into the sequential queue. The caller has
  // already persisted its `queued` placeholder (queueBatchRecords), so the
  // grid badge and cancel-all work while the episode waits its turn.
  const queueBatchDownload = useCallback(
    async (request: StartDownloadRequest): Promise<StartDownloadResult> => {
      if (
        !canQueueBatchDownload(
          recordsRef.current,
          batchQueueRef.current,
          request.videoSlug,
        )
      ) {
        return { ok: false, reason: "exists" }
      }
      batchQueueRef.current = [...batchQueueRef.current, request]
      batchSlugsRef.current.add(request.videoSlug)
      // A downloaded slug queued here is a re-download swap — mark it pending so
      // the ring drops to 0 now (a fresh episode is `queued`, already counted).
      if (recordsRef.current[request.videoSlug]?.state === "downloaded") {
        enterPendingSwap(request.videoSlug)
      }
      pumpBatchQueue()
      return { ok: true }
    },
    [pumpBatchQueue, enterPendingSwap],
  )

  // D2/R21: retry only ever restarts the existing failed record — never a
  // fresh startDownload (its resolution-failure path deletes the record).
  const retryDownload = useCallback(
    (videoSlug: string) =>
      retryFailedDownload(
        {
          getRecord: (slug) => recordsRef.current[slug],
          restart: lifecycle.restart,
        },
        videoSlug,
      ),
    [lifecycle],
  )

  const value = useMemo<DownloadsContextValue>(
    () => ({
      isReady,
      getRecord: (videoSlug) => records[videoSlug] ?? null,
      committedFor: (videoSlug) => {
        const record = records[videoSlug]
        if (!record) return null
        if (record.state === "downloaded" && record.committedPath)
          return record.committedPath
        // During a swap the new copy isn't committed yet — keep the snapshot's
        // old file playable until the swap verifies.
        if (record.swapFrom?.committedPath) return record.swapFrom.committedPath
        return null
      },
      downloadedSlugs: Object.values(records)
        .filter((record) => record.state === "downloaded")
        .map((record) => record.videoSlug),
      offlineRecords: Object.values(records).filter(
        (record) => record.state !== "canceled",
      ),
      pendingSwapSlugs,
      startDownload: lifecycle.start,
      swapDownload: lifecycle.swap,
      queueBatchDownload,
      queueBatchRecords,
      deleteDownload: lifecycle.deleteDownload,
      pauseDownload: lifecycle.pause,
      resumeDownload: lifecycle.resume,
      retryDownload,
      cancelDownload: lifecycle.cancel,
      supersedeDownload: lifecycle.supersede,
    }),
    [
      records,
      isReady,
      pendingSwapSlugs,
      lifecycle,
      queueBatchDownload,
      queueBatchRecords,
      retryDownload,
    ],
  )

  return (
    <DownloadsContext.Provider value={value}>
      {children}
    </DownloadsContext.Provider>
  )
}

export function useDownloads() {
  const ctx = useContext(DownloadsContext)
  if (!ctx) {
    throw new Error("useDownloads must be used within DownloadsProvider")
  }
  return ctx
}
