// The Daily Bible Pause settings (KTD12, R28-R30, R32, R47): one versioned
// AsyncStorage record. It uses the record store of the Bible reader, so a
// change applies in memory at once and the save follows.
import { useSyncExternalStore } from "react"

import {
  createPersistedRecordStore,
  type RecordSnapshot,
  type RecordStorage,
} from "../bible/position/persistedRecordStore"

export const PAUSE_SETTINGS_STORAGE_KEY = "daily-pause-settings"

/** Increase this when the stored shape changes. */
export const PAUSE_SETTINGS_VERSION = 1

/** The run waits this long for the settings, then uses the defaults. */
export const PAUSE_SETTINGS_HYDRATE_TIMEOUT_MS = 1000

export const MEDITATION_LENGTHS = [1, 3, 5] as const

/** Minutes. */
export type MeditationLength = (typeof MEDITATION_LENGTHS)[number]

export type PauseTimers = { reflectSec: number; praySec: number }

/** R30: the Reflect timer and the Pray ring for each Meditation length. */
export const PAUSE_TIMERS: Readonly<Record<MeditationLength, PauseTimers>> = {
  1: { reflectSec: 20, praySec: 15 },
  3: { reflectSec: 45, praySec: 30 },
  5: { reflectSec: 90, praySec: 60 },
}

/** A local wall-clock time, 24-hour. */
export type ReminderTime = { hour: number; minute: number }

export type PauseSettings = {
  meditationLength: MeditationLength
  /** The Notifications switch. */
  reminderOn: boolean
  reminderTime: ReminderTime
  widgetOn: boolean
}

/** R30, R32, R47: 3 min, Notifications off at 7:00 AM, and the widget off. */
export const DEFAULT_PAUSE_SETTINGS: Readonly<PauseSettings> = Object.freeze({
  meditationLength: 3,
  reminderOn: false,
  reminderTime: Object.freeze({ hour: 7, minute: 0 }),
  widgetOn: false,
})

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isMeditationLength(value: unknown): value is MeditationLength {
  return (MEDITATION_LENGTHS as readonly unknown[]).includes(value)
}

function isWholeIn(value: unknown, max: number): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= max
  )
}

function isReminderTime(value: unknown): value is ReminderTime {
  return (
    isPlainObject(value) &&
    isWholeIn(value.hour, 23) &&
    isWholeIn(value.minute, 59)
  )
}

/** Null for no record: unwritten, bad JSON, or another version. A field that
 *  does not read keeps its default, so one bad field never resets the rest. */
export function parseStoredPauseSettings(
  raw: string | null,
): PauseSettings | null {
  if (raw == null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(data) || data.version !== PAUSE_SETTINGS_VERSION) {
    return null
  }
  const defaults = DEFAULT_PAUSE_SETTINGS
  return {
    meditationLength: isMeditationLength(data.meditationLength)
      ? data.meditationLength
      : defaults.meditationLength,
    reminderOn:
      typeof data.reminderOn === "boolean"
        ? data.reminderOn
        : defaults.reminderOn,
    reminderTime: isReminderTime(data.reminderTime)
      ? { hour: data.reminderTime.hour, minute: data.reminderTime.minute }
      : defaults.reminderTime,
    widgetOn:
      typeof data.widgetOn === "boolean" ? data.widgetOn : defaults.widgetOn,
  }
}

export function serializePauseSettings(settings: PauseSettings): string {
  return JSON.stringify({ version: PAUSE_SETTINGS_VERSION, ...settings })
}

export type PauseSettingsSnapshot = RecordSnapshot<PauseSettings>

export type PauseSettingsStore = {
  getSnapshot(): PauseSettingsSnapshot
  /** Also starts the read of the saved settings, once. */
  subscribe(listener: () => void): () => void
  /** Never rejects. A failed read keeps the defaults and a later call retries. */
  hydrate(): Promise<void>
  /** R28: the change reaches every subscriber at once. */
  update(patch: Partial<PauseSettings>): void
  reset(): void
}

export function createPauseSettingsStore(
  storage: RecordStorage,
): PauseSettingsStore {
  return createPersistedRecordStore<PauseSettings>({
    storageKey: PAUSE_SETTINGS_STORAGE_KEY,
    defaults: DEFAULT_PAUSE_SETTINGS,
    parse: parseStoredPauseSettings,
    serialize: serializePauseSettings,
    hydrateTimeoutMs: PAUSE_SETTINGS_HYDRATE_TIMEOUT_MS,
    storage,
  })
}

let store: PauseSettingsStore | null = null

/* eslint-disable @typescript-eslint/no-require-imports */
/** The app's one settings store. AsyncStorage loads on first use, so this
 *  module and its tests stay free of the native module. */
export function getPauseSettingsStore(): PauseSettingsStore {
  if (store == null) {
    const AsyncStorage = (
      require("@react-native-async-storage/async-storage") as {
        default: RecordStorage
      }
    ).default
    store = createPauseSettingsStore({
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
    })
  }
  return store
}
/* eslint-enable @typescript-eslint/no-require-imports */

/** Test-only: drop the singleton so a suite builds a fresh one. */
export function resetPauseSettingsStoreForTests(): void {
  store = null
}

export function usePauseSettings(
  from: PauseSettingsStore = getPauseSettingsStore(),
): PauseSettingsSnapshot {
  return useSyncExternalStore(
    from.subscribe,
    from.getSnapshot,
    from.getSnapshot,
  )
}
