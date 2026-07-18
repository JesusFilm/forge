import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react"

import { usePersistedPrefs } from "../lib/persistedPrefs"
import {
  DEFAULT_WATCH_PREFERENCES,
  loadWatchPreferences,
  mergeWatchPreferences,
  reportWatchPreferencesReadTimeout,
  saveWatchPreferences,
  type WatchPreferences,
} from "../lib/watchPreferences"

/**
 * App-wide audio-language preference. Lives at root layout so a choice survives
 * leaving watch (which unmounts WatchSessionProvider) and app restarts. Thin
 * shell over the React-free store via the shared persisted-prefs hook. The write
 * seam (U2) is the explicit dub-selection seam in WatchSessionProvider.
 */
type WatchPreferencesContextValue = WatchPreferences & {
  setAudioLanguageSlug: (slug: string | null) => void
  /** False until the on-disk read resolves (or times out to defaults). */
  hydrated: boolean
}

const WatchPreferencesContext =
  createContext<WatchPreferencesContextValue | null>(null)

export function WatchPreferencesProvider({
  children,
}: {
  children: ReactNode
}) {
  const { prefs, hydrated, setPref } = usePersistedPrefs<WatchPreferences>({
    defaults: DEFAULT_WATCH_PREFERENCES,
    load: loadWatchPreferences,
    save: saveWatchPreferences,
    merge: mergeWatchPreferences,
    onLoadTimeout: reportWatchPreferencesReadTimeout,
  })

  const setAudioLanguageSlug = useCallback(
    (slug: string | null) => setPref("audioLanguageSlug", slug),
    [setPref],
  )

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
