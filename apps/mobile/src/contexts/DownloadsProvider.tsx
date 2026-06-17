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
} from "../lib/downloadEngine"
import {
  OFFLINE_INDEX_STORAGE_KEY,
  offlineRecordKey,
  parseOfflineIndex,
  parseOfflineRecord,
  serializeOfflineIndex,
  type OfflineDownloadRecord,
} from "../lib/offlineManifest"
import { fileExists, removeVideoDir } from "../lib/offlineFileSystem"
import { reconcile } from "../lib/downloadReconciliation"
import { useWatchPreferences } from "./WatchPreferencesProvider"

/**
 * App-wide offline-downloads state. Mounted at the root layout (not the watch
 * route) so the green-tick badge on detail pages and the My Downloads surface —
 * both outside the watch route group — can read it.
 *
 * This is the state + lifecycle backbone: it hydrates the sharded manifest,
 * exposes the read surface the badge/library need, configures the native engine,
 * and runs a defensive launch reattach. The add-download pipeline (queue, sidecar
 * transfers, atomic commit) is wired with the download sheet and verified on a
 * device. Hydration is bulletproof (tolerant parse, try/catch) so a corrupt blob
 * can never wedge app boot.
 */
type DownloadsContextValue = {
  /** False until the persisted manifest has been read. */
  isReady: boolean
  /** The record for a video, or null if it has no offline copy/queue entry. */
  getRecord: (videoSlug: string) => OfflineDownloadRecord | null
  /** Committed, playable local media path for a downloaded video, else null. */
  committedFor: (videoSlug: string) => string | null
  /** Slugs with a usable (downloaded) offline copy. */
  downloadedSlugs: string[]
  /** Remove an offline copy: its files and its manifest entry. */
  deleteDownload: (videoSlug: string) => Promise<void>
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null)

type RecordMap = Record<string, OfflineDownloadRecord>

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<RecordMap>({})
  const [isReady, setIsReady] = useState(false)

  // Latest snapshot so stable setters can mutate without taking `records` as a
  // dependency (which would re-create them every change).
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
      // Engine unavailable (e.g. a build without the native module) — the read
      // surface still works; downloads are inert until a proper dev build.
    }
  }, [isReady, wifiOnly])

  // Defensive launch reattach: reconcile records against live native tasks and
  // on-disk files, and apply the safe manifest-only actions now. Restarting
  // interrupted transfers (rebind/requeue/repair) belongs to the download
  // pipeline and lands with the download sheet.
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
          // Only the manifest-safe action runs in the backbone; the rest need
          // the (device-verified) download pipeline.
          if (action.action === "dropRecord") {
            await removeRecord(action.videoSlug)
          }
        }
      } catch {
        // Reattach is best-effort and must never break boot.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isReady, removeRecord])

  const deleteDownload = useCallback(
    async (videoSlug: string) => {
      await removeVideoDir(videoSlug)
      await removeRecord(videoSlug)
    },
    [removeRecord],
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
      deleteDownload,
    }),
    [records, isReady, deleteDownload],
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
