import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react"

import { usePersistedPrefs } from "../lib/persistedPrefs"
import { reloadAppAsync } from "expo"
import { getStorage } from "../lib/safeStorage"
import {
  DEFAULT_LOADING_ANIMATION,
  DEFAULT_STARTUP_ANIMATION,
  type LogoAnimationId,
} from "../lib/logoAnimations"
import {
  DEFAULT_WATCH_PREFERENCES,
  loadWatchPreferences,
  mergeWatchPreferences,
  reportWatchPreferencesReadTimeout,
  saveWatchPreferences,
  serializeWatchPreferences,
  WATCH_PREFERENCES_STORAGE_KEY,
  type WatchPreferences,
} from "../lib/watchPreferences"

/**
 * App-wide audio-language preference. Lives at root layout so a choice survives
 * leaving watch (which unmounts WatchSessionProvider) and app restarts. Thin
 * shell over the React-free store via the shared persisted-prefs hook. The write
 * seam (U2) is the explicit dub-selection seam in WatchSessionProvider.
 */
type WatchPreferencesContextValue = WatchPreferences & {
  startupAnimationId: LogoAnimationId
  loadingAnimationId: LogoAnimationId
  setStartupAnimationId: (id: LogoAnimationId) => void
  setLoadingAnimationId: (id: LogoAnimationId) => void
  restartAppForPreview: () => Promise<void>
  setAudioLanguageSlug: (slug: string | null) => void
  setAndroidPlayerVariant: (
    variant: WatchPreferences["androidPlayerVariant"],
  ) => void
  setNativePlayerVariant: (
    variant: WatchPreferences["nativePlayerVariant"],
  ) => void
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
  const setAndroidPlayerVariant = useCallback(
    (variant: WatchPreferences["androidPlayerVariant"]) =>
      setPref("androidPlayerVariant", variant),
    [setPref],
  )

  const setStartupAnimationId = useCallback(
    (id: LogoAnimationId) => setPref("startupAnimationId", id),
    [setPref],
  )
  const setLoadingAnimationId = useCallback(
    (id: LogoAnimationId) => setPref("loadingAnimationId", id),
    [setPref],
  )
  const restartAppForPreview = useCallback(async () => {
    await getStorage().setItem(
      WATCH_PREFERENCES_STORAGE_KEY,
      serializeWatchPreferences(prefs),
    )
    await reloadAppAsync("Preview selected startup animation")
  }, [prefs])

  const setNativePlayerVariant = useCallback(
    (variant: WatchPreferences["nativePlayerVariant"]) =>
      setPref("nativePlayerVariant", variant),
    [setPref],
  )

  const value = useMemo<WatchPreferencesContextValue>(
    () => ({
      ...prefs,
      startupAnimationId: prefs.startupAnimationId ?? DEFAULT_STARTUP_ANIMATION,
      loadingAnimationId: prefs.loadingAnimationId ?? DEFAULT_LOADING_ANIMATION,
      setStartupAnimationId,
      setLoadingAnimationId,
      restartAppForPreview,
      setAudioLanguageSlug,
      setAndroidPlayerVariant,
      setNativePlayerVariant,
      hydrated,
    }),
    [
      prefs,
      setStartupAnimationId,
      setLoadingAnimationId,
      restartAppForPreview,
      setAudioLanguageSlug,
      setAndroidPlayerVariant,
      setNativePlayerVariant,
      hydrated,
    ],
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
