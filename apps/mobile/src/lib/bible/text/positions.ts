import type { Chapter, ChapterPosition, Verse } from "./types"

/** The last verse number that a verse's text covers. */
export function verseThrough(verse: Verse): number {
  return verse.through ?? verse.number
}

/**
 * Every reader stop in the chapter, in order. A merged range is one stop,
 * and each number that no verse covers is a gap stop (R21, KTD19).
 */
export function chapterPositions(chapter: Chapter): ChapterPosition[] {
  const positions: ChapterPosition[] = []
  let next = 1
  for (const verse of chapter.verses) {
    for (let number = next; number < verse.number; number += 1) {
      positions.push({ kind: "gap", number })
    }
    positions.push({ kind: "verse", verse })
    next = verseThrough(verse) + 1
  }
  for (let number = next; number <= chapter.lastVerse; number += 1) {
    positions.push({ kind: "gap", number })
  }
  return positions
}
