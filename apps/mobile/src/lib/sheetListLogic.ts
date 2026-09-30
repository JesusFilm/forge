// Pure decision logic for the searchable list-sheet shell (SearchableListSheet).
// Filtering, current-section assembly, and the double-tap debounce decision live
// here so they're unit-testable once and shared by all three sheets.

export const SHEET_DOUBLE_TAP_WINDOW_MS = 500

// Accept a row tap only once per window; the ref/clock stay with the caller so a
// timestamp (not a latched boolean) can't dead-lock taps if a dismiss is interrupted.
export function acceptSheetTap(nowMs: number, lastAcceptedMs: number): boolean {
  return nowMs - lastAcceptedMs >= SHEET_DOUBLE_TAP_WINDOW_MS
}

export type SheetListParams<T> = {
  rows: T[]
  // Selection identity to match/exclude the active row. Keyed on a stable slug or
  // documentId, never bcp47 — `ko` collides with `ko-kmr`. Null/"" ⇒ no active row.
  activeId: string | null
  query: string
  getSelectionId: (item: T) => string
  getPrimaryLabel: (item: T) => string
  getSearchValues: (item: T) => (string | null | undefined)[]
  // Keep `rows` in the caller's order instead of sorting them by primary label.
  keepRowOrder?: boolean
}

export type SheetListResult<T> = {
  active: T | null
  filtered: T[]
}

// Sort by primary label (unless the caller keeps its order), resolve the active
// row, then filter by query and drop the active row from the list (it renders in
// the "Current" section instead).
export function assembleSheetList<T>({
  rows,
  activeId,
  query,
  getSelectionId,
  getPrimaryLabel,
  getSearchValues,
  keepRowOrder = false,
}: SheetListParams<T>): SheetListResult<T> {
  const byLabel = (a: T, b: T) =>
    getPrimaryLabel(a)
      .toLowerCase()
      .localeCompare(getPrimaryLabel(b).toLowerCase())
  const isActive = (item: T) => getSelectionId(item) === activeId

  // Sort only the matches, so that when two rows share the id, the first by
  // label wins in both orders.
  const active = rows.filter(isActive).sort(byLabel)[0] ?? null

  let list = keepRowOrder ? rows : [...rows].sort(byLabel)
  if (query.trim()) {
    const lower = query.toLowerCase()
    list = list.filter((item) =>
      getSearchValues(item).some(
        (value) => value != null && value.toLowerCase().includes(lower),
      ),
    )
  }
  const filtered = list.filter((item) => !isActive(item))
  return { active, filtered }
}
