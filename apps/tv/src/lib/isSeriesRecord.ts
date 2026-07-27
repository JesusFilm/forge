// Children do NOT make a video series-shaped: feature films carry their own
// chapter clips (JESUS 61), so counting them billed 10 films as series. The ONE
// predicate — a second one is what split the two redirect seams and caused that.
// STRICT UPPERCASE, unlike mobile: case-folding lets lowercase fixtures pass falsely.
const SERIES_LABELS = new Set(["SERIES", "COLLECTION"])

export function isSeriesLabel(label: string | null | undefined): boolean {
  return label != null && SERIES_LABELS.has(label)
}
