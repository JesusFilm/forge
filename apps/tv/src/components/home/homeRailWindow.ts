// Focus-windowed rail mounting (Phase 2 perf): only rails near the focused row
// mount their cards; off-window rails are fixed-height spacers. Drawing all ~8
// rails (~50 images) every frame pinned the weak Chromecast home at ~6fps.

/**
 * Rows: 0 is the hero (mounted separately), 1..N are the section rails.
 * `focusedRow` is the focused row (hero / top bar = 0); a rail is active when
 * within `buffer` rows of it. `buffer` must be >= 1 so the next rail mounts
 * before D-pad focus reaches it (focus never lands on an empty placeholder).
 */
export function isRailActive(
  rowIndex: number,
  focusedRow: number,
  buffer: number,
): boolean {
  return Math.abs(rowIndex - focusedRow) <= buffer
}
