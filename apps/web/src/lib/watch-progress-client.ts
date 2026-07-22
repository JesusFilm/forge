"use client"

import { useEffect, useSyncExternalStore } from "react"

const STORAGE_KEY_PREFIX = "forge.watch_progress.v1"
const ANONYMOUS_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.anonymous`
const CURRENT_USER_STORAGE_KEY = `${STORAGE_KEY_PREFIX}.current_user`
const WATCH_PROGRESS_API_PATH = "/watch/api/watch-progress"
const MIN_VISIBLE_PROGRESS = 0.01
const COMPLETE_THRESHOLD = 0.9
const WRITE_INTERVAL_MS = 2_000

export type WatchProgressEntry = {
  videoId: string
  languageSlug?: string | null
  positionSeconds: number
  durationSeconds: number
  updatedAt: number
}

type StoredProgress = Record<string, WatchProgressEntry>

type RemoteWatchProgressEntry = {
  videoId: string
  languageSlug?: string | null
  positionSeconds: number
  durationSeconds: number
  updatedAt: string
}

type AuthState = "unknown" | "authenticated" | "anonymous"

let authState: AuthState = "unknown"
let authenticatedUserId: string | null = null
let authRequest: Promise<boolean> | null = null
const listeners = new Set<() => void>()
const EMPTY_STORED_PROGRESS: StoredProgress = {}
const storedProgressCache = new Map<
  string,
  { raw: string | null; progress: StoredProgress }
>()
const EMPTY_PROGRESS_ENTRIES: WatchProgressEntry[] = []
let progressEntriesCache: {
  key: string
  progress: StoredProgress
  entries: WatchProgressEntry[]
} | null = null

function emitChange() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (typeof window !== "undefined") {
    void ensureWatchProgressAuth()
  }
  return () => {
    listeners.delete(listener)
  }
}

function subscribeDisabled(): () => void {
  return () => undefined
}

function getServerSnapshot(): WatchProgressEntry | null {
  return null
}

function getEmptyProgressEntries(): WatchProgressEntry[] {
  return EMPTY_PROGRESS_ENTRIES
}

function getAuthStateSnapshot(): AuthState {
  return authState
}

function userStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}.user.${encodeURIComponent(userId)}`
}

function activeStorageKey(): string {
  return authenticatedUserId != null
    ? userStorageKey(authenticatedUserId)
    : ANONYMOUS_STORAGE_KEY
}

function readCurrentUserId(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(CURRENT_USER_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeCurrentUserId(userId: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(CURRENT_USER_STORAGE_KEY, userId)
  } catch {
    // Non-critical cache for selecting the current user's local progress bucket.
  }
}

function historySubmissionProgress() {
  const localUserId = authenticatedUserId ?? readCurrentUserId()
  const sources = [readStoredProgress(ANONYMOUS_STORAGE_KEY)]
  if (localUserId) {
    sources.push(readStoredProgress(userStorageKey(localUserId)))
  }
  return {
    localUserId,
    progress: mergeProgress(...sources),
  }
}

function readStoredProgress(key: string): StoredProgress {
  if (typeof window === "undefined") return {}

  try {
    const raw = window.localStorage.getItem(key)
    const cached = storedProgressCache.get(key)
    if (cached && cached.raw === raw) return cached.progress

    if (!raw) {
      storedProgressCache.set(key, {
        raw,
        progress: EMPTY_STORED_PROGRESS,
      })
      return EMPTY_STORED_PROGRESS
    }
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") {
      storedProgressCache.set(key, {
        raw,
        progress: EMPTY_STORED_PROGRESS,
      })
      return EMPTY_STORED_PROGRESS
    }

    const entries = Object.entries(parsed).flatMap(([videoId, value]) => {
      if (!value || typeof value !== "object") return []
      const entry = value as Partial<WatchProgressEntry>
      if (
        entry.videoId !== videoId ||
        typeof entry.positionSeconds !== "number" ||
        typeof entry.durationSeconds !== "number" ||
        typeof entry.updatedAt !== "number"
      ) {
        return []
      }
      return [
        [
          videoId,
          {
            videoId,
            languageSlug:
              typeof entry.languageSlug === "string"
                ? entry.languageSlug
                : null,
            positionSeconds: entry.positionSeconds,
            durationSeconds: entry.durationSeconds,
            updatedAt: entry.updatedAt,
          },
        ],
      ]
    })
    const progress = Object.fromEntries(entries)
    storedProgressCache.set(key, { raw, progress })
    return progress
  } catch {
    const progress = EMPTY_STORED_PROGRESS
    storedProgressCache.set(key, {
      raw: null,
      progress,
    })
    return progress
  }
}

