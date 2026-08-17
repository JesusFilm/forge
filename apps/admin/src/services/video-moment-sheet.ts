// The beat-sheet file contract shared by the generator (producer) and the
// loader (consumer) for human-reviewed video story beats — the R4 review
// artifact of docs/plans/2026-08-17-001-feat-jesus-film-story-beat-explore-
// enrichment-plan.md. One schema, one validator, imported by both scripts so
// their discriminators cannot drift (producer-consumer report-file contract
// law, docs/solutions/best-practices/producer-consumer-report-file-contract-
// pattern-20260506.md).

import { z } from "zod"

export const BEAT_SHEET_VERSION = 1

/** Mirrors apps/tv MAX_REFERENCES_PER_MOMENT — the panel drops refs past 4. */
export const MAX_REFERENCES_PER_BEAT = 4

/**
 * SOURCE OF TRUTH: apps/tv/src/lib/moments/parseBibleReference.ts
 * (REFERENCE_PATTERN). Duplicated byte-for-byte because the TV parser decides
 * what renders: a reference that fails it is SILENTLY INVISIBLE on device
 * while the load reports success. The fixtures in video-moment-sheet.test.ts
 * are copied from parseBibleReference.test.ts so a drift on either side goes
 * red here.
 */
export const TV_REFERENCE_PATTERN =
  /^\s*([1-3]?\s?[A-Za-z][A-Za-z .'’-]*?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?\s*$/

/**
 * Canonical English book names, STRICTER than the TV parser on purpose: TV
 * parses any word run as a book, so an abbreviation ("Luk") or misspelling
 * renders a right-looking citation that 404s — or worse, a wrong-but-valid
 * name fetches the WRONG passage. Generated content must name books exactly.
 */
export const CANONICAL_BOOK_NAMES = new Set([
  "Genesis",
  "Exodus",
  "Leviticus",
  "Numbers",
  "Deuteronomy",
  "Joshua",
  "Judges",
  "Ruth",
  "1 Samuel",
  "2 Samuel",
  "1 Kings",
  "2 Kings",
  "1 Chronicles",
  "2 Chronicles",
  "Ezra",
  "Nehemiah",
  "Esther",
  "Job",
  "Psalms",
  "Proverbs",
  "Ecclesiastes",
  "Song of Solomon",
  "Isaiah",
  "Jeremiah",
  "Lamentations",
  "Ezekiel",
  "Daniel",
  "Hosea",
  "Joel",
  "Amos",
  "Obadiah",
  "Jonah",
  "Micah",
  "Nahum",
  "Habakkuk",
  "Zephaniah",
  "Haggai",
  "Zechariah",
  "Malachi",
  "Matthew",
  "Mark",
  "Luke",
  "John",
  "Acts",
  "Romans",
  "1 Corinthians",
  "2 Corinthians",
  "Galatians",
  "Ephesians",
  "Philippians",
  "Colossians",
  "1 Thessalonians",
  "2 Thessalonians",
  "1 Timothy",
  "2 Timothy",
  "Titus",
  "Philemon",
  "Hebrews",
  "James",
  "1 Peter",
  "2 Peter",
  "1 John",
  "2 John",
  "3 John",
  "Jude",
  "Revelation",
])

export type ReferenceIssue = {
  reference: string
  reason: "unparseable" | "unknown-book" | "invalid-range"
}

/**
 * Validate one reference against BOTH gates: the TV parse grammar (what
 * renders at all) and the canonical book allowlist (what fetches the RIGHT
 * passage). Returns null when valid, else the issue.
 */
export function validateBibleReference(
  reference: string,
): ReferenceIssue | null {
  const match = TV_REFERENCE_PATTERN.exec(reference)
  if (match == null) return { reference, reason: "unparseable" }
  const [, rawBook, rawChapter, rawVerseStart, rawVerseEnd] = match
  const bookName = rawBook!.replace(/\s+/g, " ").trim()
  if (!CANONICAL_BOOK_NAMES.has(bookName)) {
    return { reference, reason: "unknown-book" }
  }
  // TV's parser rejects these AFTER the regex (chapter/verse >= 1, end >=
  // start) — mirror every post-match guard or a sheet passes here and drops
  // on device.
  const chapter = Number.parseInt(rawChapter!, 10)
  if (!Number.isFinite(chapter) || chapter < 1) {
    return { reference, reason: "invalid-range" }
  }
  const verseStart =
    rawVerseStart != null ? Number.parseInt(rawVerseStart, 10) : null
  if (verseStart != null && verseStart < 1) {
    return { reference, reason: "invalid-range" }
  }
  if (rawVerseEnd != null) {
    const end = Number.parseInt(rawVerseEnd, 10)
    if (verseStart == null || end < verseStart) {
      return { reference, reason: "invalid-range" }
    }
  }
  return null
}

export const BeatSchema = z
  .object({
    beatIndex: z.number().int().min(0),
    startSeconds: z.number().min(0),
    endSeconds: z.number().min(0).nullable(),
    summary: z.string().trim().min(1),
    bibleVerses: z.array(z.string()).max(MAX_REFERENCES_PER_BEAT),
    question: z.string().trim().min(1).nullable(),
  })
  .strict()

export const BeatSheetSchema = z
  .object({
    version: z.literal(BEAT_SHEET_VERSION),
    videoSlug: z.string().trim().min(1),
    /** BCP-47, matching video_transcript.language — NOT the "english" slug. */
    languageSlug: z.string().trim().min(1),
    sourceModel: z.string().nullable(),
    sourceTranscriptId: z.string().nullable(),
    /** Empty until a human signs the sheet. The loader refuses "" — the R4
     *  review gate is structural, not procedural. */
    reviewedBy: z.string(),
    reviewedAt: z.string().nullable(),
    beats: z.array(BeatSchema).min(1),
  })
  .strict()

export type BeatSheet = z.infer<typeof BeatSheetSchema>
export type Beat = z.infer<typeof BeatSchema>

export type BeatSheetIssue =
  | { kind: "schema"; message: string }
  | { kind: "reference"; beatIndex: number; issue: ReferenceIssue }
  | { kind: "beat-order"; message: string }
  | { kind: "timing"; message: string }
  | { kind: "unsigned"; message: string }

export type BeatSheetValidation =
  | { ok: true; sheet: BeatSheet; issues: [] }
  | { ok: false; sheet: BeatSheet | null; issues: BeatSheetIssue[] }

/**
 * Full content validation, shared by generator (before writing the artifact)
 * and loader (before touching the database).
 *
 * `requireSigned` is the loader's posture; the generator emits unsigned
 * sheets by design, so it validates with `requireSigned: false`.
 */
export function validateBeatSheet(
  raw: unknown,
  { requireSigned }: { requireSigned: boolean },
): BeatSheetValidation {
  const parsed = BeatSheetSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      sheet: null,
      issues: parsed.error.issues.map((issue) => ({
        kind: "schema",
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      })),
    }
  }
  const sheet = parsed.data
  const issues: BeatSheetIssue[] = []

  sheet.beats.forEach((beat, position) => {
    if (beat.beatIndex !== position) {
      issues.push({
        kind: "beat-order",
        message: `beats[${position}] has beatIndex ${beat.beatIndex}; indexes must be contiguous from 0 in file order`,
      })
    }
    if (beat.endSeconds != null && beat.endSeconds < beat.startSeconds) {
      issues.push({
        kind: "timing",
        message: `beats[${position}] endSeconds ${beat.endSeconds} precedes startSeconds ${beat.startSeconds}`,
      })
    }
    for (const reference of beat.bibleVerses) {
      const issue = validateBibleReference(reference)
      if (issue != null) {
        issues.push({ kind: "reference", beatIndex: position, issue })
      }
    }
  })

  for (let i = 1; i < sheet.beats.length; i += 1) {
    if (sheet.beats[i]!.startSeconds <= sheet.beats[i - 1]!.startSeconds) {
      issues.push({
        kind: "timing",
        message: `beats[${i}] startSeconds must be strictly increasing (the TV panel needs ≥2 distinct anchors for timed mode, and duplicate anchors make jump targets ambiguous)`,
      })
    }
  }

  if (requireSigned && sheet.reviewedBy.trim().length === 0) {
    issues.push({
      kind: "unsigned",
      message:
        "reviewedBy is empty — a human must review and sign the sheet before it can be loaded (plan R4)",
    })
  }

  return issues.length === 0
    ? { ok: true, sheet, issues: [] }
    : { ok: false, sheet, issues }
}

