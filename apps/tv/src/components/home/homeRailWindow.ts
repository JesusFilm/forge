// Android mounts rails incrementally and loads images near focus to keep Home
// responsive. tvOS keeps every rail mounted and active.

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

export function homeRailRenderCount(
  platform: string,
  mountedCount: number,
  focusedRow: number,
  total: number,
): number {
  return platform === "android"
    ? Math.min(total, Math.max(mountedCount, focusedRow + 2))
    : total
}
