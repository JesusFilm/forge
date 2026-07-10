// Series-shaped = label SERIES/COLLECTION or has children (mirrors web's content.ts).
// Each call site supplies has-children: the lean /watch fragment omits children so
// `episodes` is [] there, and search's `childCount` covers unlabeled-with-children.
const SERIES_LABELS = new Set(["series", "collection"])

export function isSeriesLabel(label: string | null | undefined): boolean {
  return label != null && SERIES_LABELS.has(label.toLowerCase())
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
