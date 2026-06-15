// Thin React shell over seriesLanguageState's pure ops (U4): holds the
// per-series language selections + the active (top-of-stack) series screen.
// Mounted ABOVE WatchSessionProvider (app/_layout.tsx) so the watch session
// can feed the carried slug into its default-dub resolution when an episode
// opens. All transitions live in seriesLanguageState.ts — unit-tested there;
// jest-expo can't load this .tsx.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react"
import type { ReactNode } from "react"

import {
  EMPTY_SERIES_LANGUAGE_STATE,
  carriedSlug as deriveCarriedSlug,
  clearSeries as clearSeriesOp,
  setActive as setActiveOp,
  setSelection as setSelectionOp,
  type SeriesLanguageState,
} from "./seriesLanguageState"

type SeriesLanguageContextValue = {
  /** Language-slug selections keyed by series documentId. */
  selections: ReadonlyMap<string, string>
  /** documentId of the focused (top-of-stack) series screen, or null. */
  activeSeriesId: string | null
  /**
   * The ACTIVE series' selection — the dub an opened episode should start in.
   * Null when no series screen is in the stack's lineage (or the active one
   * has no selection); the watch session then falls through its default chain.
   */
  carriedSlug: string | null
  /** Record a selection for one series (slug-keyed, never bcp47). */
  setSelection: (seriesId: string, slug: string) => void
  /** Series screens register themselves on focus; see seriesLanguageState. */
  setActive: (seriesId: string | null) => void
  /** Unmount teardown: deletes the series' entry + releases active if held. */
  clearSeries: (seriesId: string) => void
}

const SeriesLanguageContext = createContext<SeriesLanguageContextValue | null>(
  null,
)

export function SeriesLanguageProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SeriesLanguageState>(
    EMPTY_SERIES_LANGUAGE_STATE,
  )

  // The pure ops return the SAME reference for no-op transitions (e.g. the
  // focus effect re-registering the already-active series on every focus
  // regain), so these setState calls bail without re-rendering consumers.
  const setSelection = useCallback((seriesId: string, slug: string) => {
    setState((prev) => setSelectionOp(prev, seriesId, slug))
  }, [])
  const setActive = useCallback((seriesId: string | null) => {
    setState((prev) => setActiveOp(prev, seriesId))
  }, [])
  const clearSeries = useCallback((seriesId: string) => {
    setState((prev) => clearSeriesOp(prev, seriesId))
  }, [])

  const value = useMemo<SeriesLanguageContextValue>(
    () => ({
      selections: state.selections,
      activeSeriesId: state.activeSeriesId,
      carriedSlug: deriveCarriedSlug(state),
      setSelection,
      setActive,
      clearSeries,
    }),
    [state, setSelection, setActive, clearSeries],
  )

  return (
    <SeriesLanguageContext.Provider value={value}>
      {children}
    </SeriesLanguageContext.Provider>
  )
}

export function useSeriesLanguage(): SeriesLanguageContextValue {
  const ctx = useContext(SeriesLanguageContext)
  if (ctx == null) {
    throw new Error(
      "useSeriesLanguage must be used within a SeriesLanguageProvider",
    )
  }
  return ctx
}

/**
 * Optional-safe read of the carried slug for consumers that must not
 * hard-depend on this provider (WatchSessionProvider feeds it into
 * resolveDefaultVariantIndex's preferred arg). Null when no provider is
 * mounted — indistinguishable from "no series screen in the lineage", which
 * is exactly the fallthrough the default chain handles.
 */
export function useCarriedLanguageSlug(): string | null {
  return useContext(SeriesLanguageContext)?.carriedSlug ?? null
}
