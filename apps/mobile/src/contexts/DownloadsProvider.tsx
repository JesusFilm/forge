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
  type EngineTask,
  type MediaDownloadHandlers,
} from "../lib/downloadEngine"
import { resolveBundle } from "../lib/downloadOutcome"
import { reconcile } from "../lib/downloadReconciliation"
import {
  buildCommittedPath,
  buildPendingPath,
  buildPosterPath,
  buildSubtitlePath,
} from "../lib/offlineFiles"
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
  OFFLINE_MANIFEST_VERSION,
  isBatchPlaceholderRecord,
  isLiveDownloadRecord,
  offlineRecordKey,
  parseOfflineIndex,
  parseOfflineRecord,
  serializeOfflineIndex,
  serializeOfflineRecord,
  type OfflineDownloadRecord,
  type SwapFrom,
} from "../lib/offlineManifest"
import { normalizeDubMedia, type WatchDownload } from "../lib/normalizeVideo"
import { STORAGE_RESERVE_BYTES } from "../lib/offlineConstants"
import { getApolloClient } from "../lib/apolloClient"
import { resolveFromMedia } from "../lib/downloadUrlResolution"
import { decideCancelAction } from "../lib/downloadControls"
import { GET_VIDEO_DUB } from "../lib/queries"
import { validateActionUrl } from "../lib/validateUrl"
import { useWatchPreferences } from "./WatchPreferencesProvider"

/**
 * App-wide offline-downloads state, mounted at the root layout (not the watch
 * route) so the detail-page badge and My Downloads — both outside the watch
 * route group — can read it. Transfer/background behavior is device-verified.
 */
export type StartDownloadRequest = {
  videoSlug: string
  /** Human title stored on the record for the offline library. */
  title: string
  dubDocumentId: string
  /** The chosen rendition (documentId/quality/size/url) to download. */
  rendition: WatchDownload
  /** Chosen subtitle language slug, or null for "No subtitles". */
  subtitleLanguageSlug: string | null
  /** Fresh subtitle VTT URL when a subtitle was chosen, else null. */
  subtitleUrl: string | null
  /** Poster URL to cache for the offline library, if available. */
  posterUrl: string | null
  /** Per-download cellular override. */
  allowCellular: boolean
}

