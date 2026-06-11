// SYNC: adapted from apps/mobile/src/lib/isSeriesRecord.ts
//
// Series detection: a record is series-shaped when its label is
// SERIES/COLLECTION, or it has children. The call sites carry different
// shapes, so the label test is shared and each site supplies its own
// "has children" signal:
//   - search: a SearchResult has `label` + `childCount` (a number) — inline.
//   - the /watch redirect: a normalized record has `label` but the lean watch
//     fragment doesn't fetch the video's own children, so `episodes` is
//     absent/[] there and this resolves to a label-only check.
//   - the series screen: normalizeSeries populates `episodes`, so the
//     has-children branch covers unlabeled collections.
//
// Divergence from mobile: label matching is STRICT UPPERCASE — the GraphQL
// wire always sends uppercase enum values, and case-folding would let mocked
// lowercase fixtures pass where prod data never does (mocked-shape-vs-real-
// contract discipline).
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
