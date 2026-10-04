// The reader's moves as one hook (feat-553 U8, KTD19). Swipes, the arrow pair,
// and the screen reader's actions all call it, so every input moves the same
// way. The pill animation and the chapter announcement fire from the result.
import { useEffect, useState } from "react"
import { AccessibilityInfo } from "react-native"

import { useT } from "../../../i18n/useT"
import { chapterLabel, type ReaderT } from "../reader/labels"
import type { BookNames } from "../repository/bookNames"
import { bookByUsfm, type UsfmBookId } from "../text/books"
import type { ChapterPosition } from "../text/types"
import { BSB_TRANSLATION_ID } from "../versification/classify"
import type { VerseRef } from "../versification/convert"
import type { SwipeAxis } from "./gesture"
import {
  moveChapter,
  moveVerse,
  neighborChapter,
  translationNumbering,
  type MoveDirection,
  type MoveResult,
} from "./move"

/** R14's and R13's words stay on screen this long. */
export const READER_NOTICE_MS = 2500

/** Where the reader stands, in the shown translation's numbers. */
export type MovePlace = {
  book: UsfmBookId
  chapter: number
  translationId: string
  /** The shown translation's name for the book. */
  bookName: string
  /** Its names for the other books; null or a missing book reads BSB's. */
  bookNames?: BookNames | null
  /** Null until the chapter text is ready; chapter moves work without it. */
  stops: readonly ChapterPosition[] | null
  stopIndex: number | null
}

export type ReaderNotice = { id: number; text: string }

/** One move; the verse slides on each new id (owner, 2026-09-25). A chapter
 *  swipe slides sideways (owner, 2026-09-28); no axis means a verse move. */
export type VerseSlide = {
  id: number
  direction: MoveDirection
  axis?: SwipeAxis
}

export type ReaderMovement = {
  moveVerse(direction: MoveDirection): void
  moveChapter(direction: MoveDirection): void
  /** R13: the chapter a sideways swipe opens, or the words for a Bible end. */
  chapterPreview(direction: MoveDirection): string | null
  /** Counts chapter changes; the pill animates on each new value (R39). */
  pulse: number
  /** The last verse move that moved; a move at a Bible end does not. */
  slide: VerseSlide | null
  notice: ReaderNotice | null
}

export type ReaderMovementInput = {
  place: MovePlace | null
  /** `useReaderChapter`'s goTo: the target is in `translationId`'s numbers. */
  goTo: (target: VerseRef, translationId: string) => void
  /** KD18: the first verse move retires the hint. */
  onVerseMove: () => void
}

/** The book name in the shown translation; BSB's when it has none. */
function nameOf(place: MovePlace, book: UsfmBookId, chapter: number): string {
  const name =
    book === place.book
      ? place.bookName
      : (place.bookNames?.get(book) ?? bookByUsfm(book).name)
  return chapterLabel(name, chapter)
}

function endText(
  t: ReaderT,
  axis: "verse" | "chapter",
  edge: "start" | "end",
): string {
  if (axis === "verse") {
    return edge === "start" ? t("noVerseBefore") : t("noVerseAfter")
  }
  return edge === "start" ? t("noChapterBefore") : t("noChapterAfter")
}

export function useReaderMovement(input: ReaderMovementInput): ReaderMovement {
  const { place, goTo, onVerseMove } = input
  const t = useT("BibleReader")
  const [pulse, setPulse] = useState(0)
  const [slide, setSlide] = useState<VerseSlide | null>(null)
  const [notice, setNotice] = useState<ReaderNotice | null>(null)

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), READER_NOTICE_MS)
    return () => clearTimeout(timer)
  }, [notice])

  function apply(
    result: MoveResult,
    from: MovePlace,
    axis: "verse" | "chapter",
  ) {
    switch (result.kind) {
      case "verse":
        goTo(result.ref, from.translationId)
        return
      case "chapter": {
        const { ref, numbering } = result.target
        goTo(
          ref,
          numbering === "shown" ? from.translationId : BSB_TRANSLATION_ID,
        )
        setPulse((count) => count + 1)
        AccessibilityInfo.announceForAccessibility(
          t("chapterOpenedAriaAnnouncement", {
            chapter: nameOf(from, ref.book, ref.chapter),
          }),
        )
        return
      }
      case "stop": {
        const text = endText(t, axis, result.edge)
        setNotice((previous) => ({ id: (previous?.id ?? 0) + 1, text }))
        AccessibilityInfo.announceForAccessibility(text)
      }
    }
  }

  return {
    moveVerse(direction) {
      if (!place?.stops || place.stopIndex === null) return
      onVerseMove()
      const result = moveVerse({
        book: place.book,
        chapter: place.chapter,
        stops: place.stops,
        stopIndex: place.stopIndex,
        direction,
        numbering: translationNumbering(place.translationId),
      })
      if (result.kind !== "stop") {
        setSlide((previous) => ({
          id: (previous?.id ?? 0) + 1,
          direction,
          axis: "verse",
        }))
      }
      apply(result, place, "verse")
    },
    moveChapter(direction) {
      if (!place) return
      const result = moveChapter({
        book: place.book,
        chapter: place.chapter,
        direction,
        numbering: translationNumbering(place.translationId),
      })
      if (result.kind !== "stop") {
        setSlide((previous) => ({
          id: (previous?.id ?? 0) + 1,
          direction,
          axis: "chapter",
        }))
      }
      apply(result, place, "chapter")
    },
    chapterPreview(direction) {
      if (!place) return null
      const next = neighborChapter(
        place.book,
        place.chapter,
        direction,
        translationNumbering(place.translationId),
      )
      if (!next)
        return endText(t, "chapter", direction === "forward" ? "end" : "start")
      return nameOf(place, next.book, next.chapter)
    },
    pulse,
    slide,
    notice,
  }
}
