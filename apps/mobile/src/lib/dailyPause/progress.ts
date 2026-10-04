// The day record (KTD11, KTD12, R2, R5-R7) holds one local day. A record for
// another day reads as empty, so Resume never crosses days. Each action takes
// the day key, because a run pins its day at Begin or Resume.
import { useMemo, useSyncExternalStore } from "react"

import {
  createPersistedRecordStore,
  type RecordSnapshot,
  type RecordStatus,
  type RecordStorage,
} from "../bible/position/persistedRecordStore"

export const PAUSE_DAY_STORAGE_KEY = "daily-pause-day"

/** Increase this when the stored shape changes. */
export const PAUSE_DAY_VERSION = 1

/** The bell and the Opening wait this long for the record, then read it as
 *  an empty day. */
export const PAUSE_DAY_HYDRATE_TIMEOUT_MS = 1000

/** R10: the steps of a run, in order. `film`, `teaching`, and `prayer` are the
 *  video parts; the teaching part ends on the verse. */
export const PAUSE_STEPS = [
  "opening",
  "watchScreen",
  "film",
  "teaching",
  "reflectScreen",
  "prayer",
  "prayScreen",
  "share",
] as const

export type PauseStep = (typeof PAUSE_STEPS)[number]

export type PauseDayRecord = {
  /** The local day this record describes; null before the first write. */
  dayKey: string | null
  /** The step that the run reached. */
  step: PauseStep | null
  /** R7: the run reached Share. */
  done: boolean
  /** R2: the day's devotional was opened, so the bell's dot is clear. */
  bellRead: boolean
}

/** The record as one day reads it. */
export type PauseDay = Omit<PauseDayRecord, "dayKey">

export type PauseDayView = PauseDay & { status: RecordStatus }

const EMPTY_RECORD: PauseDayRecord = Object.freeze({
  dayKey: null,
  step: null,
  done: false,
  bellRead: false,
})

function isPauseStep(value: unknown): value is PauseStep {
  return (PAUSE_STEPS as readonly unknown[]).includes(value)
}

/** The day's progress; a record for another day reads as an empty day. */
export function dayFromRecord(
  record: PauseDayRecord,
  dayKey: string,
): PauseDay {
  if (record.dayKey !== dayKey) {
    return { step: null, done: false, bellRead: false }
  }
  return { step: record.step, done: record.done, bellRead: record.bellRead }
}

/** R5, R6: the step that Resume starts, or null. The Opening and Share are
 *  never a Resume target, so a done day offers Begin again. */
export function resumeTarget(day: PauseDay): PauseStep | null {
  if (day.step === null || day.step === "opening" || day.step === "share") {
    return null
  }
  return day.step
}

/** Null for no record: unwritten, bad JSON, another version, or no day key.
 *  Another field that does not read keeps its empty value. */
export function parseStoredPauseDay(raw: string | null): PauseDayRecord | null {
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
  const stored = data as Record<string, unknown>
  if (stored.version !== PAUSE_DAY_VERSION) return null
  // The other fields belong to that day, so without the day they mean nothing.
  if (typeof stored.dayKey !== "string") return null
  return {
    dayKey: stored.dayKey,
    step: isPauseStep(stored.step) ? stored.step : null,
    done: stored.done === true,
    bellRead: stored.bellRead === true,
  }
}

/** Null skips the save: a record with no day holds nothing to keep. */
export function serializePauseDay(record: PauseDayRecord): string | null {
  if (record.dayKey == null) return null
  return JSON.stringify({ version: PAUSE_DAY_VERSION, ...record })
}

export type PauseProgressStore = {
  getSnapshot(): RecordSnapshot<PauseDayRecord>
  /** Also starts the read of the saved record, once. */
  subscribe(listener: () => void): () => void
  /** Never rejects. */
  hydrate(): Promise<void>
  /** R2: opening the day's devotional from any entry point reads the bell. */
  markBellRead(dayKey: string): void
  /** R6: the step to resume from. */
  recordStep(dayKey: string, step: PauseStep): void
  /** R7: the run reached Share. */
  markDone(dayKey: string): void
  /** Clears the saved step. The day stays done and the bell stays read. */
  startOver(dayKey: string): void
  reset(): void
}

export function createPauseProgressStore(
  storage: RecordStorage,
): PauseProgressStore {
  const record = createPersistedRecordStore<PauseDayRecord>({
    storageKey: PAUSE_DAY_STORAGE_KEY,
    defaults: EMPTY_RECORD,
    parse: parseStoredPauseDay,
    serialize: serializePauseDay,
    hydrateTimeoutMs: PAUSE_DAY_HYDRATE_TIMEOUT_MS,
    storage,
  })

  // The fields hold one day together, so a write before the read would mix
  // days field by field. Each action therefore waits for the read.
  function writeDay(dayKey: string, change: Partial<PauseDay>) {
    const apply = () => {
      const day = dayFromRecord(record.getSnapshot(), dayKey)
      record.update({ dayKey, ...day, ...change })
    }
    if (record.getSnapshot().status === "ready") apply()
    else void record.hydrate().then(apply)
  }

  return {
    getSnapshot: record.getSnapshot,
    subscribe: record.subscribe,
    hydrate: record.hydrate,
    markBellRead: (dayKey) => writeDay(dayKey, { bellRead: true }),
    recordStep: (dayKey, step) => writeDay(dayKey, { step }),
    markDone: (dayKey) => writeDay(dayKey, { done: true }),
    startOver: (dayKey) => writeDay(dayKey, { step: null }),
    reset: record.reset,
  }
}

let store: PauseProgressStore | null = null

/* eslint-disable @typescript-eslint/no-require-imports */
/** AsyncStorage loads at each call. The bell's suites render this store with
 *  no AsyncStorage mock, and there a failed load keeps the record in memory. */
function loadAsyncStorage(): RecordStorage {
  return (
    require("@react-native-async-storage/async-storage") as {
      default: RecordStorage
    }
  ).default
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** The app's one day record. The first call does no storage work. */
export function getPauseProgressStore(): PauseProgressStore {
  store ??= createPauseProgressStore({
    getItem: (key) => loadAsyncStorage().getItem(key),
    setItem: (key, value) => loadAsyncStorage().setItem(key, value),
  })
  return store
}

/** Test-only: drop the singleton, like a relaunch that keeps the storage. */
export function resetPauseProgressStoreForTests(): void {
  store = null
}

/** One day's progress, with the read status of the record. */
export function usePauseDay(
  dayKey: string,
  from: PauseProgressStore = getPauseProgressStore(),
): PauseDayView {
  const snapshot = useSyncExternalStore(
    from.subscribe,
    from.getSnapshot,
    from.getSnapshot,
  )
  return useMemo(
    () => ({ status: snapshot.status, ...dayFromRecord(snapshot, dayKey) }),
    [snapshot, dayKey],
  )
}
