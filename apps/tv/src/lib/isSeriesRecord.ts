// SYNC: adapted from apps/mobile. Series-shaped = the LABEL says so. Divergence
// from mobile: label matching is STRICT UPPERCASE (wire sends uppercase enums;
// case-folding lets mocked lowercase fixtures pass falsely).
//
// Children deliberately do NOT make a video series-shaped. Feature films carry
// their own chapter clips as children (JESUS: 61, Book of Acts: 73) while being
// single playable films, so counting children sent all 10 such titles to the
// series screen — which billed them "SERIES" and played their full runtime as a
// "trailer". The label is the only signal separating a container from a film.
//
// This is the ONE series predicate, on purpose. `resolveWatchRedirect` (/watch →
// /series) and `resolveLeafBounce` (/series → /watch) are inverses; a second
// predicate with a different rule is what split them and caused the above.
const SERIES_LABELS = new Set(["SERIES", "COLLECTION"])

export function isSeriesLabel(label: string | null | undefined): boolean {
  return label != null && SERIES_LABELS.has(label)
}
