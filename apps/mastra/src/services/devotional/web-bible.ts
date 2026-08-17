import { z } from "zod"

/**
 * World English Bible (WEB, public domain) verse lookup — so devotional
 * scripture is the EXACT verse text, not model-recalled. Verses are keyed osis
 * (e.g. "Luke.8.24") in the Workspace at `/inputs/scripture/web-bible.json`
 * (Gospels + Acts). The repository copy under `devotional-workspace/` is the
 * migration seed for that path, not a runtime fallback.
 *
 * Pure parsing/lookup. Workspace discovery and verified reads are injected by
 * the attempt repository; there is no process-local cache or repo fallback.
 */

export type WebBible = { verses: Record<string, string> }

const WebBibleSchema = z
  .object({
    verses: z.record(z.string().trim().min(1), z.string().trim().min(1)),
  })
  .strict()

export function parseWebBibleDocument(options: {
  path: string
  content: string
}): WebBible {
  try {
    return WebBibleSchema.parse(JSON.parse(options.content))
  } catch (error) {
    throw new Error(`${options.path}: invalid WEB scripture source`, {
      cause: error,
    })
  }
}

const BOOK_TO_OSIS: Record<string, string> = {
  matthew: "Matt",
  matt: "Matt",
  mark: "Mark",
  luke: "Luke",
  john: "John",
  acts: "Acts",
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
