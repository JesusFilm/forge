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

import type {
  WatchChildLanguage,
  WatchVideoRecord,
} from "../lib/normalizeVideo"
import {
  INITIAL_RECONCILER_STATE,
  markUserChoice,
  reconcileDefault,
  resetReconciler,
} from "../lib/preferenceReconciler"
import { useWatchPreferences } from "./WatchPreferencesProvider"

/**
 * Shared selection state for the series detail screen and its language sheet.
 * The sheet is a separate formSheet route (no props), so both read/write the
 * language through context, not nav params. Lighter than WatchSessionProvider.
 */
type SeriesSessionContextValue = {
  series: WatchVideoRecord | null
  setSeries: (series: WatchVideoRecord | null) => void
  /** The languages the series' episodes are available in — the sheet's feed. */
  languages: WatchChildLanguage[]
  /** The selected audio language slug, or null before resolution. */
  selectedLanguageSlug: string | null
  /**
   * Set the selected language; persists it as the app-wide audio preference so
   * it carries into a grid-opened episode (watch resolves its default dub from
   * the same WatchPreferences slug). Trade-off: changes default audio for later videos.
   */
  setSelectedLanguageSlug: (slug: string) => void
}

const SeriesSessionContext = createContext<SeriesSessionContextValue | null>(
  null,
)

// Module-level stable empty so the context value memo doesn't thrash when a
// series has no language union (or none yet).
const EMPTY_LANGUAGES: WatchChildLanguage[] = []

export function SeriesSessionProvider({ children }: { children: ReactNode }) {
  const {
    audioLanguageSlug: preferredAudioSlug,
    isReady: preferencesReady,
    setPreferredAudioLanguage,
  } = useWatchPreferences()

  const [series, setSeries] = useState<WatchVideoRecord | null>(null)
  const [selectedLanguageSlug, setSelectedLanguageSlugState] = useState<
    string | null
  >(null)

  // series.languages is referentially stable for a given series (normalizeSeries
  // memoizes on the raw reference), so this is stable across renders.
  const languages = series?.languages ?? EMPTY_LANGUAGES

  // Guard state for the default-resolution effect so the user's explicit pick is
  // never overridden when partial→full data republishes the same series, and the
  // default resolves once per series identity. See preferenceReconciler.
  const reconcilerRef = useRef(INITIAL_RECONCILER_STATE)

  const setSelectedLanguageSlug = useCallback(
    (slug: string) => {
      reconcilerRef.current = markUserChoice(reconcilerRef.current)
      setSelectedLanguageSlugState(slug)
      // Carry-through: persist by unique slug so the tapped episode opens in it.
      if (slug) setPreferredAudioLanguage(slug)
    },
    [setPreferredAudioLanguage],
  )

  // New series identity → reset choice tracking + selection, so a prior series'
  // language never leaks into the next.
  useEffect(() => {
    reconcilerRef.current = resetReconciler()
    setSelectedLanguageSlugState(null)
  }, [series?.documentId])

  // Default the language once per series, as soon as the language union is
  // available, unless the user already chose. Resolution order (resolveDefaultSlug):
  // persisted preference → device locale → series primary → English → first.
  useEffect(() => {
    const options =
      series?.languages.map((l) => ({
        slug: l.slug,
        bcp47: l.bcp47,
        languageSlug: l.slug,
      })) ?? []
    const { nextState, apply } = reconcileDefault(reconcilerRef.current, {
      ready: preferencesReady,
      identity: series?.documentId ?? null,
      options,
      primaryBcp47: series?.primaryLanguageBcp47 ?? null,
      preferredSlug: preferredAudioSlug,
    })
    reconcilerRef.current = nextState
    if (apply && series) {
      setSelectedLanguageSlugState(apply.slug ?? series.languages[0].slug)
    }
  }, [
    series?.documentId,
    series?.languages.length,
    series?.primaryLanguageBcp47,
    preferencesReady,
    preferredAudioSlug,
  ])

  const value = useMemo<SeriesSessionContextValue>(
    () => ({
      series,
      setSeries,
      languages,
      selectedLanguageSlug,
      setSelectedLanguageSlug,
    }),
    [series, languages, selectedLanguageSlug, setSelectedLanguageSlug],
  )

  return (
    <SeriesSessionContext.Provider value={value}>
      {children}
    </SeriesSessionContext.Provider>
  )
}

export function useSeriesSession() {
  const ctx = useContext(SeriesSessionContext)
  if (!ctx) {
    throw new Error(
      "useSeriesSession must be used within SeriesSessionProvider",
    )
  }
  return ctx
}
