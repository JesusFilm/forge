import { useCallback, useEffect, useRef, useState } from "react"

import {
  DEFAULT_SHOWCASE_PREFS,
  loadShowcasePrefs,
  mergeShowcasePrefs,
  saveShowcasePrefs,
} from "./prefs"
import type { PendingShowcasePrefs, ShowcasePrefs } from "./prefs"

type UseShowcasePrefsResult = {
  prefs: ShowcasePrefs
  /** False until the on-disk read resolves — gates the launch-only auto-start check. */
  hydrated: boolean
  setAutoStart: (autoStart: boolean) => void
}

/**
 * On-device showcase preferences: hydrates on mount, persists every mutation.
 * Only an explicit setAutoStart writes; mounting and unmounting never do (AE2).
 * The React-free policy it wraps lives in ./prefs, where the tests reach it.
 */
export function useShowcasePrefs(): UseShowcasePrefsResult {
  const [prefs, setPrefs] = useState<ShowcasePrefs>(DEFAULT_SHOWCASE_PREFS)
  const [hydrated, setHydrated] = useState(false)
  const pendingRef = useRef<PendingShowcasePrefs>({})
  const mountedRef = useRef(true)

  useEffect(() => {
    // Setup restores what cleanup mutates — a StrictMode remount reuses this
    // same hook instance, so a stale `false` here would wedge hydration.
    mountedRef.current = true

    void (async () => {
      const loaded = await loadShowcasePrefs()
      if (!mountedRef.current) return
      const merged = mergeShowcasePrefs(loaded, pendingRef.current)
      setPrefs(merged)
      setHydrated(true)
      // A pre-hydration write already persisted its own value; re-persist the
      // merge so disk matches what the user is now looking at.
      if (Object.keys(pendingRef.current).length > 0) {
        void saveShowcasePrefs(merged)
      }
    })()

    return () => {
      mountedRef.current = false
    }
  }, [])

  const setAutoStart = useCallback((autoStart: boolean) => {
    pendingRef.current = { ...pendingRef.current, autoStart }
    setPrefs((prev) => {
      const next = { ...prev, autoStart }
      void saveShowcasePrefs(next)
      return next
    })
  }, [])

  return { prefs, hydrated, setAutoStart }
}
