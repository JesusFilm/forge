// Series detection, mirroring web's apps/web/src/lib/content.ts isSeriesRecord:
// a record is series-shaped when its label is SERIES/COLLECTION, or it has
// children. The two call sites carry different shapes, so the label test is
// shared and each site supplies its own "has children" signal:
//   - search: a SearchResult has `label` + `childCount` (a number) — inline.
//   - the /watch redirect: a normalized record has `label` + `episodes`. The
//     lean watch fragment doesn't fetch the video's own children, so `episodes`
//     is [] there and this resolves to a label check (the search entry's
//     `childCount` covers the unlabeled-but-has-children case).
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
