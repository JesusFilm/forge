// The reading typeface (feat-551 KTD16, R32). No font asset ships: iOS draws
// Georgia and Android its system serif. The serif covers Latin, Greek, and
// Cyrillic; any other script falls back to the platform font.
import type { ReaderLineSpacing, ReaderTypeface } from "../settings/snapshot"

export const READER_LINE_HEIGHT_FACTORS: Readonly<
  Record<ReaderLineSpacing, number>
> = Object.freeze({ compact: 1.2, normal: 1.35, relaxed: 1.6 })

/** Code point ranges that the platform serif draws, besides ASCII. */
const SERIF_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x052f], // Latin, Greek, Cyrillic, and their marks
  [0x1c80, 0x1c8f], // Cyrillic Extended-C
  [0x1d00, 0x1fff], // phonetic extensions, Latin Extended Additional, Greek
  [0x2000, 0x2bff], // punctuation, symbols, arrows
  [0x2c60, 0x2c7f], // Latin Extended-C
  [0x2de0, 0x2dff], // Cyrillic Extended-A
  [0xa640, 0xa69f], // Cyrillic Extended-B
  [0xa720, 0xa7ff], // Latin Extended-D
  [0xab30, 0xab6f], // Latin Extended-E
  [0xfb00, 0xfb06], // Latin ligatures
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // byte order mark
]

function inSerifRange(codePoint: number): boolean {
  return SERIF_RANGES.some(
    ([first, last]) => codePoint >= first && codePoint <= last,
  )
}

/** True when every character is one that the platform serif draws. */
export function usesReadingTypeface(text: string): boolean {
  for (const character of text) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && !inSerifRange(codePoint)) return false
  }
  return true
}

export function readingFontFamily(
  typeface: ReaderTypeface,
  text: string,
  platform: string,
): string {
  if (typeface === "sans" || !usesReadingTypeface(text)) return "System"
  return platform === "ios" ? "Georgia" : "serif"
}

export function verseLineHeight(
  size: number,
  spacing: ReaderLineSpacing,
): number {
  return Math.round(size * READER_LINE_HEIGHT_FACTORS[spacing])
}
