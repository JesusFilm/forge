// The verse selection (feat-553 U9, R19, R42): one run of stops in one chapter
// of one translation, kept in that translation's own verse numbers. A gap stop
// is never selected, but a run can pass over one, as a verse move does (R21).
import { chapterLabel, stopRange } from "../reader/labels"
import type { ChapterPosition, Verse } from "../text/types"

export type VerseSelection = {
  /** The chapter that holds the selection (`selectionChapterKey`). */
  chapterKey: string
  /** The first and the last verse number that the selection covers. */
  first: number
  last: number
}

/** The shown chapter, in the shown translation's numbers. */
export type SelectionChapter = {
  translationId: string
  book: string
  chapter: number
}

/** A new key is a new chapter or translation, which ends the selection. */
export function selectionChapterKey(place: SelectionChapter): string {
  return `${place.translationId}|${place.book}|${place.chapter}`
}

type StopRun = { from: number; to: number }

/** The run's stop indices, or null when the stops do not hold it. */
function selectedRun(
  selection: VerseSelection | null,
  stops: readonly ChapterPosition[],
): StopRun | null {
  if (!selection) return null
  const from = stops.findIndex(
    (stop) =>
      stop.kind === "verse" && stopRange(stop).first === selection.first,
  )
  const to = stops.findIndex(
    (stop) => stop.kind === "verse" && stopRange(stop).last === selection.last,
  )
  return from === -1 || to < from ? null : { from, to }
}

/** True when only gap stops lie between the two indices. */
function onlyGapsBetween(
  stops: readonly ChapterPosition[],
  low: number,
  high: number,
): boolean {
  return stops.slice(low + 1, high).every((stop) => stop.kind === "gap")
}

/** The nearest verse stop from `start`, in `step`'s direction, up to `end`. */
function verseStopFrom(
  stops: readonly ChapterPosition[],
  start: number,
  step: 1 | -1,
  end: number,
): number {
  let index = start
  while (index !== end && stops[index]?.kind === "gap") index += step
  return index
}

function runSelection(
  stops: readonly ChapterPosition[],
  run: StopRun,
  chapterKey: string,
): VerseSelection | null {
  const first = stops[run.from]
  const last = stops[run.to]
  if (!first || !last) return null
  return {
    chapterKey,
    first: stopRange(first).first,
    last: stopRange(last).last,
  }
}

// R19: a tap next to the selection extends it, a tap on a selected verse cuts
// the run there and keeps the part before it, and any other tap starts a new
// run. A selection from another chapter counts as none.
export function tapStop(
  selection: VerseSelection | null,
  stops: readonly ChapterPosition[],
  stopIndex: number,
  chapterKey: string,
): VerseSelection | null {
  const tapped = stops[stopIndex]
  if (!tapped || tapped.kind === "gap") return selection
  const current = selection?.chapterKey === chapterKey ? selection : null
  const run = selectedRun(current, stops)
  const single = { from: stopIndex, to: stopIndex }
  if (!run) return runSelection(stops, single, chapterKey)
  if (stopIndex >= run.from && stopIndex <= run.to) {
    if (run.from === run.to) return null
    const kept =
      stopIndex === run.from
        ? { from: verseStopFrom(stops, run.from + 1, 1, run.to), to: run.to }
        : {
            from: run.from,
            to: verseStopFrom(stops, stopIndex - 1, -1, run.from),
          }
    return runSelection(stops, kept, chapterKey)
  }
  if (stopIndex > run.to && onlyGapsBetween(stops, run.to, stopIndex)) {
    return runSelection(stops, { from: run.from, to: stopIndex }, chapterKey)
  }
  if (stopIndex < run.from && onlyGapsBetween(stops, stopIndex, run.from)) {
    return runSelection(stops, { from: stopIndex, to: run.to }, chapterKey)
  }
  return runSelection(stops, single, chapterKey)
}

/** True for a verse stop inside the selection; a gap stop is never selected. */
export function isStopSelected(
  selection: VerseSelection | null,
  stops: readonly ChapterPosition[],
  stopIndex: number,
): boolean {
  const run = selectedRun(selection, stops)
  const stop = stops[stopIndex]
  return (
    run !== null &&
    stop?.kind === "verse" &&
    stopIndex >= run.from &&
    stopIndex <= run.to
  )
}

/** The selected stops that have text, in order; gap notes are left out. */
export function selectedVerseStops(
  selection: VerseSelection | null,
  stops: readonly ChapterPosition[],
): Extract<ChapterPosition, { kind: "verse" }>[] {
  const run = selectedRun(selection, stops)
  if (!run) return []
  return stops
    .slice(run.from, run.to + 1)
    .filter(
      (stop): stop is { kind: "verse"; verse: Verse } => stop.kind === "verse",
    )
}

/** "John 3:16" or "John 3:16-17", in the shown translation's numbers (R42). */
export function selectionReference(
  bookName: string,
  chapter: number,
  selection: VerseSelection,
): string {
  const { first, last } = selection
  const verses = first === last ? `${first}` : `${first}-${last}`
  return `${chapterLabel(bookName, chapter)}:${verses}`
}
