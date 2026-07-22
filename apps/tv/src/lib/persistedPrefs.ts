import { useCallback, useEffect, useRef, useState } from "react"

/**
 * A hung storage read must degrade to defaults, not wedge every consumer gated on
 * `hydrated` (the watch default-dub chain gates on it — an unbounded await would
 * couple language resolution to storage liveness for the whole session).
 */
export const PREFS_HYDRATION_TIMEOUT_MS = 3000

export type PersistedPrefsStore<T extends object> = {
  defaults: T
  load: () => Promise<T>
  save: (prefs: T) => Promise<void> | void
  merge: (onDisk: T, pending: Partial<T>) => T
  /** The load neither resolved nor rejected within the timeout; session runs on defaults. */
  onLoadTimeout?: () => void
}

/**
 * The one persisted-prefs hook shape: hydrate on mount, key-presence-merge writes
 * that raced ahead of hydration, persist every explicit set. Consumers keep their
 * React-free stores (parse/merge/load/save live there, where the tests reach them).
 */
export function usePersistedPrefs<T extends object>(
  store: PersistedPrefsStore<T>,
): {
  prefs: T
  /** False until the on-disk read resolves (or times out to defaults). */
  hydrated: boolean
  setPref: <K extends keyof T>(key: K, value: T[K]) => void
} {
  const [prefs, setPrefs] = useState<T>(store.defaults)
  const [hydrated, setHydrated] = useState(false)
  // Explicit writes awaiting hydration; absent key = "the user hasn't chosen",
  // which the value alone can't express (null is both default and a real clear).
  const pendingRef = useRef<Partial<T>>({})
  const mountedRef = useRef(true)
  // Latest-render mirrors: the setter builds `next` outside the state updater
  // (StrictMode double-invokes updaters — that would double the disk write).
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const storeRef = useRef(store)
  storeRef.current = store

  useEffect(() => {
    // Setup restores what cleanup mutates — a StrictMode remount reuses this same
    // hook instance, so a stale `false` here would wedge hydration.
    mountedRef.current = true

    void (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const loaded = await Promise.race([
        storeRef.current.load(),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), PREFS_HYDRATION_TIMEOUT_MS)
        }),
      ]).finally(() => clearTimeout(timer))
      if (!mountedRef.current) return
      if (loaded == null) storeRef.current.onLoadTimeout?.()
      const merged = storeRef.current.merge(
        loaded ?? storeRef.current.defaults,
        pendingRef.current,
      )
      setPrefs(merged)
      setHydrated(true)
      // A pre-hydration write already persisted its own value; re-persist the
      // merge so disk matches what the viewer is now looking at.
      if (Object.keys(pendingRef.current).length > 0) {
        void storeRef.current.save(merged)
      }
    })()

    return () => {
      mountedRef.current = false
    }
  }, [])

  const setPref = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    pendingRef.current = { ...pendingRef.current, [key]: value }
    const next = { ...prefsRef.current, [key]: value }
    setPrefs(next)
    void storeRef.current.save(next)
  }, [])

  return { prefs, hydrated, setPref }
}