function writeStoredProgress(key: string, progress: StoredProgress) {
  if (typeof window === "undefined") return
  try {
    const raw = JSON.stringify(progress)
    window.localStorage.setItem(key, raw)
    storedProgressCache.set(key, { raw, progress })
  } catch {
    // Private browsing or full storage should not break playback.
  }
}

function removeStoredProgress(key: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key)
    storedProgressCache.delete(key)
  } catch {
    // Ignore localStorage failures; durable sync is best-effort here.
  }
}

function remoteToLocal(entry: RemoteWatchProgressEntry): WatchProgressEntry {
  const parsed = Date.parse(entry.updatedAt)
  return {
    videoId: entry.videoId,
    languageSlug:
      typeof entry.languageSlug === "string" ? entry.languageSlug : null,
    positionSeconds: entry.positionSeconds,
    durationSeconds: entry.durationSeconds,
    updatedAt: Number.isFinite(parsed) ? parsed : Date.now(),
  }
}

function mergeProgress(...sources: StoredProgress[]): StoredProgress {
  const merged: StoredProgress = {}
  for (const source of sources) {
    for (const entry of Object.values(source)) {
      const current = merged[entry.videoId]
      if (!current || entry.updatedAt >= current.updatedAt) {
        merged[entry.videoId] = entry
      }
    }
  }
  return merged
}

function entriesMatch(
  left: WatchProgressEntry | null | undefined,
  right: WatchProgressEntry | null | undefined,
) {
  return (
    left?.videoId === right?.videoId &&
    (left?.languageSlug ?? null) === (right?.languageSlug ?? null) &&
    left?.positionSeconds === right?.positionSeconds &&
    left?.durationSeconds === right?.durationSeconds &&
    left?.updatedAt === right?.updatedAt
  )
}

async function syncWatchProgressEntries(entries: WatchProgressEntry[]) {
  if (entries.length === 0 || authState !== "authenticated") return
  try {
    await fetch(WATCH_PROGRESS_API_PATH, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: entries.map((entry) => ({
          videoId: entry.videoId,
          languageSlug: entry.languageSlug ?? null,
          positionSeconds: entry.positionSeconds,
          durationSeconds: entry.durationSeconds,
          updatedAt: new Date(entry.updatedAt).toISOString(),
        })),
      }),
    })
  } catch {
    // Keep local progress; the next authenticated load can sync again.
  }
}

