// Client-safe Watch content-kind helpers. Keep this module dependency-free so
// card and carousel components can classify their lean content projections
// without importing the server-side Admin data layer.

// The discriminator is intentionally defensive: Admin labels are uppercase,
// legacy labels were lowercase, and unlabeled server records can fall back to
// their children. Explicitly widen the Set to string so the normalized lookup
// does not depend on a literal-union cast.
const SERIES_LABEL_VALUES = new Set<string>(["collection", "series"])

export type WatchSeriesRecordCandidate = {
  label?: string | null
  children?: readonly { documentId: string }[] | null
}

export function isSeriesRecord(record: WatchSeriesRecordCandidate): boolean {
  const label = record.label
  if (label) return SERIES_LABEL_VALUES.has(String(label).toLowerCase())
  return (record.children?.length ?? 0) > 0
}
