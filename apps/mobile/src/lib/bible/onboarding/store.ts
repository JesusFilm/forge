// The reader's two teaching flags (feat-551 R15, R16, KD18): the swipe hint
// retires after the first verse move, and the swipe demo plays once per
// install. It shares the position store's read, merge, and save rules.
import AsyncStorage from "@react-native-async-storage/async-storage"
import { useSyncExternalStore } from "react"

import {
  createPersistedRecordStore,
  type RecordSnapshot,
  type RecordStorage,
} from "../position/persistedRecordStore"

export const READER_ONBOARDING_STORAGE_KEY = "bible-reader-onboarding"

/** Increase this when the stored shape changes, so old records read as absent. */
export const READER_ONBOARDING_VERSION = 1

/** The reader waits this long for the flags, then uses the defaults. */
export const READER_ONBOARDING_HYDRATE_TIMEOUT_MS = 1000

export type ReaderOnboarding = {
  /** True after the first verse move (R15). */
  hintRetired: boolean
  /** True after the swipe demo played or the viewer skipped it (R16). */
  demoPlayed: boolean
}

export type ReaderOnboardingSnapshot = RecordSnapshot<ReaderOnboarding>

export type ReaderOnboardingStore = {
  getSnapshot(): ReaderOnboardingSnapshot
  /** Also starts the read of the saved flags, once. */
  subscribe(listener: () => void): () => void
  /** Never rejects. A failed read keeps the defaults. */
  hydrate(): Promise<void>
  retireHint(): void
  markDemoPlayed(): void
  reset(): void
}

const DEFAULTS: ReaderOnboarding = { hintRetired: false, demoPlayed: false }

/** Null for no record. A field that does not read keeps its default. */
export function parseStoredReaderOnboarding(
  raw: string | null,
): ReaderOnboarding | null {
  if (raw == null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null
  }
  const record = data as Record<string, unknown>
  if (record.version !== READER_ONBOARDING_VERSION) return null
  const flag = (value: unknown) => (typeof value === "boolean" ? value : false)
  return {
    hintRetired: flag(record.hintRetired),
    demoPlayed: flag(record.demoPlayed),
  }
}

export function serializeReaderOnboarding(value: ReaderOnboarding): string {
  return JSON.stringify({
    version: READER_ONBOARDING_VERSION,
    hintRetired: value.hintRetired,
    demoPlayed: value.demoPlayed,
  })
}

export function createReaderOnboardingStore(
  storage: RecordStorage,
): ReaderOnboardingStore {
  const record = createPersistedRecordStore<ReaderOnboarding>({
    storageKey: READER_ONBOARDING_STORAGE_KEY,
    defaults: DEFAULTS,
    parse: parseStoredReaderOnboarding,
    serialize: serializeReaderOnboarding,
    hydrateTimeoutMs: READER_ONBOARDING_HYDRATE_TIMEOUT_MS,
    storage,
  })
  return {
    getSnapshot: record.getSnapshot,
    subscribe: record.subscribe,
    hydrate: record.hydrate,
    retireHint: () => record.update({ hintRetired: true }),
    markDemoPlayed: () => record.update({ demoPlayed: true }),
    reset: record.reset,
  }
}

let store: ReaderOnboardingStore | null = null

/** The app's one onboarding store. The first call does no storage work. */
export function getReaderOnboardingStore(): ReaderOnboardingStore {
  store ??= createReaderOnboardingStore({
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
  })
  return store
}

/** Test-only: drop the singleton so a suite builds a fresh one. */
export function resetReaderOnboardingStoreForTests(): void {
  store = null
}

export function useReaderOnboarding(
  from: ReaderOnboardingStore = getReaderOnboardingStore(),
): ReaderOnboardingSnapshot {
  return useSyncExternalStore(
    from.subscribe,
    from.getSnapshot,
    from.getSnapshot,
  )
}
