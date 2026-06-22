// SYNC: adapted from apps/mobile. Series-shaped = label SERIES/COLLECTION or has
// children. Divergence from mobile: label matching is STRICT UPPERCASE (wire
// sends uppercase enums; case-folding lets mocked lowercase fixtures pass falsely).
const SERIES_LABELS = new Set(["SERIES", "COLLECTION"])

export function isSeriesLabel(label: string | null | undefined): boolean {
  return label != null && SERIES_LABELS.has(label)
}

// Normalized-record form. `episodes` is optional so the base WatchVideoRecord
// (which carries no own-children data) and the series record both fit.
export function isSeriesRecord(record: {
  label: string | null
  episodes?: { length: number } | null
}): boolean {
  return isSeriesLabel(record.label) || (record.episodes?.length ?? 0) > 0
}

// Search-result form: a SearchResult carries `label` + `childCount` (a number),
// not a children array. Used by the search screen's routing branch.
export function isSeriesSearchResult(result: {
  label?: string | null
  childCount?: number | null
}): boolean {
  return isSeriesLabel(result.label) || (result.childCount ?? 0) > 0
}
