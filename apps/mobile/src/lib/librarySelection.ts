import type { OfflineDownloadRecord } from "./offlineManifest"
import { effectiveDownloadBytes } from "./libraryDownloads"

/**
 * Pure Library selection-state: enter/exit, per-item and per-series toggles,
 * live-intersection pruning (R20), and derived labels for U5's action bar.
 * No React — U5 owns the useState wrapping this.
 */

export type LibrarySelectionState = {
  selecting: boolean
  selected: ReadonlySet<string>
}

export const INITIAL_SELECTION_STATE: LibrarySelectionState = {
  selecting: false,
  selected: new Set(),
}

/** Enter selection mode, seeding the long-pressed slug (or a series' episode slugs). */
export function enterSelection(
  seedSlugs: readonly string[],
): LibrarySelectionState {
  return { selecting: true, selected: new Set(seedSlugs) }
}

export function exitSelection(): LibrarySelectionState {
  return INITIAL_SELECTION_STATE
}

export function toggleSlug(
  state: LibrarySelectionState,
  slug: string,
): LibrarySelectionState {
  const next = new Set(state.selected)
  if (next.has(slug)) next.delete(slug)
  else next.add(slug)
  return { ...state, selected: next }
}

export function toggleSeriesSlugs(
  state: LibrarySelectionState,
  slugs: readonly string[],
  on: boolean,
): LibrarySelectionState {
  const next = new Set(state.selected)
  for (const slug of slugs) {
    if (on) next.add(slug)
    else next.delete(slug)
  }
  return { ...state, selected: next }
}

/** AE2: toggling a series header selects all its episodes unless already
 *  all selected, in which case it deselects all. */
export function toggleSeriesHeader(
  state: LibrarySelectionState,
  episodeSlugs: readonly string[],
): LibrarySelectionState {
  const turnOn = seriesSelectionState(episodeSlugs, state.selected) !== "all"
  return toggleSeriesSlugs(state, episodeSlugs, turnOn)
}

export function selectAll(
  state: LibrarySelectionState,
  allSlugs: readonly string[],
): LibrarySelectionState {
  return { ...state, selected: new Set(allSlugs) }
}

export function deselectAll(
  state: LibrarySelectionState,
): LibrarySelectionState {
  return { ...state, selected: new Set() }
}

export type SeriesSelectionState = "all" | "some" | "none"

/** A series header's checkbox state — AE2's mixed/"some" case. */
export function seriesSelectionState(
  episodeSlugs: readonly string[],
  selected: ReadonlySet<string>,
): SeriesSelectionState {
  if (episodeSlugs.length === 0) return "none"
  const selectedCount = episodeSlugs.filter((slug) => selected.has(slug)).length
  if (selectedCount === 0) return "none"
  return selectedCount === episodeSlugs.length ? "all" : "some"
}

// ── live intersection (R20) ─────────────────────────────────────────────

export type PruneResult = {
  state: LibrarySelectionState
  changed: boolean
  /** The pruned selection (or the whole record list) is empty — U5 should exit selection mode. */
  autoExit: boolean
}

/** Prunes the selection to slugs that still exist, e.g. after an external
 *  delete/completion changes the record list. No-op outside selection mode. */
export function pruneToExisting(
  state: LibrarySelectionState,
  existingSlugs: ReadonlySet<string>,
): PruneResult {
  if (!state.selecting) return { state, changed: false, autoExit: false }
  const pruned = new Set<string>()
  for (const slug of state.selected) {
    if (existingSlugs.has(slug)) pruned.add(slug)
  }
  const changed = pruned.size !== state.selected.size
  const autoExit = pruned.size === 0 || existingSlugs.size === 0
  return {
    state: autoExit ? exitSelection() : { ...state, selected: pruned },
    changed,
    autoExit,
  }
}

// ── derived labels ────────────────────────────────────────────────────────

export type LibrarySelectionSummary = {
  count: number
  combinedBytes: number
  hasFailed: boolean
}

/** Selected-count, freed-space, and retry-visibility labels for U5's action
 *  bar. Recompute from the live (pruned) intersection, not a stale selection. */
export function selectionSummary(
  selected: ReadonlySet<string>,
  records: readonly OfflineDownloadRecord[],
): LibrarySelectionSummary {
  const bySlug = new Map(records.map((r) => [r.videoSlug, r] as const))
  let combinedBytes = 0
  let hasFailed = false
  for (const slug of selected) {
    const record = bySlug.get(slug)
    if (!record) continue
    combinedBytes += effectiveDownloadBytes(record)
    if (record.state === "failed") hasFailed = true
  }
  return { count: selected.size, combinedBytes, hasFailed }
}
