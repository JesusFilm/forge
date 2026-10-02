// The reader's labels (feat-553 R9, R21, R25, R41, R42, KTD19). Each number is
// the SHOWN translation's own verse number, and the counter keys by verse
// number, not list index: T4T John 4 has 50 stops but 54 verses.
import type { UiT } from "../../../i18n/useT"
import { clamp } from "../../scrubber"
import type { CatalogTranslation } from "../data/catalog"
import type { ShownTranslation } from "../language/defaultTranslation"
import type { TranslationDownloadState } from "../repository/translationDownloads"
import { verseThrough } from "../text/positions"
import type { ChapterPosition } from "../text/types"

/** The reader's words (KTD2): helpers take the caller's `t`. */
export type ReaderT = UiT<"BibleReader">

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
  t: ReaderT,
  stop: ChapterPosition,
  lastVerse: number,
): string {
  const { first, last } = stopRange(stop)
  return first === last
    ? t("verseCounterAriaLabel", { verse: first, total: lastVerse })
    : t("versesCounterAriaLabel", { first, last, total: lastVerse })
}

/** The position in the chapter, from 0 to 1, by the last verse covered. */
export function chapterProgress(
  stop: ChapterPosition,
  lastVerse: number,
): number {
  if (lastVerse <= 0) return 0
  return clamp(stopRange(stop).last / lastVerse, 0, 1)
}

/** R18: the verse number at a point on the bar; `chapterProgress` reversed. */
export function verseAtProgress(fraction: number, lastVerse: number): number {
  if (lastVerse < 1 || !Number.isFinite(fraction)) return 1
  return clamp(Math.round(fraction * lastVerse), 1, lastVerse)
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
  /** The shown translation's short name (R25: it names what shows). */
  text: string
  accessibilityLabel: string
  /** R25, R41: why a stand-in shows, or null for the viewer's own pick. The
   *  info button beside the pill shows it (owner, 2026-09-28). */
  note: string | null
  /** Which stand-in the note is for. The text can change while a book name
   *  loads; the key does not, so an open tip stays open. */
  noteKey: string | null
}

/** The translation pill's ring while a download runs (owner, 2026-10-01). */
export type PillDownloadStatus = { kind: "downloading"; progress: number }

// Only a running download shows. The owner dropped a cloud-check for a
// finished one (2026-10-01); the translation sheet's card still shows it.
export function pillDownloadStatus(
  state: TranslationDownloadState | null,
): PillDownloadStatus | null {
  if (state?.kind !== "downloading") return null
  return { kind: "downloading", progress: clamp(state.percent / 100, 0, 1) }
}

function pillStatusWords(
  t: ReaderT,
  state: TranslationDownloadState | null,
): string | undefined {
  const status = pillDownloadStatus(state)
  return status
    ? t("translationDownloadingAriaStatus", {
        percent: Math.round(status.progress * 100),
      })
    : undefined
}

// The top bar's translation pill. It has room for the short name only, so the
// reason for a stand-in is a note. `viewerTranslation` is the rules' choice
// before the book check; `bookName` is the book as the shown text names it.
export function translationLabel(
  t: ReaderT,
  shown: ShownTranslation,
  viewerTranslation: CatalogTranslation | null,
  bookName: string,
  /** The shown translation's download, which the pill shows. */
  download: TranslationDownloadState | null = null,
): TranslationLabel {
  const { name, shortName } = shown.translation
  const status = pillStatusWords(t, download)
  const label = {
    text: shortName,
    accessibilityLabel: status
      ? t("translationWithStatusAriaLabel", { name, status })
      : t("translationAriaLabel", { name }),
  }
  const noteKey = `${shown.reason}:${shown.translation.id}`
  switch (shown.reason) {
    case "viewer":
      return { ...label, note: null, noteKey: null }
    case "book-fallback":
      return {
        ...label,
        note: viewerTranslation
          ? t("bookFallbackNote", {
              viewerName: viewerTranslation.name,
              bookName,
              shownName: name,
            })
          : t("bookFallbackNoteUnnamed", { bookName, shownName: name }),
        noteKey,
      }
    case "offline-stand-in":
      return {
        ...label,
        note: t("offlineStandInNote", { shownName: name }),
        noteKey,
      }
  }
}

/** The download button's label (R29, R30), on the translation sheet's card. */
export function downloadLabel(
  t: ReaderT,
  state: TranslationDownloadState,
  translation: CatalogTranslation,
): string {
  const { name } = translation
  switch (state.kind) {
    case "bundled":
    case "downloaded":
      return t("downloadOnDeviceAriaLabel", { name })
    case "downloading":
      return t("downloadRunningAriaLabel", {
        name,
        percent: Math.round(state.percent),
      })
    case "failed":
      return t("downloadFailedAriaLabel", { name })
    case "checking":
    case "not-downloaded":
      return t("downloadAriaLabel", { name })
  }
}
