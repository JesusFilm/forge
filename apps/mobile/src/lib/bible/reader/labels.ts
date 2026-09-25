// The reader's labels (feat-551 R9, R21, R25, R41, R42, KTD19). Each number is
// the SHOWN translation's own verse number, and the counter keys by verse
// number, not list index: T4T John 4 has 50 stops but 54 verses.
import type { CatalogTranslation } from "../data/catalog"
import type { ShownTranslation } from "../language/defaultTranslation"
import type { TranslationDownloadState } from "../repository/translationDownloads"
import { verseThrough } from "../text/positions"
import type { ChapterPosition } from "../text/types"
import { READER_COPY } from "./copy"

/** The first and last verse numbers that a stop covers. */
export function stopRange(stop: ChapterPosition): {
  first: number
  last: number
} {
  if (stop.kind === "gap") return { first: stop.number, last: stop.number }
  return { first: stop.verse.number, last: verseThrough(stop.verse) }
}

/** The stop that covers `verse`; past the chapter end, the last stop. */
export function stopIndexForVerse(
  positions: readonly ChapterPosition[],
  verse: number,
): number {
  const index = positions.findIndex((stop) => stopRange(stop).last >= verse)
  return index === -1 ? Math.max(positions.length - 1, 0) : index
}

/** "16", or "6-8" for a merged range. */
export function verseRangeLabel(stop: ChapterPosition): string {
  const { first, last } = stopRange(stop)
  return first === last ? `${first}` : `${first}-${last}`
}

/** R9: "verse / total", where the total is the chapter's last verse number. */
export function counterLabel(stop: ChapterPosition, lastVerse: number): string {
  return `${verseRangeLabel(stop)} / ${lastVerse}`
}

export function counterAccessibilityLabel(
  stop: ChapterPosition,
  lastVerse: number,
): string {
  const { first, last } = stopRange(stop)
  return READER_COPY.counter(first, last, lastVerse)
}

/** The position in the chapter, from 0 to 1, by the last verse covered. */
export function chapterProgress(
  stop: ChapterPosition,
  lastVerse: number,
): number {
  if (lastVerse <= 0) return 0
  return Math.min(Math.max(stopRange(stop).last / lastVerse, 0), 1)
}

/** R18: the verse number at a point on the bar; `chapterProgress` reversed. */
export function verseAtProgress(fraction: number, lastVerse: number): number {
  if (lastVerse < 1 || !Number.isFinite(fraction)) return 1
  return Math.min(Math.max(Math.round(fraction * lastVerse), 1), lastVerse)
}

export function chapterLabel(bookName: string, chapter: number): string {
  return `${bookName} ${chapter}`
}

/** The pill's reference, such as "John 3:16" or "John 4:6-8". */
export function passageLabel(
  bookName: string,
  chapter: number,
  stop: ChapterPosition,
): string {
  return `${chapterLabel(bookName, chapter)}:${verseRangeLabel(stop)}`
}

export type TranslationLabel = {
  text: string
  accessibilityLabel: string
  /** R25, R41: the label also says why this translation shows. */
  isFallback: boolean
}

// The footer's translation label. `viewerTranslation` is the rules' choice
// before the book check, when the catalog lists it.
export function translationLabel(
  shown: ShownTranslation,
  viewerTranslation: CatalogTranslation | null,
): TranslationLabel {
  const { name, shortName } = shown.translation
  switch (shown.reason) {
    case "viewer":
      return {
        text: shortName,
        accessibilityLabel: READER_COPY.translation(name),
        isFallback: false,
      }
    case "book-fallback":
      return {
        text: READER_COPY.shownIn(shortName),
        accessibilityLabel: READER_COPY.bookFallback(
          viewerTranslation?.name ?? null,
          name,
        ),
        isFallback: true,
      }
    case "offline-stand-in":
      return {
        text: `${READER_COPY.offlineStandIn} · ${shortName}`,
        accessibilityLabel: READER_COPY.offlineStandInLabel(name),
        isFallback: true,
      }
  }
}

/** The download button's label for the shown translation (R29, R30). */
export function downloadLabel(
  state: TranslationDownloadState,
  translation: CatalogTranslation,
): string {
  const { name } = translation
  switch (state.kind) {
    case "bundled":
    case "downloaded":
      return READER_COPY.download.onDevice(name)
    case "downloading":
      return READER_COPY.download.running(name, Math.round(state.percent))
    case "failed":
      return READER_COPY.download.failed(name)
    case "checking":
    case "not-downloaded":
      return READER_COPY.download.start(name)
  }
}
