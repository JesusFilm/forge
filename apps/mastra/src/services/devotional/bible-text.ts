import { readFileSync } from "node:fs"
import path from "node:path"
import { repoRoot } from "./repo-root"

import { getDevotionalCorpusDir } from "../../config/env"

/**
 * Exact Bible verse lookup, so devotional scripture is the EXACT verse text of
 * a real translation, not model-recalled. Verses are keyed osis (e.g.
 * "Luke.8.24") in `devo/corpus/<abbr>-bible.json` (Gospels + Acts), produced by
 * the ingest scripts in `apps/mastra/src/scripts/`.
 *
 * The series translation is the Berean Standard Bible (BSB): modern English,
 * dedicated to the public domain (CC0) in 2023, so it can be shown, spoken and
 * posted without licence terms or credit lines. It replaced the World English
 * Bible on 2026-09-18 because the WEB read as archaic ("when he has lit a
 * lamp, covers it with a container"); the WEB corpus stays on disk for older
 * devotionals and as a cross-check.
 *
 * Pure parsing/lookup; loading is a thin fs wrapper (same corpus dir + override
 * as reflection-corpus).
 */

export type BibleTranslation = {
  /** Short tag shown after the citation on screen ("LUKE 8:16 · BSB"). */
  abbreviation: string
  name: string
  /** Corpus file under the corpus dir. */
  file: string
}

export const BSB: BibleTranslation = {
  abbreviation: "BSB",
  name: "Berean Standard Bible",
  file: "bsb-bible.json",
}

export const WEB: BibleTranslation = {
  abbreviation: "WEB",
  name: "World English Bible",
  file: "web-bible.json",
}

/** The translation every new devotional quotes. */
export const DEVOTIONAL_BIBLE: BibleTranslation = BSB

export type Bible = { verses: Record<string, string> }

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
 * Exact text for a reference (single verse or small range), joined. Returns
 * null when the book is outside the ingested set or any verse is missing (the
 * caller then falls back to the model's text, flagged unverified). The BSB
 * follows the critical text, so a handful of verses the WEB prints (Matt 17:21,
 * Mark 9:44, John 5:4 and the like) are footnotes there and resolve to null.
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

const cache = new Map<string, Bible>()

export class BibleCorpusMissingError extends Error {
  constructor(translation: BibleTranslation, file: string) {
    super(
      `${translation.name} corpus not found at ${file}. Run ` +
        `node apps/mastra/src/scripts/ingest-${translation.abbreviation.toLowerCase()}-bible.mjs ` +
        `(or set DEVOTIONAL_CORPUS_DIR) before generating devotionals.`,
    )
    this.name = "BibleCorpusMissingError"
  }
}

/**
 * Load a translation's verse map from the corpus dir. A missing corpus is an
 * error, not an empty map: an empty map would make every lookup fall back to
 * the model's own wording, flagged but silent, which is exactly the archaic
 * text and the guesswork the exact-verse rule exists to prevent.
 */
export function loadBible(
  translation: BibleTranslation = DEVOTIONAL_BIBLE,
  dir?: string,
): Bible {
  const resolved = dir ?? getDevotionalCorpusDir() ?? defaultCorpusDir()
  const file = path.join(resolved, translation.file)
  const hit = cache.get(file)
  if (hit) return hit
  let raw: string
  try {
    raw = readFileSync(file, "utf8")
  } catch {
    throw new BibleCorpusMissingError(translation, file)
  }
  const parsed = JSON.parse(raw) as { verses?: Record<string, string> }
  const bible = { verses: parsed.verses ?? {} }
  cache.set(file, bible)
  return bible
}

/** Exact text for a reference in the series translation (cached corpus). */
export function getVerseText(
  reference: string,
  dir?: string,
  translation: BibleTranslation = DEVOTIONAL_BIBLE,
): string | null {
  return lookupVerse(reference, loadBible(translation, dir).verses)
}
