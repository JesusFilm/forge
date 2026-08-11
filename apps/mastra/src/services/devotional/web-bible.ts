import { z } from "zod"

/**
 * World English Bible (WEB, public domain) verse lookup — so devotional
 * scripture is the EXACT verse text, not model-recalled. Verses are keyed osis
 * (e.g. "Luke.8.24") in a selected Workspace source (Gospels + Acts).
 *
 * Pure parsing/lookup. Workspace discovery and verified reads are injected by
 * the attempt repository; there is no process-local cache or repo fallback.
 */

export type WebBible = { verses: Record<string, string> }

const BOOK_TO_OSIS: Record<string, string> = {
  matthew: "Matt",
  matt: "Matt",
  mark: "Mark",
  luke: "Luke",
  john: "John",
  acts: "Acts",
}

const WebBibleSchema = z
  .object({
    translation: z.string().trim().min(1).max(200).optional(),
    abbreviation: z.string().trim().min(1).max(32).optional(),
    license: z.string().trim().min(1).max(100).optional(),
    sourceUrl: z.string().trim().url().max(2_048).optional(),
    books: z.array(z.string().trim().min(1).max(64)).min(1).max(66).optional(),
    verseCount: z.number().int().positive().optional(),
    verses: z.record(z.string().trim().min(1), z.string().trim().min(1)),
  })
  .strict()
  .superRefine((document, context) => {
    if (
      document.verseCount != null &&
      document.verseCount !== Object.keys(document.verses).length
    ) {
      context.addIssue({
        code: "custom",
        path: ["verseCount"],
        message: "verseCount must equal verses size",
      })
    }
  })

function referenceFromContentPath(path: string): string | null {
  const match =
    /^\/inputs\/scripture\/([^/]+)\/([1-9]\d*)-([1-9]\d*)\.(?:md|txt|ya?ml)$/iu.exec(
      path,
    )
  if (!match) return null
  const osis = BOOK_TO_OSIS[match[1]!.toLowerCase().replace(/[.\s]/gu, "")]
  if (!osis) return null
  return `${osis}.${Number(match[2])}.${Number(match[3])}`
}

export function parseWebBibleDocument(options: {
  path: string
  content: string
}): WebBible {
  try {
    if (options.path.toLowerCase().endsWith(".json")) {
      const { verses } = WebBibleSchema.parse(JSON.parse(options.content))
      return { verses }
    }
    const content = options.content.trim()
    const reference = referenceFromContentPath(options.path)
    if (!content || !reference)
      throw new Error("invalid content-only scripture")
    return { verses: { [reference]: content } }
  } catch (error) {
    throw new Error(`${options.path}: invalid WEB scripture source`, {
      cause: error,
    })
  }
}

export type RefParts = {
  osis: string
  chapter: number
  startVerse: number
  endVerse: number
}

/** Parse a human reference: "Luke 8:24" or "Luke 8:24-25" → parts (Gospels/Acts). */
export function parseReference(reference: string): RefParts | null {
  const m = reference
    .trim()
    .match(/^([1-3]?\s?[A-Za-z.]+)\s+(\d+):(\d+)(?:[-–](\d+))?$/)
  if (!m) return null
  const bookKey = m[1].toLowerCase().replace(/[.\s]/g, "")
  const osis = BOOK_TO_OSIS[bookKey]
  if (!osis) return null
  const chapter = Number(m[2])
  const startVerse = Number(m[3])
  const endVerse = m[4] != null ? Number(m[4]) : startVerse
  if (endVerse < startVerse) return null
  return { osis, chapter, startVerse, endVerse }
}

/**
 * Exact WEB text for a reference (single verse or small range), joined. Returns
 * null when the book is outside the ingested set or any verse is missing (the
 * caller then falls back to the model's text, flagged unverified).
 */
export function lookupVerse(
  reference: string,
  verses: Record<string, string>,
): string | null {
  const parts = parseReference(reference)
  if (!parts) return null
  const out: string[] = []
  for (let v = parts.startVerse; v <= parts.endVerse; v++) {
    const t = verses[`${parts.osis}.${parts.chapter}.${v}`]
    if (!t) return null
    out.push(t)
  }
  return out.length ? out.join(" ") : null
}
