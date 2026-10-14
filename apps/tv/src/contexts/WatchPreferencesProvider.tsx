import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

import { usePersistedPrefs } from "../lib/persistedPrefs"
import { restartWatchForPreview } from "../lib/restartWatchForPreview"
import {
  DEFAULT_LOADING_ANIMATION,
  DEFAULT_STARTUP_ANIMATION,
  type LoadingAnimationId,
  type LogoAnimationId,
} from "../lib/logoAnimations"
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
  startupAnimationId: LogoAnimationId
  loadingAnimationId: LoadingAnimationId
  setStartupAnimationId: (id: LogoAnimationId) => void
  setLoadingAnimationId: (id: LoadingAnimationId) => void
  restartAppForPreview: () => Promise<void>
  setAudioLanguageSlug: (slug: string | null) => void
  setAndroidPlayerVariant: (
    variant: WatchPreferences["androidPlayerVariant"],
  ) => void
  setNativePlayerVariant: (
    variant: WatchPreferences["nativePlayerVariant"],
  ) => void
  setTopShelfPreviewStyle: (
    style: NonNullable<WatchPreferences["topShelfPreviewStyle"]>,
  ) => void
  topShelfPreviewMessage: string
  setTopShelfPreviewMessage: (message: string) => void
  topShelfPreviewRevision: number
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
  const [topShelfPreviewMessage, setTopShelfPreviewMessage] = useState("")
  const [topShelfPreviewRevision, setTopShelfPreviewRevision] = useState(0)
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
    (id: LoadingAnimationId) => setPref("loadingAnimationId", id),
    [setPref],
  )
  const restartAppForPreview = useCallback(async () => {
    await restartWatchForPreview(prefs)
  }, [prefs])

  const setNativePlayerVariant = useCallback(
    (variant: WatchPreferences["nativePlayerVariant"]) =>
      setPref("nativePlayerVariant", variant),
    [setPref],
  )

  const setTopShelfPreviewStyle = useCallback(
    (style: NonNullable<WatchPreferences["topShelfPreviewStyle"]>) => {
      setTopShelfPreviewMessage("Updating Top Shelf…")
      setTopShelfPreviewRevision((value) => value + 1)
      setPref("topShelfPreviewStyle", style)
    },
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
      setTopShelfPreviewStyle,
      topShelfPreviewMessage,
      setTopShelfPreviewMessage,
      topShelfPreviewRevision,
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
      setTopShelfPreviewStyle,
      topShelfPreviewMessage,
      topShelfPreviewRevision,
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
