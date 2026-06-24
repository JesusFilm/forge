// Image-windowing (Android home perf): every rail mounts its full card tree (so
// D-pad focus always has a target), but cards in off-window rails skip the image
// decode. Decoding ~50 card images per frame pinned the weak Chromecast home.

/**
 * Rows: 0 is the hero (mounted separately), 1..N are the section rails.
 * `focusedRow` is the focused row (hero / top bar = 0); a rail is active (loads
 * its images) when within `buffer` rows of it. `buffer` must be >= 1 so the next
 * rail's images are warm before D-pad focus reaches it.
 */
export function isRailActive(
  rowIndex: number,
  focusedRow: number,
  buffer: number,
): boolean {
  return Math.abs(rowIndex - focusedRow) <= buffer
}
