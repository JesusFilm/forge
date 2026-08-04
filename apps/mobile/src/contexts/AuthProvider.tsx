import { useEffect } from "react"
import { AppState } from "react-native"
import AsyncStorage from "@react-native-async-storage/async-storage"
import type { ReactNode } from "react"

import { getAuthSession, rumUserFromSession } from "../lib/authSession"
import { setDatadogRumUser } from "../lib/datadog"
import { attachProgressLifecycle } from "../lib/watchProgress/lifecycle"
import { resetToSignedOut } from "../lib/watchProgress/store"
import {
  getProgressSync,
  getSignedInAccountId,
} from "../lib/watchProgress/syncClient"

/**
 * Lifecycle host for the module-level auth session store (KTD9): refreshes
 * the session on mount and app-foreground, mirrors sign-in/out into the
 * Datadog RUM user (opaque subject id ONLY), and drives the progress
 * lifecycle — sign-in hydrates bars + flushes the offline queue; sign-out
 * empties the store, snapshot, and queue (R10).
 *
 * All state lives in plain-module stores (no React context), so this
 * component is StrictMode-remount safe by construction: setup subscribes,
 * cleanup only unsubscribes, and no hook-lifetime ref is mutated.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const store = getAuthSession()
    const syncRumUser = () => {
      setDatadogRumUser(rumUserFromSession(store.getSnapshot()))
    }
    const unsubscribeRum = store.subscribe(syncRumUser)
    const sync = getProgressSync()
    const detachProgress = attachProgressLifecycle({
      getAccountId: getSignedInAccountId,
      subscribe: (listener) => store.subscribe(listener),
      hydrateFromSnapshot: () => sync.hydrateFromSnapshot(),
      hydrateFromServer: () => sync.hydrateFromServer(),
      flushQueue: () => sync.flushQueue(),
      resetStore: resetToSignedOut,
      removeStorageItem: (key) => AsyncStorage.removeItem(key),
    })
    void store.refresh()
    const appState = AppState.addEventListener("change", (state) => {
      // Foreground also flushes any offline queue from downloaded playback.
      if (state === "active") {
        void store.refresh()
        void sync.flushQueue()
      }
    })
    return () => {
      unsubscribeRum()
      detachProgress()
      appState.remove()
    }
  }, [])

  return children
}
