// Pure, React-free state logic for the series language selection (U4) —
// extracted (like watchSessionState.ts / panelState.ts) so the bug-prone
// transitions are unit-testable under jest-expo, which cannot load .tsx.
// SeriesLanguageContext.tsx is a thin React shell over these ops.
//
// Selections are keyed PER SERIES by documentId — never a single slot — so a
// nested series push (series A → series B) can't clobber A's selection, and
// B's unmount deletes only B's entry. `activeSeriesId` tracks which series
// screen currently owns the stack's lineage: each series screen registers
// itself on focus and tears down on unmount, so the carried slug is the
// ACTIVE series' selection — null when no series screen is in the lineage.
// Identity is always languageSlug, never bcp47 (ko vs ko-kmr collide).

export type SeriesLanguageState = {
  /** Language-slug selections keyed by series documentId. */
  selections: ReadonlyMap<string, string>
  /** documentId of the focused (top-of-stack) series screen, or null. */
  activeSeriesId: string | null
}

export const EMPTY_SERIES_LANGUAGE_STATE: SeriesLanguageState = {
  selections: new Map(),
  activeSeriesId: null,
}

// Every op returns the SAME state reference for a no-op transition (e.g. the
// focus effect re-registering the already-active series on each focus regain)
// so the provider's setState bails instead of re-rendering every consumer.

/** Record a language selection for one series. */
export function setSelection(
  state: SeriesLanguageState,
  seriesId: string,
  slug: string,
): SeriesLanguageState {
  if (state.selections.get(seriesId) === slug) return state
  const selections = new Map(state.selections)
  selections.set(seriesId, slug)
  return { ...state, selections }
}

/**
 * Register the series screen that currently owns the stack's lineage. A
 * series screen stays active while it pushes EPISODES (blur must not
 * unregister it — the opened episode needs its selection); a nested series
 * screen takes over by registering itself on its own focus.
 */
export function setActive(
  state: SeriesLanguageState,
  seriesId: string | null,
): SeriesLanguageState {
  if (state.activeSeriesId === seriesId) return state
  return { ...state, activeSeriesId: seriesId }
}

/**
 * Unmount teardown for one series screen: deletes ONLY that series' selection
 * and releases `activeSeriesId` only when it still points at it — a popped
 * nested series must never clear the parent's entry, and the parent may have
 * already re-registered itself before this cleanup runs (focus-effect vs
 * unmount-cleanup order is not guaranteed; both orders converge).
 */
export function clearSeries(
  state: SeriesLanguageState,
  seriesId: string,
): SeriesLanguageState {
  const isActive = state.activeSeriesId === seriesId
  if (!state.selections.has(seriesId) && !isActive) return state
  const selections = new Map(state.selections)
  selections.delete(seriesId)
  return {
    selections,
    activeSeriesId: isActive ? null : state.activeSeriesId,
  }
}

/**
 * The slug the watch session carries into an opened episode: the ACTIVE
 * series' selection. Null when no series screen is in the stack's lineage or
 * the active one has no selection — the session's default chain (device
 * locale → primary → English → first) then takes over.
 */
export function carriedSlug(state: SeriesLanguageState): string | null {
  if (state.activeSeriesId == null) return null
  return state.selections.get(state.activeSeriesId) ?? null
}

// ── Trailer swap (R4 / AE9) ────────────────────────────────────────

/**
 * The dub Play Trailer should play after a language selection: the series'
 * own dub matching `selectedSlug` when it is PLAYABLE (published + non-empty
 * hls — pickPlayableTrailer's rule), else `currentDub` unchanged — so the
 * trailer never disappears under focus just because the chosen language has
 * no trailer dub. Matching is by exact languageSlug. Pass `currentDub: null`
 * to probe whether a slug has a playable match at all.
 */
export function resolveTrailerSwap<
  V extends {
    published: boolean
    hls: string | null
    languageSlug: string | null
  },
>(
  record: { variants: readonly V[] } | null | undefined,
  selectedSlug: string | null,
  currentDub: V | null,
): V | null {
  if (record == null || selectedSlug == null) return currentDub
  const match = record.variants.find(
    (v) =>
      v.languageSlug === selectedSlug &&
      v.published === true &&
      v.hls != null &&
      v.hls !== "",
  )
  return match ?? currentDub
}

// ── Panel rows ─────────────────────────────────────────────────────

/** The language fields the panel renders — WatchChildLanguage satisfies this. */
export type SeriesLanguageOption = {
  /** Unique language-entity slug — the identity key (never bcp47). */
  slug: string
  /** Localized display name; null falls back to the slug. */
  name: string | null
}

export type SeriesLanguageRow = {
  language: SeriesLanguageOption
  /** Currently-selected language → checkmark + initial scroll/focus target. */
  active: boolean
}

/** Display name a language row renders — name, falling back to the slug. */
export function languageDisplayName(language: SeriesLanguageOption): string {
  return language.name ?? language.slug
}

/**
 * Annotate + display-order the series' language union for the panel: A→Z by
 * display name (stable for ties, like annotateVariantRows), active marked by
 * exact slug match. Rows are NEVER disabled by trailer playability — the list
 * selects the language EPISODES open in (carry-through); the trailer swap is
 * best-effort (resolveTrailerSwap).
 */
export function buildLanguageRows(
  languages: readonly SeriesLanguageOption[],
  activeSlug: string | null,
): SeriesLanguageRow[] {
  return languages
    .map((language) => ({
      language,
      active: activeSlug != null && language.slug === activeSlug,
    }))
    .sort((left, right) =>
      languageDisplayName(left.language).localeCompare(
        languageDisplayName(right.language),
      ),
    )
}
