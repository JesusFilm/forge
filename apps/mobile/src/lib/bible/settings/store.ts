// The reader settings store (feat-553 KTD5, R33): one record for both reader
// hosts and the settings sheet. It shares the position store's read, merge,
// and save rules (persistedRecordStore.ts).
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useSyncExternalStore } from "react"

import {
  createPersistedRecordStore,
  type RecordSnapshot,
  type RecordStorage,
} from "../position/persistedRecordStore"
import {
  DEFAULT_READER_SETTINGS,
  READER_SETTINGS_STORAGE_KEY,
  READER_SETTING_CHECKS,
  parseStoredReaderSettings,
  serializeReaderSettings,
  type ReaderSettings,
} from "./snapshot"

/** The reader waits this long for the settings, then uses the defaults. */
export const READER_SETTINGS_HYDRATE_TIMEOUT_MS = 1000

export type ReaderSettingsSnapshot = RecordSnapshot<ReaderSettings>

export type ReaderSettingsStore = {
  getSnapshot(): ReaderSettingsSnapshot
  /** Also starts the read of the saved settings, once. */
  subscribe(listener: () => void): () => void
  /** Never rejects. A failed read keeps the defaults and a later call retries. */
  hydrate(): Promise<void>
  /** Sets the valid fields and drops the rest. False when none was valid. */
  update(patch: Partial<ReaderSettings>): boolean
  reset(): void
}

function validFields(patch: Partial<ReaderSettings>): Partial<ReaderSettings> {
  const valid: Partial<Record<keyof ReaderSettings, unknown>> = {}
  for (const key of Object.keys(
    READER_SETTING_CHECKS,
  ) as (keyof ReaderSettings)[]) {
    const value: unknown = patch[key]
    if (value !== undefined && READER_SETTING_CHECKS[key](value)) {
      valid[key] = value
    }
  }
  return valid as Partial<ReaderSettings>
}

export function createReaderSettingsStore(
  storage: RecordStorage,
): ReaderSettingsStore {
  const record = createPersistedRecordStore<ReaderSettings>({
    storageKey: READER_SETTINGS_STORAGE_KEY,
    defaults: DEFAULT_READER_SETTINGS,
    parse: parseStoredReaderSettings,
    serialize: serializeReaderSettings,
    hydrateTimeoutMs: READER_SETTINGS_HYDRATE_TIMEOUT_MS,
    storage,
  })

  return {
    getSnapshot: record.getSnapshot,
    subscribe: record.subscribe,
    hydrate: record.hydrate,
    update(patch) {
      const valid = validFields(patch)
      if (Object.keys(valid).length === 0) return false
      record.update(valid)
      return true
    },
    reset: record.reset,
  }
}

let store: ReaderSettingsStore | null = null

/** The app's one settings store. The first call does no storage work. */
export function getReaderSettingsStore(): ReaderSettingsStore {
  store ??= createReaderSettingsStore({
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
  })
  return store
}

/** Test-only: drop the singleton so a suite builds a fresh one. */
export function resetReaderSettingsStoreForTests(): void {
  store = null
}

export function useReaderSettings(
  from: ReaderSettingsStore = getReaderSettingsStore(),
): ReaderSettingsSnapshot {
  return useSyncExternalStore(
    from.subscribe,
    from.getSnapshot,
    from.getSnapshot,
  )
}
