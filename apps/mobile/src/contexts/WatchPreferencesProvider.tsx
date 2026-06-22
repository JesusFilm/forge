import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import AsyncStorage from "@react-native-async-storage/async-storage"

import {
  DEFAULT_WATCH_PREFERENCES,
  parseStoredPreferences,
  serializeWatchPreferences,
  WATCH_PREFERENCES_STORAGE_KEY,
  type WatchPreferences,
} from "../lib/watchPreferences"

/**
 * App-wide watch preferences (dub/subtitle language, subtitles on/off). Lives at
 * root layout so a choice survives leaving watch (unmounts WatchSessionProvider)
 * + app restart. Mirrors {@link ExperienceSelectionProvider}: best-effort async.
 */
type WatchPreferencesContextValue = WatchPreferences & {
  setPreferredAudioLanguage: (slug: string | null) => void
  setPreferredSubtitleLanguage: (slug: string | null) => void
  setSubtitlesEnabled: (enabled: boolean) => void
  /** False until the persisted blob has been read from AsyncStorage. */
  isReady: boolean
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
  const [isReady, setIsReady] = useState(false)

  // Latest prefs snapshot so persist can merge one field without a `prefs` dep
  // (which would re-create every setter and thrash WatchSessionProvider's memo).
  // persist() advances it synchronously so multiple setters in one handler compose.
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  useEffect(() => {
    // Guard against a stale read settling into a remounted instance (e.g. an
    // error-boundary reset at the root) — without it, the first mount's pending
    // getItem would setState on the second mount.
    let cancelled = false
    AsyncStorage.getItem(WATCH_PREFERENCES_STORAGE_KEY)
      .then((stored) => {
        if (!cancelled) setPrefs(parseStoredPreferences(stored))
      })
      .catch(() => {
        // Treat read failure as first launch — defaults already applied.
      })
      .finally(() => {
        if (!cancelled) setIsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const persist = useCallback((patch: Partial<WatchPreferences>) => {
    const next = { ...prefsRef.current, ...patch }
    // Advance the ref now (not on the next render) so a second persist() in the
    // same tick — e.g. selecting a subtitle fires setSubtitlesEnabled +
    // setPreferredSubtitleLanguage back-to-back — merges onto this result.
    prefsRef.current = next
    setPrefs(next)
    AsyncStorage.setItem(
      WATCH_PREFERENCES_STORAGE_KEY,
      serializeWatchPreferences(next),
    ).catch(() => {
      // Best-effort — the in-memory choice still applies for this session.
    })
  }, [])

  const setPreferredAudioLanguage = useCallback(
    (slug: string | null) => persist({ audioLanguageSlug: slug }),
    [persist],
  )
  const setPreferredSubtitleLanguage = useCallback(
    (slug: string | null) => persist({ subtitleLanguageSlug: slug }),
    [persist],
  )
  const setSubtitlesEnabled = useCallback(
    (enabled: boolean) => persist({ subtitlesEnabled: enabled }),
    [persist],
  )

  return (
    <WatchPreferencesContext.Provider
      value={{
        ...prefs,
        setPreferredAudioLanguage,
        setPreferredSubtitleLanguage,
        setSubtitlesEnabled,
        isReady,
      }}
    >
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
