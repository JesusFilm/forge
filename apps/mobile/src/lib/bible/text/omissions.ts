import type { UsfmBookId } from "./books"

// The API stores a merged range "6-8" as verse 6 alone, so a gap is a merge
// unless the verse is a known omission. BSB's 16 gaps (2026-09-25), plus the
// MAT 12:47 that the API's own parser also lists.
const TEXTUAL_OMISSIONS: ReadonlySet<string> = new Set([
  "MAT 12:47",
  "MAT 17:21",
  "MAT 18:11",
  "MAT 23:14",
  "MRK 7:16",
  "MRK 9:44",
  "MRK 9:46",
  "MRK 11:26",
  "MRK 15:28",
  "LUK 17:36",
  "LUK 23:17",
  "JHN 5:4",
  "ACT 8:37",
  "ACT 15:34",
  "ACT 24:7",
  "ACT 28:29",
  "ROM 16:24",
])

export function isTextualOmission(
  bookId: UsfmBookId,
  chapter: number,
  verse: number,
): boolean {
  return TEXTUAL_OMISSIONS.has(`${bookId} ${chapter}:${verse}`)
}