export async function ensureWatchProgressAuth(): Promise<boolean> {
  if (authState === "authenticated") return true
  if (authState === "anonymous") return false
  if (authRequest) return authRequest

  authRequest = fetch(WATCH_PROGRESS_API_PATH, {
    cache: "no-store",
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (!response.ok) return null
      const body = (await response.json()) as {
        authenticated?: unknown
        userId?: unknown
        entries?: unknown
      }
      if (body.authenticated !== true || typeof body.userId !== "string") {
        return null
      }
      const entries = Array.isArray(body.entries)
        ? body.entries.flatMap((entry): RemoteWatchProgressEntry[] =>
            entry &&
            typeof entry === "object" &&
            typeof (entry as RemoteWatchProgressEntry).videoId === "string" &&
            typeof (entry as RemoteWatchProgressEntry).positionSeconds ===
              "number" &&
            typeof (entry as RemoteWatchProgressEntry).durationSeconds ===
              "number" &&
            typeof (entry as RemoteWatchProgressEntry).updatedAt === "string"
              ? [entry as RemoteWatchProgressEntry]
              : [],
          )
        : []
      return { userId: body.userId, entries }
    })
    .catch(() => null)
    .then((result) => {
      if (!result) {
        authState = "anonymous"
        authenticatedUserId = null
        emitChange()
        return false
      }

      const key = userStorageKey(result.userId)
      const localUserProgress = readStoredProgress(key)
      const anonymousProgress = readStoredProgress(ANONYMOUS_STORAGE_KEY)
      const remoteProgress = Object.fromEntries(
        result.entries.map((entry) => [entry.videoId, remoteToLocal(entry)]),
      )
      const merged = mergeProgress(
        remoteProgress,
        localUserProgress,
        anonymousProgress,
      )

      authenticatedUserId = result.userId
      authState = "authenticated"
      writeStoredProgress(key, merged)
      writeCurrentUserId(result.userId)
      removeStoredProgress(ANONYMOUS_STORAGE_KEY)
      emitChange()
      const entriesToSync = Object.values(merged).filter(
        (entry) => !entriesMatch(entry, remoteProgress[entry.videoId]),
      )
      void syncWatchProgressEntries(entriesToSync)
      return true
    })

  return authRequest
}

export function getWatchProgress(videoId: string | null | undefined) {
  if (!videoId) return null
  return readStoredProgress(activeStorageKey())[videoId] ?? null
}

export function getWatchProgressEntries(): WatchProgressEntry[] {
  const key = activeStorageKey()
  const progress = readStoredProgress(key)
  if (
    progressEntriesCache &&
    progressEntriesCache.key === key &&
    progressEntriesCache.progress === progress
  ) {
    return progressEntriesCache.entries
  }

  const entries = Object.values(progress).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )
  progressEntriesCache = { key, progress, entries }
  return entries
}

export function getWatchProgressRatio(
  entry: WatchProgressEntry | null,
): number {
  if (!entry) return 0
  if (!Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0) {
    return 0
  }
  if (!Number.isFinite(entry.positionSeconds) || entry.positionSeconds <= 0) {
    return 0
  }
  const ratio = entry.positionSeconds / entry.durationSeconds
  if (ratio < MIN_VISIBLE_PROGRESS) return 0
  if (ratio >= COMPLETE_THRESHOLD) return 1
  return Math.min(1, Math.max(0, ratio))
}

export function saveWatchProgress({
  videoId,
  languageSlug,
  positionSeconds,
  durationSeconds,
}: {
  videoId: string
  languageSlug?: string | null
  positionSeconds: number
  durationSeconds: number
}) {
  if (!videoId) return
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return

  const key = activeStorageKey()
  const progress = readStoredProgress(key)
  const entry = {
    videoId,
    languageSlug: languageSlug || null,
    positionSeconds: Math.floor(Math.min(positionSeconds, durationSeconds)),
    durationSeconds: Math.max(1, Math.floor(durationSeconds)),
    updatedAt: Date.now(),
  }
  writeStoredProgress(key, { ...progress, [videoId]: entry })
  emitChange()
  if (authState === "authenticated") {
    void syncWatchProgressEntries([entry])
  }
}

export function useWatchProgress(videoId: string | null | undefined) {
  return useSyncExternalStore(
    subscribe,
    () => getWatchProgress(videoId),
    getServerSnapshot,
  )
}

export function useWatchProgressEntries() {
  return useWatchProgressEntriesWhen(true)
}

export function useWatchProgressEntriesWhen(enabled: boolean) {
  return useSyncExternalStore(
    enabled ? subscribe : subscribeDisabled,
    enabled ? getWatchProgressEntries : getEmptyProgressEntries,
    getEmptyProgressEntries,
  )
}

