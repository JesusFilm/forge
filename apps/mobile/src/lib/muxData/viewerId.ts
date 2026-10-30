/**
 * The Mux-only viewer id (R22, KTD8): one random id for each install, kept on
 * the phone. It shares no storage or value with any other app id, and not with
 * `getViewerId()`, which lasts one launch and goes to admin.
 */

import AsyncStorage from "@react-native-async-storage/async-storage"

import { mintInstallId } from "../push/store"
import { resolveMuxDataConfig } from "./config"

/** Never rename: a new key orphans every stored id, and each install then
 *  counts as a new Mux viewer. */
export const MUX_VIEWER_ID_STORAGE_KEY = "mux-data-viewer-id"

export type MuxViewerIdStoreDeps = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  /** Called at most once per launch, and never when an id is stored. */
  mintViewerId: () => string
}

export type MuxViewerIdStore = ReturnType<typeof createMuxViewerIdStore>

export function createMuxViewerIdStore(deps: MuxViewerIdStoreDeps) {
  let flight: Promise<string> | null = null
  /** Held here after a failed read, so a storage fault costs one delayed
   *  write and never a second id. */
  let mintedId: string | null = null

  /** Memoized. A FAILED read releases the memo, so a later call reads again
   *  and writes the held id once storage answers. */
  function get(): Promise<string> {
    if (flight != null) return flight
    let failed = false
    const current = (async () => {
      let stored: string | null
      try {
        stored = await deps.getItem(MUX_VIEWER_ID_STORAGE_KEY)
      } catch {
        // No write here: a failed read cannot tell an empty slot from a
        // stored id it missed, and a write would replace that id.
        failed = true
        return (mintedId ??= deps.mintViewerId())
      }
      if (stored) return stored
      const id = (mintedId ??= deps.mintViewerId())
      try {
        await deps.setItem(MUX_VIEWER_ID_STORAGE_KEY, id)
      } catch {
        // Best-effort: memory holds the id for this launch.
      }
      return id
    })()
    flight = current
    // Outside the body: a release inside it could run before `flight` is set.
    const release = () => {
      if (failed && flight === current) flight = null
    }
    void current.then(release, release)
    return current
  }

  return {
    get,

    /** Module singletons outlive a test file; this clears one without reaching
     *  into its internals. */
    reset(): void {
      flight = null
      mintedId = null
    },
  }
}

let store: MuxViewerIdStore | null = null

/** The app-wide Mux viewer id store. */
export function getMuxViewerIdStore(): MuxViewerIdStore {
  if (store == null) {
    store = createMuxViewerIdStore({
      getItem: (key) => AsyncStorage.getItem(key),
      setItem: (key, value) => AsyncStorage.setItem(key, value),
      mintViewerId: mintInstallId,
    })
  }
  return store
}

/**
 * Starts the read at app launch, so the first attach waits on this one
 * promise and never delays `play()`. With the gate off it reads nothing.
 */
export function startMuxViewerIdRead(): void {
  if (resolveMuxDataConfig() == null) return
  void getMuxViewerIdStore().get()
}

/** Test seam: drop the singleton so the next getter builds a fresh store. */
export function resetMuxViewerIdStoreForTests(): void {
  store?.reset()
  store = null
}