export type StartDownloadResult =
  | { ok: true }
  | { ok: false; reason: "exists" | "insufficient-storage" | "error" }

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
  /** Enqueue an offline download (one copy per video). */
  startDownload: (request: StartDownloadRequest) => Promise<StartDownloadResult>
  /** Swap a downloaded video to a new quality/language, non-destructively. */
  swapDownload: (request: StartDownloadRequest) => Promise<StartDownloadResult>
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
    if (!media) return null
    const resolution = resolveFromMedia(media, {
      renditionDocumentId: args.renditionDocumentId,
      qualityLabel: args.qualityLabel,
      totalBytes: args.totalBytes || undefined,
      subtitleLanguageSlug: args.subtitleLanguageSlug,
    })
    if (resolution.kind !== "resolved") return null
    return {
      mediaUrl: resolution.mediaUrl,
      subtitleUrl: resolution.subtitleUrl,
    }
  } catch {
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

  // U2: live native task handles keyed by slug, so pause/resume/cancel/supersede
  // (U3/U4) can act on an in-flight transfer. Populated on start/swap/restart and
  // on relaunch reattach; entries are dropped when a task reaches a terminal event.
  const taskRegistry = useRef(new Map<string, EngineTask>())

  // U3: dedupe concurrent restarts (double-tap resume). A resume with no live
  // task re-resolves for ~10s before its task registers, so guard synchronously.
  const restartingRef = useRef(new Set<string>())

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
      // Best-effort; the in-memory record still applies this session.
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
      // Best-effort; the in-memory removal already took effect this session.
    }
  }, [])

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
        await writeRecord({
          version: OFFLINE_MANIFEST_VERSION,
          videoSlug: request.videoSlug,
          dubDocumentId: request.dubDocumentId,
          renditionDocumentId: request.rendition.documentId,
          qualityLabel: request.rendition.quality,
          title: request.title,
          subtitleLanguageSlug: request.subtitleLanguageSlug,
          state: "queued",
          committedPath: null,
          pendingPath: null,
          posterPath: null,
          bytesWritten: 0,
          totalBytes: Number(request.rendition.size) || 0,
        })
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

  const deleteDownload = useCallback(
    async (videoSlug: string) => {
      // R1: stop the in-flight native transfer BEFORE removing files/record, so
      // it doesn't keep downloading and no late done-callback writes into the
      // removed dir. No live task (already downloaded/failed) → just remove.
      const task = taskRegistry.current.get(videoSlug)
      if (task) {
        taskRegistry.current.delete(videoSlug)
        try {
          await stopTask(task)
        } catch {
          // Best-effort stop; remove regardless so the UI stays consistent.
        }
      }
      await removeVideoDir(videoSlug)
      await removeRecord(videoSlug)
    },
    [removeRecord],
  )

  // Build the native event handlers for one download, bound to its identity and
  // sidecars. Shared by startDownload (fresh) and the launch reattach (re-bind
  // a task that survived a restart) so both paths commit identically.
  const buildHandlers = useCallback(
    (args: {
      videoSlug: string
      committedPath: string
      pendingPath: string
      /** Total-size fallback when the OS hasn't reported one yet. */
      fallbackTotalBytes: number
      subtitleLanguageSlug: string | null
      subtitleUrl: string | null
      /** U6: lazy subtitle-URL resolver for the reattach path (no persisted URL). */
      resolveSubtitleUrl?: () => Promise<string | null>
      posterUrl: string | null
    }): MediaDownloadHandlers => {
      const { videoSlug, committedPath, pendingPath, fallbackTotalBytes } = args

      // U4/KTD3: a `canceled` interruption that lands before this task's onBegin
      // is a stale terminal from a superseded old task that the native layer
      // routed to this reused slug — not a real cancel. Guard the delete on it.
      let hasBegun = false

      const patch = (fields: Partial<OfflineDownloadRecord>) => {
        const current = recordsRef.current[videoSlug]
        if (!current) return
        void writeRecord({ ...current, ...fields })
      }

      // A swap's new download failed — restore the original copy (AE2): drop the
      // new partial and revert the record's identity to the snapshot. The old
      // file was never touched, so it's still playable.
      const revertSwap = (swap: SwapFrom) => {
        void removeUri(pendingPath)
        patch({
          state: "downloaded",
          committedPath: swap.committedPath,
          renditionDocumentId: swap.renditionDocumentId,
          qualityLabel: swap.qualityLabel,
          subtitleLanguageSlug: swap.subtitleLanguageSlug,
          posterPath: swap.posterPath,
          totalBytes: swap.totalBytes,
          bytesWritten: swap.totalBytes,
          pendingPath: null,
          swapFrom: null,
        })
      }

      const finalize = async (location: string) => {
        try {
          // `location` already equals our pendingPath, so the "move" is a pending -> committed
          // rename. Guard the benign cases (already committed, or the source already moved by a
          // prior attempt) so they don't force `failed`.
          const source = (await fileExists(location)) ? location : pendingPath
          if (source !== committedPath) {
            if (await fileExists(source)) {
              await moveFile(source, committedPath)
            } else if (!(await fileExists(committedPath))) {
              const swap = recordsRef.current[videoSlug]?.swapFrom
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
            // Validate the CMS-sourced URL before fetching (CLAUDE.md: validate
            // all CMS URLs). An unsafe URL is a terminal subtitle failure —
            // media still completes, the subtitle degrades.
            if (!validateActionUrl(subtitleUrl)) {
              subtitleTerminallyFailed = true
            } else {
              try {
                await downloadToFile(
                  subtitleUrl,
                  buildSubtitlePath(
                    OFFLINE_ROOT,
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
            const target = buildPosterPath(OFFLINE_ROOT, videoSlug)
            try {
              await downloadToFile(args.posterUrl, target)
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
            // subtitle-only swap where rendition is unchanged so old path
            // EQUALS new — deleting it would destroy the media we just committed.
            const swap = recordsRef.current[videoSlug]?.swapFrom
            if (swap) {
              if (swap.committedPath !== committedPath) {
                await removeUri(swap.committedPath)
              }
              patch({ swapFrom: null })
            }
          } else {
            const swap = recordsRef.current[videoSlug]?.swapFrom
            if (swap) revertSwap(swap)
            else patch({ state: "failed" })
          }
        } catch {
          const swap = recordsRef.current[videoSlug]?.swapFrom
          if (swap) revertSwap(swap)
          else patch({ state: "failed" })
        }
      }

      return {
        onBegin: ({ expectedBytes }) => {
          hasBegun = true
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
          taskRegistry.current.delete(videoSlug)
          // Signal iOS only AFTER finalize settles; signalling first lets iOS
          // suspend mid-finalize on a background-only launch, cutting sidecars
          // short. `finally` so we always signal — else iOS throttles future background time.
          void finalize(location).finally(() =>
            notifyIosBackgroundComplete(videoSlug),
          )
        },
        onInterruption: (classification) => {
          // Any native interruption is terminal for this task handle (a
          // connectivity/wifi/background error stops it). A user pause never
          // arrives here — it sets state directly (U3) and keeps the handle.
          taskRegistry.current.delete(videoSlug)
          const swap = recordsRef.current[videoSlug]?.swapFrom
          if (swap) {
            // A swap was interrupted — keep the original copy intact.
            revertSwap(swap)
          } else if (classification.state === "canceled") {
            // Skip the delete when (KTD3) the event arrives before this task ever
            // began — a stale terminal from a SUPERSEDED old task the native layer
            // routed to this reused slug — or (KTD2) the record is already
            // `paused` — the native pause surfacing as cancel-with-resume-data.
            // Neither is a genuine cancel.
            if (hasBegun && recordsRef.current[videoSlug]?.state !== "paused") {
              void deleteDownload(videoSlug)
            }
          } else {
            patch({ state: classification.state })
          }
          notifyIosBackgroundComplete(videoSlug)
        },
      }
    },
    [writeRecord, deleteDownload],
  )

  // U3: restart an interrupted download — re-resolve the URL, rewrite it
  // `downloading`, start, and register. Hoisted from the reattach effect so
  // resumeDownload's no-live-task branch reuses one restart path. Best-effort: a
  // null re-resolve (offline / unsafe URL) leaves the record for the next launch.
  // U6 threads the re-resolved subtitle through here.
  const restartDownload = useCallback(
    async (record: OfflineDownloadRecord) => {
      if (restartingRef.current.has(record.videoSlug)) return
      restartingRef.current.add(record.videoSlug)
      try {
        const refreshed = await reresolveMediaUrl({
          dubDocumentId: record.dubDocumentId,
          renditionDocumentId: record.renditionDocumentId,
          qualityLabel: record.qualityLabel,
          totalBytes: record.totalBytes,
          subtitleLanguageSlug: record.subtitleLanguageSlug,
        })
        if (!refreshed || !validateActionUrl(refreshed.mediaUrl)) return
        const nonce = `${Date.now().toString(36)}-${Math.floor(
          Math.random() * 1e9,
        ).toString(36)}`
        const pendingPath =
          record.pendingPath ??
          buildPendingPath(OFFLINE_ROOT, record.videoSlug, nonce)
        const committedPath = buildCommittedPath(
          OFFLINE_ROOT,
          record.videoSlug,
          record.renditionDocumentId,
        )
        try {
          // Engine config is applied once by the mount effect — never here.
          // Re-applying recreates the URLSession and cancels sibling restarts.
          await ensureVideoDir(record.videoSlug)
        } catch {
          return
        }
        await writeRecord({
          ...record,
          state: "downloading",
          committedPath: null,
          pendingPath,
          bytesWritten: 0,
        })
        let task: EngineTask
        try {
          task = startMediaDownload(
            {
              id: record.videoSlug,
              url: refreshed.mediaUrl,
              destination: pendingPath,
              allowCellular: !wifiOnlyRef.current,
            },
            buildHandlers({
              videoSlug: record.videoSlug,
              committedPath,
              pendingPath,
              fallbackTotalBytes: record.totalBytes,
              // U6: restart re-resolves the whole dub, so the fresh subtitle URL is
              // already in hand — thread it straight through.
              subtitleLanguageSlug: record.subtitleLanguageSlug,
              subtitleUrl: refreshed.subtitleUrl,
              posterUrl: null,
            }),
          )
        } catch {
          // Engine start threw — mark failed (delete/retry stay available)
          // instead of stranding a phantom "downloading" record with no task.
          await writeRecord({ ...record, state: "failed" })
          return
        }
        taskRegistry.current.set(record.videoSlug, task)
      } finally {
        restartingRef.current.delete(record.videoSlug)
      }
    },
    [writeRecord, buildHandlers],
  )

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
            if (record) await restartDownload(record)
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
          const committedPath =
            record.committedPath ??
            buildCommittedPath(
              OFFLINE_ROOT,
              record.videoSlug,
              record.renditionDocumentId,
            )
          const pendingPath =
            record.pendingPath ??
            buildPendingPath(OFFLINE_ROOT, record.videoSlug, "reattach")
          // U6: the subtitle URL isn't persisted, but the sidecar is re-resolved
          // lazily at commit from the record's stored language slug — so a
          // reattached download still commits with its chosen subtitle (R3).
          wireExistingTask(
            task,
            buildHandlers({
              videoSlug: record.videoSlug,
              committedPath,
              pendingPath,
              fallbackTotalBytes: record.totalBytes,
              // U6: the surviving task has no persisted subtitle URL — re-resolve
              // it lazily at commit so wiring is never blocked on the network.
              subtitleLanguageSlug: record.subtitleLanguageSlug,
              subtitleUrl: null,
              resolveSubtitleUrl: async () =>
                (
                  await reresolveMediaUrl({
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
          taskRegistry.current.set(task.id, task)
        }
      } catch {
        // Reattach is best-effort and must never break boot.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isReady, removeRecord, buildHandlers, writeRecord, restartDownload])

  const startDownload = useCallback(
    async (request: StartDownloadRequest): Promise<StartDownloadResult> => {
      const { videoSlug, rendition } = request
      const existing = recordsRef.current[videoSlug]
      // A BARE `queued` record (no pending, no committed) is the batch's own
      // placeholder from queueBatchRecords — nothing else writes bare-queued — so
      // adopt it (drive to downloading) instead of reporting `exists`.
      const isOwnPlaceholder = isBatchPlaceholderRecord(existing)
      // One copy per video: ignore if a live copy/queue entry already exists.
      if (isLiveDownloadRecord(existing) && !isOwnPlaceholder) {
        return { ok: false, reason: "exists" }
      }

      // U12: refuse before writing a record if the footprint plus a reserve (so
      // the device never fills up) won't fit. A free read of 0 means the API is
      // unavailable — don't block on a check we couldn't perform.
      const required = (Number(rendition.size) || 0) + STORAGE_RESERVE_BYTES
      const free = await freeDiskBytes()
      if (free > 0 && free < required) {
        // Clean up only our own adopted placeholder — never a pre-existing record.
        if (isOwnPlaceholder) await removeRecord(videoSlug)
        return { ok: false, reason: "insufficient-storage" }
      }

      try {
        // Engine config is applied once by the mount effect, NOT per download:
        // re-applying tears down + recreates the URLSession, cancelling every
        // sibling download already in flight (the series "stops at N of M" bug).
        await ensureVideoDir(videoSlug)
      } catch {
        if (isOwnPlaceholder) await removeRecord(videoSlug)
        return { ok: false, reason: "error" }
      }

      const nonce = `${Date.now().toString(36)}-${Math.floor(
        Math.random() * 1e9,
      ).toString(36)}`
      const pendingPath = buildPendingPath(OFFLINE_ROOT, videoSlug, nonce)
      const committedPath = buildCommittedPath(
        OFFLINE_ROOT,
        videoSlug,
        rendition.documentId,
      )

      await writeRecord({
        version: OFFLINE_MANIFEST_VERSION,
        videoSlug,
        dubDocumentId: request.dubDocumentId,
        renditionDocumentId: rendition.documentId,
        qualityLabel: rendition.quality,
        title: request.title,
        subtitleLanguageSlug: request.subtitleLanguageSlug,
        state: "downloading",
        committedPath: null,
        pendingPath,
        posterPath: null,
        bytesWritten: 0,
        totalBytes: Number(rendition.size) || 0,
      })

      // U4: refresh the signed URL right before starting — the sheet's URL may
      // have expired while it sat open. Fall back to the page URL so a transient
      // refresh failure never blocks an otherwise-valid download.
      const fresh = await reresolveMediaUrl({
        dubDocumentId: request.dubDocumentId,
        renditionDocumentId: rendition.documentId,
        qualityLabel: rendition.quality,
        totalBytes: Number(rendition.size) || 0,
        subtitleLanguageSlug: request.subtitleLanguageSlug,
      })

      const mediaUrl = fresh?.mediaUrl ?? rendition.url
      // Validate the CMS-sourced media URL before handing it to the native
      // downloader (CLAUDE.md invariant). Both candidates failing means we have
      // no safe URL — drop the provisional record and report the error.
      if (!validateActionUrl(mediaUrl)) {
        await removeRecord(videoSlug)
        return { ok: false, reason: "error" }
      }

      // The engine can throw synchronously (missing native module, session init
      // failure) — drop the provisional record so no phantom "downloading" row
      // survives a start that never produced a task.
      let task: EngineTask
      try {
        task = startMediaDownload(
          {
            id: videoSlug,
            url: mediaUrl,
            destination: pendingPath,
            allowCellular: request.allowCellular,
          },
          buildHandlers({
            videoSlug,
            committedPath,
            pendingPath,
            fallbackTotalBytes: Number(rendition.size) || 0,
            subtitleLanguageSlug: request.subtitleLanguageSlug,
            subtitleUrl: fresh?.subtitleUrl ?? request.subtitleUrl,
            posterUrl: request.posterUrl,
          }),
        )
      } catch {
        await removeRecord(videoSlug)
        return { ok: false, reason: "error" }
      }
      taskRegistry.current.set(videoSlug, task)
      return { ok: true }
    },
    [writeRecord, removeRecord, buildHandlers],
  )

  // U8: non-destructive quality/language swap on an already-downloaded video.
  // The new copy downloads alongside the old (kept playable via swapFrom); on
  // success the old file is deleted, on failure the record reverts (AE2).
  const swapDownload = useCallback(
    async (request: StartDownloadRequest): Promise<StartDownloadResult> => {
      const { videoSlug, rendition } = request
      const existing = recordsRef.current[videoSlug]
      // Only a completed copy can be swapped; else treat it as a fresh download.
      if (
        !existing ||
        existing.state !== "downloaded" ||
        !existing.committedPath
      ) {
        return startDownload(request)
      }
      // Identical rendition + subtitle → nothing to change.
      if (
        existing.renditionDocumentId === rendition.documentId &&
        existing.subtitleLanguageSlug === request.subtitleLanguageSlug
      ) {
        return { ok: false, reason: "exists" }
      }
      // The new copy lives alongside the old until verified, so reserve room.
      const required = (Number(rendition.size) || 0) + STORAGE_RESERVE_BYTES
      const free = await freeDiskBytes()
      if (free > 0 && free < required) {
        return { ok: false, reason: "insufficient-storage" }
      }
      try {
        // See startDownload: engine config is applied once by the mount effect.
        await ensureVideoDir(videoSlug)
      } catch {
        return { ok: false, reason: "error" }
      }

      const nonce = `${Date.now().toString(36)}-${Math.floor(
        Math.random() * 1e9,
      ).toString(36)}`
      const pendingPath = buildPendingPath(OFFLINE_ROOT, videoSlug, nonce)
      const committedPath = buildCommittedPath(
        OFFLINE_ROOT,
        videoSlug,
        rendition.documentId,
      )
      const swapFrom: SwapFrom = {
        committedPath: existing.committedPath,
        renditionDocumentId: existing.renditionDocumentId,
        qualityLabel: existing.qualityLabel,
        subtitleLanguageSlug: existing.subtitleLanguageSlug,
        totalBytes: existing.totalBytes,
        posterPath: existing.posterPath,
      }
      await writeRecord({
        ...existing,
        renditionDocumentId: rendition.documentId,
        qualityLabel: rendition.quality,
        title: request.title || existing.title,
        subtitleLanguageSlug: request.subtitleLanguageSlug,
        state: "downloading",
        committedPath: null,
        pendingPath,
        bytesWritten: 0,
        totalBytes: Number(rendition.size) || 0,
        swapFrom,
      })

      const fresh = await reresolveMediaUrl({
        dubDocumentId: request.dubDocumentId,
        renditionDocumentId: rendition.documentId,
        qualityLabel: rendition.quality,
        totalBytes: Number(rendition.size) || 0,
        subtitleLanguageSlug: request.subtitleLanguageSlug,
      })

      const mediaUrl = fresh?.mediaUrl ?? rendition.url
      // Validate the CMS-sourced media URL before starting. On failure restore
      // the pre-swap record (the old copy is untouched; no pending file exists
      // yet) so the user keeps their working download.
      if (!validateActionUrl(mediaUrl)) {
        await writeRecord(existing)
        return { ok: false, reason: "error" }
      }

      // Engine start threw before producing a task — restore the pre-swap
      // record (old copy + file untouched; no pending file exists yet).
      let task: EngineTask
      try {
        task = startMediaDownload(
          {
            id: videoSlug,
            url: mediaUrl,
            destination: pendingPath,
            allowCellular: request.allowCellular,
          },
          buildHandlers({
            videoSlug,
            committedPath,
            pendingPath,
            fallbackTotalBytes: Number(rendition.size) || 0,
            subtitleLanguageSlug: request.subtitleLanguageSlug,
            subtitleUrl: fresh?.subtitleUrl ?? request.subtitleUrl,
            posterUrl: request.posterUrl,
          }),
        )
      } catch {
        await writeRecord(existing)
        return { ok: false, reason: "error" }
      }
      taskRegistry.current.set(videoSlug, task)
      return { ok: true }
    },
    [writeRecord, buildHandlers, startDownload],
  )

  // U3: in-flight controls. pause sets state directly and keeps the task handle;
  // resume continues in place or restarts if the task didn't survive (R5); cancel
  // stops + removes (R1) via deleteDownload; supersede (U4) stops WITHOUT deleting
  // so the language-switch replacement can claim the slug.
  const pauseDownload = useCallback(
    async (videoSlug: string) => {
      const current = recordsRef.current[videoSlug]
      const task = taskRegistry.current.get(videoSlug)
      if (!task || current?.state !== "downloading") return
      void writeRecord({ ...current, state: "paused" })
      try {
        await pauseTask(task)
      } catch {
        // Best-effort; the record already reflects paused.
      }
    },
    [writeRecord],
  )

  const resumeDownload = useCallback(
    async (videoSlug: string) => {
      const current = recordsRef.current[videoSlug]
      if (current?.state !== "paused") return
      const task = taskRegistry.current.get(videoSlug)
      if (task) {
        void writeRecord({ ...current, state: "downloading" })
        try {
          await resumeTask(task)
          return
        } catch {
          // Native resume failed — fall through to a clean restart.
        }
      }
      // No live task survived the pause/relaunch — restart cleanly (R5/AE4).
      await restartDownload(current)
    },
    [writeRecord, restartDownload],
  )

  const cancelDownload = useCallback(
    async (videoSlug: string) => {
      const current = recordsRef.current[videoSlug]
      const action = decideCancelAction(current)
      if (action === "ignore" || !current) return
      const task = taskRegistry.current.get(videoSlug)
      if (task) {
        taskRegistry.current.delete(videoSlug)
        try {
          await stopTask(task)
        } catch {
          // Best-effort stop.
        }
      }
      // A swap in flight reverts to the old copy (keep the previously-downloaded
      // file that shares the video dir); a fresh download is removed entirely.
      if (action === "revert" && current.swapFrom) {
        const swap = current.swapFrom
        if (current.pendingPath) await removeUri(current.pendingPath)
        void writeRecord({
          ...current,
          state: "downloaded",
          committedPath: swap.committedPath,
          renditionDocumentId: swap.renditionDocumentId,
          qualityLabel: swap.qualityLabel,
          subtitleLanguageSlug: swap.subtitleLanguageSlug,
          posterPath: swap.posterPath,
          totalBytes: swap.totalBytes,
          bytesWritten: swap.totalBytes,
          pendingPath: null,
          swapFrom: null,
        })
        return
      }
      // A fresh in-flight download → remove it entirely.
      await removeVideoDir(videoSlug)
      await removeRecord(videoSlug)
    },
    [writeRecord, removeRecord],
  )

  const supersedeDownload = useCallback(async (videoSlug: string) => {
    // U4: stop the in-flight task WITHOUT removing its record, neutralizing its
    // terminal callbacks so the language-switch replacement can reclaim the slug.
    const task = taskRegistry.current.get(videoSlug)
    if (!task) return
    taskRegistry.current.delete(videoSlug)
    try {
      await stopTask(task, { supersede: true })
    } catch {
      // Best-effort supersede stop.
    }
  }, [])

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
      startDownload,
      swapDownload,
      queueBatchRecords,
      deleteDownload,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      supersedeDownload,
    }),
    [
      records,
      isReady,
      startDownload,
      swapDownload,
      queueBatchRecords,
      deleteDownload,
      pauseDownload,
      resumeDownload,
      cancelDownload,
      supersedeDownload,
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
