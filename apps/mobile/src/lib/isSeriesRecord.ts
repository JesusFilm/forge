// Series-shaped = label SERIES/COLLECTION; has-children decides ONLY when the
// record carries no label at all (see hasLabel below). Each call site supplies
// has-children: the lean /watch fragment omits children so `episodes` is []
// there, and search's `childCount` covers unlabeled-with-children.
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

// A labelled record is classified by that label ALONE; children are only a
// fallback for an unlabeled one. Feature films own their chapter clips (JESUS
// 61), so "has children" is not evidence of a series. apps/tv: #1767.
function hasLabel(label: string | null | undefined): boolean {
  return label != null && label !== ""
}

export function isSeriesRecord(record: {
  label: string | null
  episodes: { length: number }
}): boolean {
  if (hasLabel(record.label)) return isSeriesLabel(record.label)
  return record.episodes.length > 0
}

// Search-result form: a SearchResult carries `label` + `childCount` (a number),
// not a children array. The childCount branch serves SEARCH, whose wire label is
// nullable; home cards run through labelText, which yields "Video" rather than
// null, so a present label always decides there.
export function isSeriesSearchResult(result: {
  label?: string | null
  childCount?: number | null
}): boolean {
  if (hasLabel(result.label)) return isSeriesLabel(result.label)
  return (result.childCount ?? 0) > 0
}
