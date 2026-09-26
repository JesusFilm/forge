// The Bible reader's Datadog events (feat-553 KTD18, R37). Every attribute is
// `reader_`-prefixed, because Datadog drops a custom `source`. No context holds
// verse text, a response body, or personal data.
import { useEffect, useState } from "react"

import { datadogLog } from "../datadog"
import type { CatalogTranslation } from "./data/catalog"
import type { ChapterFailure } from "./repository/errors"
import type {
  ChapterAddress,
  ChapterFetchResult,
} from "./repository/fetchChapter"
import type { DownloadOutcome } from "./repository/translationDownloads"
import type { ReaderPushSource } from "./routes/readerRoute"
import { mappedLastVerse } from "./versification/convert"
import { translationBookSystem } from "./versification/translationSystems.generated"

/** How a reader visit began: a pushed route's source, or the Bible tab. */
export type ReaderOpenSource = ReaderPushSource | "tab"

/** A translation pick (R23), or R31's switch to a translation on the device. */
export type ReaderTranslationChange = "picked" | "switched"

export function reportTranslationChanged(
  change: ReaderTranslationChange,
  fromId: string | null,
  toId: string,
): void {
  datadogLog.info("bible_reader.translation_changed", {
    reader_change: change,
    reader_from_translation_id: fromId ?? "none",
    reader_to_translation_id: toId,
  })
}

/** The bytes are the catalog size, which every outcome knows (R29). */
export function reportTranslationDownload(
  translation: Pick<CatalogTranslation, "id" | "downloadBytes">,
  outcome: DownloadOutcome,
): void {
  datadogLog.info("bible_reader.download", {
    reader_translation_id: translation.id,
    reader_outcome: outcome.status,
    reader_reason: outcome.status === "failed" ? outcome.reason : "none",
    reader_download_bytes: translation.downloadBytes,
  })
}

// Named fields only: a failure has no body today, and a spread of the result
// would send one the day a failure carries it (KTD3).
function reportChapterFetchFailed(
  address: ChapterAddress,
  failure: ChapterFailure,
): void {
  datadogLog.warn("bible_reader.chapter_fetch_failed", {
    reader_translation_id: address.translationId,
    reader_book: address.bookId,
    reader_chapter: address.chapter,
    reader_reason: failure.reason,
    reader_http_status: failure.httpStatus ?? 0,
  })
}

export type ChapterFetch = (
  address: ChapterAddress,
) => Promise<ChapterFetchResult>

/** Reports each failed network fetch once. The repository shares one fetch
 *  between the two reader hosts, so a shared failure logs once. */
export function withFetchFailureReport(fetch: ChapterFetch): ChapterFetch {
  return async (address) => {
    const result = await fetch(address)
    if (result.status === "failed") reportChapterFetchFailed(address, result)
    return result
  }
}

const reportedMismatches = new Set<string>()

/** KTD6: a shown chapter whose last verse differs from its system's count. */
export function checkChapterNumbering(
  address: ChapterAddress,
  lastVerse: number,
): void {
  const { translationId, bookId, chapter } = address
  const system = translationBookSystem(translationId, bookId)
  const mapped = mappedLastVerse(system, bookId, chapter)
  if (mapped === lastVerse) return
  const key = `${translationId}|${bookId}|${chapter}`
  if (reportedMismatches.has(key)) return
  reportedMismatches.add(key)
  datadogLog.warn("bible_reader.versification_mismatch", {
    reader_translation_id: translationId,
    reader_book: bookId,
    reader_chapter: chapter,
    reader_system: system,
    // 0: the system has no such chapter.
    reader_mapped_last_verse: mapped ?? 0,
    reader_actual_last_verse: lastVerse,
  })
}

/** Test-only: forget the reported mismatches. */
export function resetReaderTelemetryForTests(): void {
  reportedMismatches.clear()
}

export type ReaderVisitTracker = {
  /** The reader's screen took the focus: a new visit, or a return from a sheet. */
  focus(source: ReaderOpenSource): void
  /** The screen lost the focus: the visit ends, unless its own sheet took it. */
  blur(): void
  /** The reader opens one of its three sheets; the next blur keeps the visit. */
  markSheetOpen(): void
  /** The verse on screen, as a BSB position key; null while none shows. */
  showVerse(key: string | null): void
  /** A real unmount ends the visit one microtask later. */
  scheduleEnd(): void
  /** A setup right after a cleanup is StrictMode's check, not an unmount. */
  cancelEnd(): void
}

type Visit = {
  source: ReaderOpenSource
  verses: Set<string>
  /** True while one of the reader's own sheets covers it. */
  away: boolean
}

/** R37: one open and one end per visit, and the verses shown in between. */
export function createReaderVisitTracker(): ReaderVisitTracker {
  let visit: Visit | null = null
  let sheetOpening = false
  let shownVerse: string | null = null
  let endPending = false

  function end(): void {
    const ended = visit
    visit = null
    sheetOpening = false
    if (!ended) return
    datadogLog.info("bible_reader.visit_ended", {
      reader_source: ended.source,
      reader_verse_count: ended.verses.size,
    })
  }

  return {
    focus(source) {
      sheetOpening = false
      if (visit) {
        visit.away = false
        if (shownVerse) visit.verses.add(shownVerse)
        return
      }
      visit = {
        source,
        verses: new Set(shownVerse ? [shownVerse] : []),
        away: false,
      }
      datadogLog.info("bible_reader.opened", { reader_source: source })
    },
    blur() {
      if (!visit || visit.away) return
      if (sheetOpening) {
        sheetOpening = false
        visit.away = true
        return
      }
      end()
    },
    markSheetOpen() {
      if (visit && !visit.away) sheetOpening = true
    },
    showVerse(key) {
      shownVerse = key
      if (key && visit && !visit.away) visit.verses.add(key)
    },
    scheduleEnd() {
      endPending = true
      void Promise.resolve().then(() => {
        if (!endPending) return
        endPending = false
        end()
      })
    },
    cancelEnd() {
      endPending = false
    },
  }
}

export type ReaderVisitInput = {
  focused: boolean
  source: ReaderOpenSource
  /** The shown verse as a BSB position key; null while none shows. */
  verseKey: string | null
}

/** A visit runs from focus to blur, per reader host (U14). */
export function useReaderVisitTelemetry(
  input: ReaderVisitInput,
): Pick<ReaderVisitTracker, "markSheetOpen"> {
  const { focused, source, verseKey } = input
  const [tracker] = useState(createReaderVisitTracker)
  // Before the focus effect, so a new visit counts the verse on screen.
  useEffect(() => {
    tracker.showVerse(verseKey)
  }, [tracker, verseKey])
  useEffect(() => {
    if (focused) tracker.focus(source)
    else tracker.blur()
  }, [tracker, focused, source])
  useEffect(() => {
    tracker.cancelEnd()
    return () => tracker.scheduleEnd()
  }, [tracker])
  return tracker
}
