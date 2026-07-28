import type { VideoPipelineCell } from "./video-pipeline-model"
import { formatCellDate } from "./video-pipeline-model"

export function toggleSetMember<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) {
    next.delete(value)
  } else {
    next.add(value)
  }
  return next
}

export function filterCellsByQuery(
  cells: VideoPipelineCell[],
  query: string,
): VideoPipelineCell[] {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return cells

  return cells.filter((cell) => {
    const haystack =
      `${cell.title} ${cell.date} ${formatCellDate(cell.date)}`.toLowerCase()
    return haystack.includes(trimmed)
  })
}