/** The human-readable review artifact — one table a reviewer reads top to
 *  bottom and corrects in the JSON. */
export function renderBeatSheetMarkdown(sheet: BeatSheet): string {
  const clock = (seconds: number) => {
    const total = Math.floor(seconds)
    const m = Math.floor(total / 60)
    const s = total % 60
    return `${m}:${String(s).padStart(2, "0")}`
  }
  const lines = [
    `# Beat sheet — ${sheet.videoSlug} (${sheet.languageSlug})`,
    "",
    `Generated by: ${sheet.sourceModel ?? "hand-written"}`,
    `Review status: ${sheet.reviewedBy.trim() ? `signed by ${sheet.reviewedBy}` : "UNSIGNED — edit the JSON, then fill reviewedBy/reviewedAt to sign"}`,
    "",
    "| # | Time | Story beat | Scripture | Question |",
    "| - | ---- | ---------- | --------- | -------- |",
    ...sheet.beats.map(
      (beat) =>
        [
          `| ${beat.beatIndex}`,
          `${clock(beat.startSeconds)}${beat.endSeconds != null ? `–${clock(beat.endSeconds)}` : ""}`,
          beat.summary.replaceAll("|", "\\|"),
          beat.bibleVerses.join("; ") || "—",
          (beat.question ?? "—").replaceAll("|", "\\|"),
        ].join(" | ") + " |",
    ),
    "",
  ]
  return lines.join("\n")
}
