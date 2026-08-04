import { useEffect } from "react"
import { AppState } from "react-native"
import type { ReactNode } from "react"

import { getAuthSession, rumUserFromSession } from "../lib/authSession"
import { setDatadogRumUser } from "../lib/datadog"

/**
 * Lifecycle host for the module-level auth session store (KTD9): refreshes
 * the session on mount and app-foreground, and mirrors sign-in/out into the
 * Datadog RUM user — the opaque subject id ONLY, no email or name.
 *
 * All state lives in the plain-module store (no React context), so this
 * component is StrictMode-remount safe by construction: setup subscribes,
 * cleanup only unsubscribes, and no hook-lifetime ref is mutated.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const store = getAuthSession()
    const syncRumUser = () => {
      setDatadogRumUser(rumUserFromSession(store.getSnapshot()))
    }
    const unsubscribe = store.subscribe(syncRumUser)
    void store.refresh()
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void store.refresh()
    })
    return () => {
      unsubscribe()
      appState.remove()
    }
  }, [])

  return children
}
