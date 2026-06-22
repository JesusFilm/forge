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
 * App-wide watch preferences (dub language, subtitle language, subtitles on/off).
 *
 * Lives at the root layout — not inside the watch route — so a choice survives
 * leaving the watch screen (which unmounts WatchSessionProvider) and an app
 * restart. WatchSessionProvider reads these as the top-priority default when
 * resolving a video's variant/subtitle, and writes them back when the user picks.
 *
 * Mirrors {@link ExperienceSelectionProvider}: async read on mount gated by
 * `isReady`, best-effort writes that never block the UI.
 */
type WatchPreferencesContextValue = WatchPreferences & {
  setPreferredAudioLanguage: (slug: string | null) => void
  setPreferredSubtitleLanguage: (slug: string | null) => void
  setPreferredSubtitleName: (name: string | null) => void
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

  // Latest prefs snapshot, so the persist helper can merge a single field
  // without taking `prefs` as a dependency (which would re-create every setter
  // on each change and thrash WatchSessionProvider's memo). Kept in sync with
  // committed state on every render (covers the async load on mount); persist()
  // also advances it synchronously so multiple setter calls in one event handler
  // compose instead of the later one clobbering the earlier off a stale ref.
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
  const setPreferredSubtitleName = useCallback(
    (name: string | null) => persist({ subtitleLanguageName: name }),
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
        setPreferredSubtitleName,
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
