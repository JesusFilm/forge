/** One part of a list sheet row's status line, e.g. "Downloaded". */
export type StatusPart = {
  text: string
  /** Drawn in bold. */
  strong?: boolean
}

/** The line's visual separator. A screen reader gets commas instead. */
export const STATUS_PART_SEPARATOR = " • "

/** The parts as one phrase for a row's accessibility label. */
export function statusPartsLabel(parts: readonly StatusPart[]): string {
  return parts.map((part) => part.text).join(", ")
}
