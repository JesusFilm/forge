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
  startMediaDownload,
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
  moveFile,
  removeVideoDir,
} from "../lib/offlineFileSystem"
import {
  OFFLINE_INDEX_STORAGE_KEY,
  OFFLINE_MANIFEST_VERSION,
  offlineRecordKey,
  parseOfflineIndex,
  parseOfflineRecord,
  serializeOfflineIndex,
  serializeOfflineRecord,
  type OfflineDownloadRecord,
} from "../lib/offlineManifest"
import type { WatchDownload } from "../lib/normalizeVideo"
import { useWatchPreferences } from "./WatchPreferencesProvider"

/**
 * App-wide offline-downloads state. Mounted at the root layout (not the watch
 * route) so the green-tick badge on detail pages and the My Downloads surface —
 * both outside the watch route group — can read it.
 *
 * Hydrates the sharded manifest (bulletproof tolerant parse), exposes the read
 * surface (committedFor/getRecord) plus startDownload/deleteDownload, configures
 * the native engine, and runs a defensive launch reattach. The actual transfer +
 * background behavior is verified on a device; this code wires the flow.
 */
export type StartDownloadRequest = {
  videoSlug: string
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

type DownloadsContextValue = {
  /** False until the persisted manifest has been read. */
  isReady: boolean
  /** The record for a video, or null if it has no offline copy/queue entry. */
  getRecord: (videoSlug: string) => OfflineDownloadRecord | null
  /** Committed, playable local media path for a downloaded video, else null. */
  committedFor: (videoSlug: string) => string | null
  /** Slugs with a usable (downloaded) offline copy. */
  downloadedSlugs: string[]
  /** Enqueue an offline download (one copy per video). */
  startDownload: (request: StartDownloadRequest) => Promise<void>
  /** Remove an offline copy: its files and its manifest entry. */
  deleteDownload: (videoSlug: string) => Promise<void>
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null)

type RecordMap = Record<string, OfflineDownloadRecord>

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<RecordMap>({})
  const [isReady, setIsReady] = useState(false)

  const recordsRef = useRef(records)
  recordsRef.current = records

  const { wifiOnly } = useWatchPreferences()

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
    const next = { ...recordsRef.current, [record.videoSlug]: record }
    recordsRef.current = next
    setRecords(next)
    try {
      await AsyncStorage.setItem(
        offlineRecordKey(record.videoSlug),
        serializeOfflineRecord(record),
      )
      await AsyncStorage.setItem(
        OFFLINE_INDEX_STORAGE_KEY,
        serializeOfflineIndex(Object.keys(next)),
      )
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
      await removeVideoDir(videoSlug)
      await removeRecord(videoSlug)
    },
    [removeRecord],
  )

  // Defensive launch reattach: reconcile records against live native tasks and
  // on-disk files, applying the manifest-safe action now. Restarting interrupted
  // transfers (rebind/requeue/repair) is a follow-up on the queue.
  useEffect(() => {
    if (!isReady) return
    let cancelled = false
    void (async () => {
      try {
        const tasks = await listExistingDownloadTasks().catch(() => [])
        const liveTaskSlugs = new Set(tasks.map((task) => task.id))
        const current = Object.values(recordsRef.current)
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
        for (const action of actions) {
          if (cancelled) return
          if (action.action === "dropRecord")
            await removeRecord(action.videoSlug)
        }
      } catch {
        // Reattach is best-effort and must never break boot.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isReady, removeRecord])

  const startDownload = useCallback(
    async (request: StartDownloadRequest) => {
      const { videoSlug, rendition } = request
      const existing = recordsRef.current[videoSlug]
      // One copy per video: ignore if a live copy/queue entry already exists.
      if (
        existing &&
        existing.state !== "failed" &&
        existing.state !== "canceled"
      ) {
        return
      }

      try {
        configureDownloadEngine({ wifiOnly })
        await ensureVideoDir(videoSlug)
      } catch {
        return
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
        subtitleLanguageSlug: request.subtitleLanguageSlug,
        state: "downloading",
        committedPath: null,
        pendingPath,
        posterPath: null,
        bytesWritten: 0,
        totalBytes: Number(rendition.size) || 0,
      })

      const patch = (fields: Partial<OfflineDownloadRecord>) => {
        const current = recordsRef.current[videoSlug]
        if (!current) return
        void writeRecord({ ...current, ...fields })
      }

      const finalize = async (location: string) => {
        try {
          await moveFile(location, committedPath)
          let subtitleVerified = false
          let subtitleTerminallyFailed = false
          if (request.subtitleLanguageSlug && request.subtitleUrl) {
            try {
              await downloadToFile(
                request.subtitleUrl,
                buildSubtitlePath(
                  OFFLINE_ROOT,
                  videoSlug,
                  request.subtitleLanguageSlug,
                ),
              )
              subtitleVerified = true
            } catch {
              subtitleTerminallyFailed = true
            }
          }
          let posterPath: string | null = null
          if (request.posterUrl) {
            const target = buildPosterPath(OFFLINE_ROOT, videoSlug)
            try {
              await downloadToFile(request.posterUrl, target)
              posterPath = target
            } catch {
              posterPath = null
            }
          }
          const bundle = resolveBundle({
            mediaVerified: true,
            subtitleRequested: request.subtitleLanguageSlug != null,
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
                : request.subtitleLanguageSlug,
            })
          } else {
            patch({ state: "failed" })
          }
        } catch {
          patch({ state: "failed" })
        }
      }

      startMediaDownload(
        {
          id: videoSlug,
          url: rendition.url,
          destination: pendingPath,
          allowCellular: request.allowCellular,
        },
        {
          onProgress: ({ bytesDownloaded, bytesTotal }) =>
            patch({
              bytesWritten: bytesDownloaded,
              totalBytes: bytesTotal || Number(rendition.size) || 0,
            }),
          onDone: ({ location }) => {
            void finalize(location)
          },
          onInterruption: (classification) => {
            if (classification.state === "canceled") {
              void deleteDownload(videoSlug)
            } else {
              patch({ state: classification.state })
            }
          },
        },
      )
    },
    [wifiOnly, writeRecord, deleteDownload],
  )

  const value = useMemo<DownloadsContextValue>(
    () => ({
      isReady,
      getRecord: (videoSlug) => records[videoSlug] ?? null,
      committedFor: (videoSlug) => {
        const record = records[videoSlug]
        return record && record.state === "downloaded" && record.committedPath
          ? record.committedPath
          : null
      },
      downloadedSlugs: Object.values(records)
        .filter((record) => record.state === "downloaded")
        .map((record) => record.videoSlug),
      startDownload,
      deleteDownload,
    }),
    [records, isReady, startDownload, deleteDownload],
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
