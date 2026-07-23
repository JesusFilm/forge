import { readFileSync } from "node:fs"
import path from "node:path"
import { repoRoot } from "./repo-root"

import { getDevotionalCorpusDir } from "../../config/env"

/**
 * World English Bible (WEB, public domain) verse lookup — so devotional
 * scripture is the EXACT verse text, not model-recalled. Verses are keyed osis
 * (e.g. "Luke.8.24") in `devo/corpus/web-bible.json` (Gospels + Acts).
 *
 * Pure parsing/lookup; loading is a thin fs wrapper (same corpus dir + override
 * as reflection-corpus).
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

// ---- Loading (fs) ----------------------------------------------------------

function defaultCorpusDir(): string {
  // cwd-walk root — correct in source AND the mastra bundle (see repo-root.ts).
  return path.join(repoRoot(), "devo/corpus")
}

let cache: { dir: string; bible: WebBible } | null = null

export function loadWebBible(dir?: string): WebBible {
  const resolved = dir ?? getDevotionalCorpusDir() ?? defaultCorpusDir()
  if (cache && cache.dir === resolved) return cache.bible
  let bible: WebBible = { verses: {} }
  try {
    const raw = readFileSync(path.join(resolved, "web-bible.json"), "utf8")
    const parsed = JSON.parse(raw) as { verses?: Record<string, string> }
    bible = { verses: parsed.verses ?? {} }
  } catch {
    bible = { verses: {} }
  }
  cache = { dir: resolved, bible }
  return bible
}

/** Convenience: exact WEB text for a reference using the loaded (cached) bible. */
export function getVerseText(reference: string, dir?: string): string | null {
  return lookupVerse(reference, loadWebBible(dir).verses)
}
