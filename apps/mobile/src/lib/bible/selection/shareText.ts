// The text that Copy and Share send (feat-553 U9, R19, R42): the selected
// verses, then the reference and the translation. Every number is the shown
// translation's own number, and a missing-verse note is never sent (R21).
import { verseRangeLabel } from "../reader/labels"
import type { ChapterPosition } from "../text/types"
import {
  selectedVerseStops,
  selectionReference,
  type VerseSelection,
} from "./selection"

export type ShareTextInput = {
  /** The shown translation's own book name (the chapter header). */
  bookName: string
  /** The chapter number in the shown translation's numbers. */
  chapter: number
  /** The catalog's short name, such as "BSB". */
  shortName: string
  stops: readonly ChapterPosition[]
  selection: VerseSelection
}

export function shareText(input: ShareTextInput): string {
  const verses = selectedVerseStops(input.selection, input.stops)
  // Poetry keeps its line breaks; prose runs on as one paragraph.
  const poetry = verses.some((stop) =>
    stop.verse.lines.some((line) => line.poem !== undefined),
  )
  const separator = poetry ? "\n" : " "
  const numbered = verses.length > 1
  const body = verses
    .map((stop) => {
      const text = stop.verse.lines.map((line) => line.text).join(separator)
      return numbered ? `${verseRangeLabel(stop)} ${text}` : text
    })
    .join(separator)
  const reference = selectionReference(
    input.bookName,
    input.chapter,
    input.selection,
  )
  return `${body}\n\n${reference} · ${input.shortName}`
}
