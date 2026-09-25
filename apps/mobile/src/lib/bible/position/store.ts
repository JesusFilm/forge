// The reading position store (feat-551 KTD5, R4, R41): one position for the
// Bible tab and the pushed reader. Memory is the authority; see
// persistedRecordStore.ts for the read, merge, and save rules.
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useSyncExternalStore } from "react"

import type { VerseRef } from "../versification/convert"
import {
  createPersistedRecordStore,
  type RecordSnapshot,
  type RecordStorage,
} from "./persistedRecordStore"
import {
  DEFAULT_READING_REF,
  READING_POSITION_STORAGE_KEY,
  isBsbVerseRef,
  isStorableTranslationId,
  parseStoredReadingPosition,
  serializeReadingPosition,
  type StoredReadingPosition,
} from "./snapshot"

/** A reader waits this long for the saved position, then opens John 3:16. */
export const READING_POSITION_HYDRATE_TIMEOUT_MS = 1000

export type ReadingPosition = StoredReadingPosition & {
  /** The R31 switch. It lives in memory only and ends with the session. */
  sessionTranslationId: string | null
}

export type ReadingPositionSnapshot = RecordSnapshot<ReadingPosition>

export type ReadingPositionStore = {
  getSnapshot(): ReadingPositionSnapshot
  /** Also starts the read of the saved position, once. */
  subscribe(listener: () => void): () => void
  /** Never rejects. A failed read opens John 3:16 and a later call retries. */
  hydrate(): Promise<void>
  /** Saves a move in BSB numbering (R38). False for a verse BSB lacks. */
  moveTo(ref: VerseRef): boolean
  /** The viewer's pick from the translation picker; null follows the default. */
  pickTranslation(translationId: string | null): boolean
  /** R31's switch for this session only; it never reaches storage. */
  switchTranslationForSession(translationId: string | null): boolean
  reset(): void
}

const DEFAULTS: ReadingPosition = {
  ref: null,
  translationId: null,
  sessionTranslationId: null,
}

function isIdOrNull(value: string | null): boolean {
  return value === null || isStorableTranslationId(value)
}

export function createReadingPositionStore(
  storage: RecordStorage,
): ReadingPositionStore {
  const record = createPersistedRecordStore<ReadingPosition>({
    storageKey: READING_POSITION_STORAGE_KEY,
    defaults: DEFAULTS,
    parse: (raw) => {
      const stored = parseStoredReadingPosition(raw)
      return stored && { ...stored, sessionTranslationId: null }
    },
    serialize: ({ ref, translationId }) =>
      serializeReadingPosition({ ref, translationId }),
    hydrateTimeoutMs: READING_POSITION_HYDRATE_TIMEOUT_MS,
    storage,
  })

  return {
    getSnapshot: record.getSnapshot,
    subscribe: record.subscribe,
    hydrate: record.hydrate,
    moveTo(ref) {
      if (!isBsbVerseRef(ref)) return false
      const { book, chapter, verse } = ref
      record.update({ ref: { book, chapter, verse } })
      return true
    },
    pickTranslation(translationId) {
      if (!isIdOrNull(translationId)) return false
      record.update({ translationId, sessionTranslationId: null })
      return true
    },
    switchTranslationForSession(translationId) {
      if (!isIdOrNull(translationId)) return false
      record.update({ sessionTranslationId: translationId })
      return true
    },
    reset: record.reset,
  }
}

/**
 * The reference a reader opens at, or null while it should wait. Before the
 * read settles, only a live move (a quote, AE15) gives a reference.
 */
export function readerStartRef(
  snapshot: ReadingPositionSnapshot,
): VerseRef | null {
  if (snapshot.ref) return snapshot.ref
  return snapshot.status === "ready" ? DEFAULT_READING_REF : null
}

let store: ReadingPositionStore | null = null

/** The app's one position store. The first call does no storage work. */
export function getReadingPositionStore(): ReadingPositionStore {
  store ??= createReadingPositionStore({
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
  })
  return store
}

/** Test-only: drop the singleton so a suite builds a fresh one. */
export function resetReadingPositionStoreForTests(): void {
  store = null
}

/** Both reader hosts read the same position (KD2). */
export function useReadingPosition(
  from: ReadingPositionStore = getReadingPositionStore(),
): ReadingPositionSnapshot {
  return useSyncExternalStore(
    from.subscribe,
    from.getSnapshot,
    from.getSnapshot,
  )
}
