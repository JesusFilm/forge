// Series-shaped = label SERIES/COLLECTION or has children (mirrors web's content.ts).
// Each call site supplies has-children: the lean /watch fragment omits children so
// `episodes` is [] there, and search's `childCount` covers unlabeled-with-children.
// Single-sourced so grouping (isEpisodicSeriesLabel) and navigation (SERIES_LABELS)
// can't drift on the "series" literal — editing membership stays one edit, two readers.
const EPISODIC_SERIES_LABEL = "series"
const SERIES_LABELS = new Set([EPISODIC_SERIES_LABEL, "collection"])

export function isSeriesLabel(label: string | null | undefined): boolean {
  return label != null && SERIES_LABELS.has(label.toLowerCase())
}

// Grouping-strict: ONLY a genuine episodic SERIES, NOT a COLLECTION. isSeriesLabel
// above lumps both for NAVIGATION (open the grid); a downloads-library folder must
// exclude collections of standalone films, which are individually watchable.
export function isEpisodicSeriesLabel(
  label: string | null | undefined,
): boolean {
  return label != null && label.toLowerCase() === EPISODIC_SERIES_LABEL
}

export function isSeriesRecord(record: {
  label: string | null
  episodes: { length: number }
}): boolean {
  return isSeriesLabel(record.label) || record.episodes.length > 0
}

// Search-result form: a SearchResult carries `label` + `childCount` (a number),
// not a children array. Used by the search screen's routing branch.
export function isSeriesSearchResult(result: {
  label?: string | null
  childCount?: number | null
}): boolean {
  return isSeriesLabel(result.label) || (result.childCount ?? 0) > 0
}
