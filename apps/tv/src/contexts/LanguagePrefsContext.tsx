// App-wide default audio/subtitle language (the Settings page's two pickers):
// hydrates once at mount, persists every explicit set. WatchSessionProvider's
// default-resolution chain reads it; a series/video pick still wins in session.

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
  DEFAULT_LANGUAGE_PREFS,
  loadLanguagePrefs,
  mergeLanguagePrefs,
  saveLanguagePrefs,
  type LanguagePref,
  type LanguagePrefs,
  type PendingLanguagePrefs,
} from "../lib/languagePrefs"

type LanguagePrefsContextValue = {
  prefs: LanguagePrefs
  /** False until the on-disk read resolves — rows disable, defaults wait. */
  hydrated: boolean
  setAudioPref: (pref: LanguagePref | null) => void
  setSubtitlePref: (pref: LanguagePref | null) => void
}

const LanguagePrefsContext = createContext<LanguagePrefsContextValue | null>(
  null,
)

export function LanguagePrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<LanguagePrefs>(DEFAULT_LANGUAGE_PREFS)
  const [hydrated, setHydrated] = useState(false)
  const pendingRef = useRef<PendingLanguagePrefs>({})
  const mountedRef = useRef(true)

  useEffect(() => {
    // Setup restores what cleanup mutates — a StrictMode remount reuses this
    // same hook instance, so a stale `false` here would wedge hydration.
    mountedRef.current = true

    void (async () => {
      const loaded = await loadLanguagePrefs()
      if (!mountedRef.current) return
      const merged = mergeLanguagePrefs(loaded, pendingRef.current)
      setPrefs(merged)
      setHydrated(true)
      // A pre-hydration write already persisted its own value; re-persist the
      // merge so disk matches what the user is now looking at.
      if (Object.keys(pendingRef.current).length > 0) {
        void saveLanguagePrefs(merged)
      }
    })()

    return () => {
      mountedRef.current = false
    }
  }, [])

  const setPref = useCallback(
    (field: "audio" | "subtitle", pref: LanguagePref | null) => {
      pendingRef.current = { ...pendingRef.current, [field]: pref }
      setPrefs((prev) => {
        const next = { ...prev, [field]: pref }
        void saveLanguagePrefs(next)
        return next
      })
    },
    [],
  )
  const setAudioPref = useCallback(
    (pref: LanguagePref | null) => setPref("audio", pref),
    [setPref],
  )
  const setSubtitlePref = useCallback(
    (pref: LanguagePref | null) => setPref("subtitle", pref),
    [setPref],
  )

  const value = useMemo<LanguagePrefsContextValue>(
    () => ({ prefs, hydrated, setAudioPref, setSubtitlePref }),
    [prefs, hydrated, setAudioPref, setSubtitlePref],
  )

  return (
    <LanguagePrefsContext.Provider value={value}>
      {children}
    </LanguagePrefsContext.Provider>
  )
}

export function useLanguagePrefs(): LanguagePrefsContextValue {
  const ctx = useContext(LanguagePrefsContext)
  if (!ctx) {
    throw new Error(
      "useLanguagePrefs must be used within LanguagePrefsProvider",
    )
  }
  return ctx
}
