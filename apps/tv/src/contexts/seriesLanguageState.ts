// Pure, React-free series-language-selection state (U4), extracted for jest-expo
// testability. Selections keyed PER SERIES by documentId so a nested push can't
// clobber the parent; identity is languageSlug, never bcp47 (ko vs ko-kmr collide).

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
 * Register the series screen that owns the stack lineage. It stays active while
 * pushing EPISODES (blur must not unregister it — the episode needs its
 * selection); a nested series takes over by registering on its own focus.
 */
export function setActive(
  state: SeriesLanguageState,
  seriesId: string | null,
): SeriesLanguageState {
  if (state.activeSeriesId === seriesId) return state
  return { ...state, activeSeriesId: seriesId }
}

/**
 * Unmount teardown: deletes ONLY this series' selection and releases
 * `activeSeriesId` only when it still points here — a popped nested series must
 * not clear the parent's entry, and focus-vs-unmount order isn't guaranteed
 * (both orders converge since the parent may re-register before this runs).
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
 * The slug the watch session carries into an opened episode: the ACTIVE series'
 * selection. Null when no series is in the lineage or it has no selection — the
 * session's default chain (device locale → primary → English → first) takes over.
 */
export function carriedSlug(state: SeriesLanguageState): string | null {
  if (state.activeSeriesId == null) return null
  return state.selections.get(state.activeSeriesId) ?? null
}

// ── Trailer swap (R4 / AE9) ────────────────────────────────────────

/**
 * The dub Play Trailer plays after a language selection: the series' own dub
 * matching `selectedSlug` when PLAYABLE (published + non-empty hls), else
 * `currentDub` unchanged so the trailer never disappears just because the chosen
 * language has none. Exact languageSlug match; pass `currentDub: null` to probe.
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
 * Annotate + order the language union for the panel: A→Z by display name (stable
 * for ties), active by exact slug match. Rows are NEVER disabled by trailer
 * playability — the list selects the language EPISODES open in (carry-through);
 * the trailer swap is best-effort (resolveTrailerSwap).
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
