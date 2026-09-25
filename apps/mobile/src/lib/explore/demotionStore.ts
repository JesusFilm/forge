/**
 * KTD3's stored demotion. A launch whose standby failed fast twice keeps one
 * player for later launches: the feed reads the value at the first focus for
 * `resolvePlayerMode`, and writes it once when a launch demotes.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

import { withTimeout } from "../withTimeout"
import type { StoredDemotion } from "./playerMode"

export const DEMOTION_STORAGE_KEY = "explore-player-demotion"

export const DEMOTION_VERSION = 1

/** The first clip waits for the player mode, so a slow read counts as none. */
export const DEMOTION_READ_TIMEOUT_MS = 400

type StoredShape = { v: number; at: number; app: string }

export function serializeDemotion(value: StoredDemotion): string {
  const stored: StoredShape = {
    v: DEMOTION_VERSION,
    at: value.demotedAtMs,
    app: value.appVersion,
  }
  return JSON.stringify(stored)
}

/** Tolerant: bad JSON, another version, or a bad shape reads as none. */
export function parseStoredDemotion(raw: string | null): StoredDemotion | null {
  if (raw == null) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return null
  }
  const { v, at, app } = data as Record<string, unknown>
  if (v !== DEMOTION_VERSION) return null
  if (!Number.isSafeInteger(at) || (at as number) < 0) return null
  if (typeof app !== "string" || app.trim().length === 0) return null
  return { demotedAtMs: at as number, appVersion: app }
}

export type DemotionStoreDeps = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
}

/** Settles with the operation's value, or the fallback. Never rejects, even
 *  on a synchronous throw. */
function settle<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return operation().then(
      (value) => value,
      () => fallback,
    )
  } catch {
    return Promise.resolve(fallback)
  }
}

export type DemotionStore = ReturnType<typeof createDemotionStore>

export function createDemotionStore(deps: DemotionStoreDeps) {
  return {
    /** Never rejects. A missing, corrupt, or slow value reads as none. */
    read(): Promise<StoredDemotion | null> {
      return withTimeout(
        settle(() => deps.getItem(DEMOTION_STORAGE_KEY), null),
        DEMOTION_READ_TIMEOUT_MS,
      ).then(parseStoredDemotion, () => null)
    },

    /** Never rejects. Resolves true when the write landed. */
    write(value: StoredDemotion): Promise<boolean> {
      return settle(
        () =>
          deps
            .setItem(DEMOTION_STORAGE_KEY, serializeDemotion(value))
            .then(() => true),
        false,
      )
    },
  }
}

let store: DemotionStore | null = null

/** The app-wide store. */
export function getDemotionStore(): DemotionStore {
  store ??= createDemotionStore({
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
  })
  return store
}
