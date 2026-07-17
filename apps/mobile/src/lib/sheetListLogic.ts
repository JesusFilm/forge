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
}

export type SheetListResult<T> = {
  active: T | null
  filtered: T[]
}

// Sort by primary label, resolve the active row, then filter by query and drop the
// active row from the list (it renders in the "Current" section instead).
export function assembleSheetList<T>({
  rows,
  activeId,
  query,
  getSelectionId,
  getPrimaryLabel,
  getSearchValues,
}: SheetListParams<T>): SheetListResult<T> {
  const sorted = [...rows].sort((a, b) =>
    getPrimaryLabel(a)
      .toLowerCase()
      .localeCompare(getPrimaryLabel(b).toLowerCase()),
  )
  const active =
    sorted.find((item) => getSelectionId(item) === activeId) ?? null

  let list = sorted
  if (query.trim()) {
    const lower = query.toLowerCase()
    list = sorted.filter((item) =>
      getSearchValues(item).some(
        (value) => value != null && value.toLowerCase().includes(lower),
      ),
    )
  }
  const filtered = list.filter((item) => getSelectionId(item) !== activeId)
  return { active, filtered }
}
