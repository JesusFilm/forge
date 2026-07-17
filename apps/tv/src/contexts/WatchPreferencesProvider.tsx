import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import {
  DEFAULT_WATCH_PREFERENCES,
  loadWatchPreferences,
  mergeWatchPreferences,
  saveWatchPreferences,
  type PendingWatchPreferences,
  type WatchPreferences,
} from "../lib/watchPreferences"

/**
 * App-wide audio-language preference. Lives at root layout so a choice survives
 * leaving watch (which unmounts WatchSessionProvider) and app restarts. Thin
 * shell over the React-free store; the hydration-race + StrictMode discipline
 * mirrors useShowcasePrefs. The write seam (U2) is the explicit dub-selection
 * seam in WatchSessionProvider.
 */
type WatchPreferencesContextValue = WatchPreferences & {
  setAudioLanguageSlug: (slug: string | null) => void
  /** False until the on-disk read resolves. */
  hydrated: boolean
}

const WatchPreferencesContext =
  createContext<WatchPreferencesContextValue | null>(null)

export function WatchPreferencesProvider({
  children,
}: {
  children: ReactNode
}) {
  const [prefs, setPrefs] = useState<WatchPreferences>(
    DEFAULT_WATCH_PREFERENCES,
  )
  const [hydrated, setHydrated] = useState(false)
  const pendingRef = useRef<PendingWatchPreferences>({})
  const mountedRef = useRef(true)
  // Latest-render mirror so the setter builds `next` outside the state updater —
  // StrictMode double-invokes updaters, which would double the disk write.
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  useEffect(() => {
    // Setup restores what cleanup mutates — a StrictMode remount reuses this same
    // hook instance, so a stale `false` here would wedge hydration.
    mountedRef.current = true

    void (async () => {
      const loaded = await loadWatchPreferences()
      if (!mountedRef.current) return
      const merged = mergeWatchPreferences(loaded, pendingRef.current)
      setPrefs(merged)
      setHydrated(true)
      // A pre-hydration write already persisted its own value; re-persist the
      // merge so disk matches what the viewer is now looking at.
      if (Object.keys(pendingRef.current).length > 0) {
        void saveWatchPreferences(merged)
      }
    })()

    return () => {
      mountedRef.current = false
    }
  }, [])

  const setAudioLanguageSlug = useCallback((slug: string | null) => {
    pendingRef.current = { ...pendingRef.current, audioLanguageSlug: slug }
    const next = { ...prefsRef.current, audioLanguageSlug: slug }
    setPrefs(next)
    void saveWatchPreferences(next)
  }, [])

  const value = useMemo<WatchPreferencesContextValue>(
    () => ({ ...prefs, setAudioLanguageSlug, hydrated }),
    [prefs, setAudioLanguageSlug, hydrated],
  )

  return (
    <WatchPreferencesContext.Provider value={value}>
      {children}
    </WatchPreferencesContext.Provider>
  )
}

export function useWatchPreferences() {
  const ctx = useContext(WatchPreferencesContext)
  if (!ctx) {
    throw new Error(
      "useWatchPreferences must be used within WatchPreferencesProvider",
    )
  }
  return ctx
}
