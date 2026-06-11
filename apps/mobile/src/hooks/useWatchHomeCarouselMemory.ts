import { useCallback, useEffect, useRef, useState } from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import type { WatchHomeSlide } from "../lib/watchHome/carouselSequence"
import {
  WATCH_HOME_CAROUSEL_SESSION_STORAGE_KEY,
  WATCH_HOME_PLAYED_IDS_STORAGE_KEY,
  type WatchHomeCarouselSession,
  currentStorageMonth,
  parseStoredCarouselSession,
  parseStoredPlayedIds,
  serializeCarouselSession,
  serializePlayedIds,
} from "../lib/watchHomePersistence"

export type WatchHomeCarouselMemory = {
  /**
   * Caller-held played set the queue builders take as input. Mutable ref —
   * the queue reads it at build time; markVideoPlayed/resetPlayedIds mutate it.
   */
  playedIdsRef: React.RefObject<Set<string>>
  /** Pool-rotation position queue rebuilds resume from (web's session resume). */
  startPoolIndexRef: React.RefObject<number>
  /**
   * Flips true once persisted state is merged into the refs (or loading
   * failed and the empty defaults stand). Include in queue-build memo deps so
   * the first hydrated build excludes already-played slides.
   */
  hydrated: boolean
  /** Persist a video slide id as played (mux insert ids are never persisted). */
  markVideoPlayed: (id: string) => void
  /** Wrap reset: every eligible slide was played — clear memory + storage. */
  resetPlayedIds: () => void
  /** Record the active video slide as the resume point for future rebuilds. */
  persistActiveSlide: (slide: WatchHomeSlide) => void
}

/**
 * Cross-restart memory for the Home hero carousel — the AsyncStorage-backed
 * replacement for web's browser-storage layer (closes KTD-3):
 *
 *   - played ids exclude already-seen videos from queue rebuilds, reset
 *     monthly (web's localStorage carousel-played-ids rule)
 *   - the active slide's pool position is the resume point for the next
 *     launch's queue build, expired after 24h (web's session resume rule)
 *
 * The pure sequencing module stays storage-free: it takes `playedIds` and
 * `startPoolIndex` as caller-held inputs, and this hook is the Home screen's
 * owner of those inputs. Storage failures degrade to empty state — the
 * carousel still rotates, it just repeats sooner.
 */
export function useWatchHomeCarouselMemory(): WatchHomeCarouselMemory {
  const playedIdsRef = useRef<Set<string>>(new Set())
  const startPoolIndexRef = useRef(0)
  // The month the in-memory set belongs to. Checked at write time so a session
  // running across a month boundary drops the old month's ids on the next
  // mark, mirroring web's read-then-write month reset in addWatchHomeTvPlayedId.
  const monthRef = useRef(currentStorageMonth(new Date()))
  const [hydrated, setHydrated] = useState(false)
  // Write-time mirror of `hydrated` for the stable callbacks below.
  const hydratedRef = useRef(false)
  // Pre-hydration buffers. A write that fires before the disk state is merged
  // must not touch storage: the played blob would be clobbered with a subset
  // of itself, and the stored session would later regress a fresher
  // in-session position. Buffer, then flush once hydration lands.
  const pendingPlayedFlushRef = useRef(false)
  const pendingSessionRef = useRef<WatchHomeCarouselSession | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const now = new Date()
        const [rawIds, rawSession] = await Promise.all([
          AsyncStorage.getItem(WATCH_HOME_PLAYED_IDS_STORAGE_KEY),
          AsyncStorage.getItem(WATCH_HOME_CAROUSEL_SESSION_STORAGE_KEY),
        ])
        if (cancelled) return
        monthRef.current = currentStorageMonth(now)
        // Merge INTO the ref: slides marked before hydration resolved stay.
        for (const id of parseStoredPlayedIds(rawIds, now)) {
          playedIdsRef.current.add(id)
        }
        const session = parseStoredCarouselSession(rawSession, now)
        // A pre-hydration persistActiveSlide holds a fresher in-session
        // position — the stored one must not regress it.
        if (session != null && pendingSessionRef.current == null) {
          startPoolIndexRef.current = session.poolIndex
        }
      } catch {
        // Unreadable storage: hydrate to the empty defaults.
      }
      if (cancelled) return
      hydratedRef.current = true
      if (pendingPlayedFlushRef.current) {
        pendingPlayedFlushRef.current = false
        AsyncStorage.setItem(
          WATCH_HOME_PLAYED_IDS_STORAGE_KEY,
          serializePlayedIds(playedIdsRef.current, new Date()),
        ).catch(() => {})
      }
      if (pendingSessionRef.current != null) {
        const pending = pendingSessionRef.current
        pendingSessionRef.current = null
        AsyncStorage.setItem(
          WATCH_HOME_CAROUSEL_SESSION_STORAGE_KEY,
          serializeCarouselSession(pending),
        ).catch(() => {})
      }
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const markVideoPlayed = useCallback((id: string) => {
    const now = new Date()
    const month = currentStorageMonth(now)
    if (month !== monthRef.current) {
      monthRef.current = month
      playedIdsRef.current = new Set()
    }
    if (playedIdsRef.current.has(id)) return
    playedIdsRef.current.add(id)
    if (!hydratedRef.current) {
      // Storage still holds ids this in-memory set lacks; writing now would
      // shrink the blob. Flushed by the hydration effect.
      pendingPlayedFlushRef.current = true
      return
    }
    AsyncStorage.setItem(
      WATCH_HOME_PLAYED_IDS_STORAGE_KEY,
      serializePlayedIds(playedIdsRef.current, now),
    ).catch(() => {
      // Write failures lose persistence, not the in-memory session.
    })
  }, [])

  const resetPlayedIds = useCallback(() => {
    playedIdsRef.current = new Set()
    AsyncStorage.removeItem(WATCH_HOME_PLAYED_IDS_STORAGE_KEY).catch(() => {
      // A surviving stale blob is self-correcting: it wraps again next launch.
    })
  }, [])

  const persistActiveSlide = useCallback((slide: WatchHomeSlide) => {
    if (slide.kind !== "video" || slide.poolIndex == null) return
    startPoolIndexRef.current = slide.poolIndex
    const session: WatchHomeCarouselSession = {
      videoId: slide.id,
      poolIndex: slide.poolIndex,
      timestamp: Date.now(),
    }
    if (!hydratedRef.current) {
      // Buffered write; also signals hydration not to regress
      // startPoolIndexRef with the stored (older) position.
      pendingSessionRef.current = session
      return
    }
    AsyncStorage.setItem(
      WATCH_HOME_CAROUSEL_SESSION_STORAGE_KEY,
      serializeCarouselSession(session),
    ).catch(() => {
      // Write failures lose persistence, not the in-memory session.
    })
  }, [])

  return {
    playedIdsRef,
    startPoolIndexRef,
    hydrated,
    markVideoPlayed,
    resetPlayedIds,
    persistActiveSlide,
  }
}