export function useWatchProgressAuthState() {
  return useSyncExternalStore(
    subscribe,
    getAuthStateSnapshot,
    () => "unknown" satisfies AuthState,
  )
}

export async function loadWatchProgressHistory<TVideo = unknown>(): Promise<{
  authenticated: boolean
  entries: WatchProgressEntry[]
  videos: TVideo[]
}> {
  const { localUserId, progress } = historySubmissionProgress()
  const submittedEntries = Object.values(progress)

  try {
    const response = await fetch(WATCH_PROGRESS_API_PATH, {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        entries: submittedEntries.map((entry) => ({
          videoId: entry.videoId,
          languageSlug: entry.languageSlug ?? null,
          positionSeconds: entry.positionSeconds,
          durationSeconds: entry.durationSeconds,
          updatedAt: new Date(entry.updatedAt).toISOString(),
        })),
        localUserId,
        includeVideos: true,
      }),
    })
    if (!response.ok) throw new Error("Failed to load watch history")

    const body = (await response.json()) as {
      authenticated?: unknown
      userId?: unknown
      entries?: unknown
      videos?: unknown
    }
    if (body.authenticated !== true || typeof body.userId !== "string") {
      authState = "anonymous"
      authenticatedUserId = null
      emitChange()
      return { authenticated: false, entries: [], videos: [] }
    }

    const remoteEntries = Array.isArray(body.entries)
      ? body.entries.flatMap((entry): RemoteWatchProgressEntry[] =>
          entry &&
          typeof entry === "object" &&
          typeof (entry as RemoteWatchProgressEntry).videoId === "string" &&
          typeof (entry as RemoteWatchProgressEntry).positionSeconds ===
            "number" &&
          typeof (entry as RemoteWatchProgressEntry).durationSeconds ===
            "number" &&
          typeof (entry as RemoteWatchProgressEntry).updatedAt === "string"
            ? [entry as RemoteWatchProgressEntry]
            : [],
        )
      : []

    const key = userStorageKey(body.userId)
    const remoteProgress = Object.fromEntries(
      remoteEntries.map((entry) => [entry.videoId, remoteToLocal(entry)]),
    )
    const merged = mergeProgress(
      remoteProgress,
      readStoredProgress(key),
      readStoredProgress(ANONYMOUS_STORAGE_KEY),
    )

    authenticatedUserId = body.userId
    authState = "authenticated"
    writeStoredProgress(key, merged)
    writeCurrentUserId(body.userId)
    removeStoredProgress(ANONYMOUS_STORAGE_KEY)
    emitChange()

    return {
      authenticated: true,
      entries: getWatchProgressEntries(),
      videos: Array.isArray(body.videos) ? (body.videos as TVideo[]) : [],
    }
  } catch {
    authState = "anonymous"
    authenticatedUserId = null
    emitChange()
    return { authenticated: false, entries: [], videos: [] }
  }
}

export function useWatchProgressRecorder({
  player,
  videoId,
  languageSlug,
  enabled = true,
}: {
  player: HTMLMediaElement | null
  videoId: string
  languageSlug?: string | null
  enabled?: boolean
}) {
  useEffect(() => {
    if (!enabled || !player || !videoId) return

    let lastWrite = 0

    const record = (force = false) => {
      const now = Date.now()
      if (!force && now - lastWrite < WRITE_INTERVAL_MS) return
      lastWrite = now
      saveWatchProgress({
        videoId,
        languageSlug,
        positionSeconds: player.currentTime,
        durationSeconds: player.duration,
      })
    }

    const onTimeUpdate = () => record(false)
    const onPause = () => record(true)
    const onEnded = () => record(true)
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") record(true)
    }

    player.addEventListener("timeupdate", onTimeUpdate)
    player.addEventListener("pause", onPause)
    player.addEventListener("ended", onEnded)
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      record(true)
      player.removeEventListener("timeupdate", onTimeUpdate)
      player.removeEventListener("pause", onPause)
      player.removeEventListener("ended", onEnded)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [enabled, languageSlug, player, videoId])
}
