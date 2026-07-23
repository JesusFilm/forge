import { readFileSync } from "node:fs"
import path from "node:path"
import { repoRoot } from "./repo-root"

import { getDevotionalCorpusDir } from "../../config/env"

/**
 * Reflection corpus reader + matcher.
 *
 * Given a clip's Bible passage (osis form, e.g. "Luke.8.22-Luke.8.25"), returns
 * the right public-domain source's text for the reflection step to adapt:
 *   - Matthew passages  → J.C. Ryle, Expository Thoughts (verse-range sections)
 *   - Mark/Luke/John    → Matthew Henry, Commentary (whole-chapter)
 * (Spurgeon is loaded for future thematic use but not part of passage routing.)
 *
 * Matching (`matchReflection`) is pure and file-free so it is trivially tested;
 * loading is a thin fs wrapper. Corpora live in `devo/corpus` by default,
 * overridable with `DEVOTIONAL_CORPUS_DIR` for bundled deploys.
 */

export type ReflectionEntry = {
  source: string
  reference: string
  osisRef: string | null
  text: string
  /** The quoted verse (Spurgeon entries carry this; used for theme scoring). */
  verse?: string
  book?: string
  chapter?: number
}

export type ReflectionCorpora = {
  ryleMatthew: ReflectionEntry[]
  matthewHenry: ReflectionEntry[]
  spurgeon: ReflectionEntry[]
}

export type ReflectionMatch = {
  source: string
  /** The corpus entry's own reference (e.g. "Matthew 8:23-27" or "Luke 8"). */
  reference: string
  osisRef: string | null
  text: string
  /** The passage we matched against (echoed for the modernizer's focus). */
  focusReference: string
}

export type OsisParts = { book: string; chapter: number; verse: number | null }

/** Parse the START of an osis ref: "Luke.8.22-Luke.8.25" → {Luke,8,22}. */
export function parseOsis(osis: string): OsisParts | null {
  const first = osis.split("-")[0]?.trim()
  if (!first) return null
  const m = first.match(/^([1-3]?[A-Za-z]+)\.(\d+)(?:\.(\d+))?$/)
  if (!m) return null
  return {
    book: m[1],
    chapter: Number(m[2]),
    verse: m[3] != null ? Number(m[3]) : null,
  }
}

/** A comparable ordinal for (chapter, verse); missing verse = start of chapter. */
function ordinal(chapter: number, verse: number | null): number {
  return chapter * 1000 + (verse ?? 0)
}

/** Does an entry's osisRef range cover the target chapter/verse? */
function rangeCovers(
  osisRef: string | null,
  chapter: number,
  verse: number | null,
): boolean {
  if (!osisRef) return false
  const [startRaw, endRaw] = osisRef.split("-")
  const start = parseOsis(startRaw)
  const end = endRaw ? parseOsis(endRaw) : start
  if (!start || !end) return false
  const target = ordinal(chapter, verse)
  // When the target has no verse, match on chapter overlap alone.
  if (verse == null) return chapter >= start.chapter && chapter <= end.chapter
  return (
    target >= ordinal(start.chapter, start.verse ?? 0) &&
    target <= ordinal(end.chapter, end.verse ?? Number.MAX_SAFE_INTEGER)
  )
}

const OSIS_TO_BOOK = new Set(["Matt", "Mark", "Luke", "John"])

/**
 * Match a passage to the best reflection source. Pure. Returns null when the
 * passage is outside the Gospels or nothing covers it.
 */
export function matchReflection(
  passageOsis: string,
  corpora: Pick<ReflectionCorpora, "ryleMatthew" | "matthewHenry">,
): ReflectionMatch | null {
  const parts = parseOsis(passageOsis)
  if (!parts || !OSIS_TO_BOOK.has(parts.book)) return null

  if (parts.book === "Matt") {
    // Prefer the section whose verse-range covers the passage; else the first
    // section of that chapter.
    const covering = corpora.ryleMatthew.find((e) =>
      rangeCovers(e.osisRef, parts.chapter, parts.verse),
    )
    const chapterFirst =
      covering ??
      corpora.ryleMatthew.find((e) =>
        rangeCovers(e.osisRef, parts.chapter, null),
      )
    if (!chapterFirst) return null
    return {
      source: chapterFirst.source,
      reference: chapterFirst.reference,
      osisRef: chapterFirst.osisRef,
      text: chapterFirst.text,
      focusReference: passageOsis,
    }
  }

  // Mark / Luke / John → Matthew Henry whole-chapter.
  const chapterId = `${parts.book}.${parts.chapter}`
  const entry = corpora.matthewHenry.find((e) => e.osisRef === chapterId)
  if (!entry) return null
  return {
    source: entry.source,
    reference: entry.reference,
    osisRef: entry.osisRef,
    text: entry.text,
    focusReference: passageOsis,
  }
}

// ---- Spurgeon (thematic) + rotating selection ------------------------------

/**
 * Match a Spurgeon Morning & Evening entry by THEME (not passage). Spurgeon is
 * keyed to his own verses, so we score each entry by how many of the clip's
 * theme keywords appear — weighting the entry's verse over its body. Ties rotate
 * by `sequence` for variety. Returns null when nothing scores.
 */
export function scoreSpurgeonByTheme(
  themes: string[],
  spurgeon: ReflectionEntry[],
): { e: ReflectionEntry; score: number }[] {
  if (!themes?.length || spurgeon.length === 0) return []
  const keys = themes.map((t) => t.toLowerCase()).filter(Boolean)
  return spurgeon
    .map((e) => {
      const verse = (e.verse ?? "").toLowerCase()
      const body = e.text.toLowerCase()
      let score = 0
      for (const k of keys) {
        if (verse.includes(k)) score += 2
        else if (body.includes(k)) score += 1
      }
      return { e, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
}

export function matchSpurgeonTheme(
  themes: string[],
  spurgeon: ReflectionEntry[],
  sequence = 0,
): ReflectionEntry | null {
  const scored = scoreSpurgeonByTheme(themes, spurgeon)
  if (scored.length === 0) return null
  const top = scored[0].score
  const best = scored.filter((x) => x.score === top)
  const i = ((Math.trunc(sequence) % best.length) + best.length) % best.length
  return best[i].e
}

/** Keyword shortlist (top-N by theme score) for an LLM ranker to choose from. */
export function shortlistSpurgeonByTheme(
  themes: string[],
  spurgeon: ReflectionEntry[],
  n = 12,
): ReflectionEntry[] {
  return scoreSpurgeonByTheme(themes, spurgeon)
    .slice(0, Math.max(1, n))
    .map((x) => x.e)
}

export type ReflectionFlavor = "commentary" | "spurgeon"

export type ReflectionSelection = ReflectionMatch & { flavor: ReflectionFlavor }

export type SelectReflectionInput = {
  /** Clip passage in osis form, e.g. "Luke.8.22-Luke.8.25". */
  passageOsis: string
  /** Human reference for the modernizer's focus, e.g. "Luke 8:22-25". */
  reference?: string
  /** Theme keywords for Spurgeon matching. */
  themes: string[]
  /** Monotonic counter; even → commentary, odd → Spurgeon (with fallback). */
  sequence: number
}

/**
 * Choose the reflection for a devotional, ROTATING between two flavors so all
 * sources get used and devotionals vary:
 *   - "commentary" — Ryle (Matthew) / Matthew Henry (Mark/Luke/John) on the
 *     clip's exact passage.
 *   - "spurgeon"   — a Spurgeon Morning & Evening entry matched to the theme.
 * Even `sequence` prefers commentary, odd prefers Spurgeon; each falls back to
 * the other so a devotional always gets a reflection.
 */
export function selectReflection(
  input: SelectReflectionInput,
  corpora: ReflectionCorpora,
): ReflectionSelection | null {
  const focus = input.reference ?? input.passageOsis
  const commentary = (): ReflectionSelection | null => {
    const m = matchReflection(input.passageOsis, corpora)
    return m ? { ...m, flavor: "commentary", focusReference: focus } : null
  }
  const spurgeon = (): ReflectionSelection | null => {
    const e = matchSpurgeonTheme(input.themes, corpora.spurgeon, input.sequence)
    return e
      ? {
          flavor: "spurgeon",
          source: e.source,
          reference: e.reference,
          osisRef: e.osisRef,
          text: e.text,
          // Spurgeon entries are already short + self-contained: focus on the
          // entry's own verse, not the clip passage.
          focusReference: e.reference,
        }
      : null
  }

  const preferSpurgeon = Math.trunc(input.sequence) % 2 !== 0
  const primary = preferSpurgeon ? spurgeon() : commentary()
  if (primary) return primary
  return preferSpurgeon ? commentary() : spurgeon()
}

// ---- Loading (fs) ----------------------------------------------------------

function defaultCorpusDir(): string {
  // cwd-walk root: works in source (tsx/vitest) AND the mastra dev/build bundle
  // (import.meta.url no longer points at the source tree there). Override with
  // DEVOTIONAL_CORPUS_DIR on a deploy that doesn't ship devo/corpus.
  return path.join(repoRoot(), "devo/corpus")
}

function readCorpus(dir: string, file: string): ReflectionEntry[] {
  try {
    const raw = readFileSync(path.join(dir, file), "utf8")
    const parsed = JSON.parse(raw) as { entries?: ReflectionEntry[] }
    return parsed.entries ?? []
  } catch {
    return []
  }
}

let cache: { dir: string; corpora: ReflectionCorpora } | null = null

export function loadReflectionCorpora(dir?: string): ReflectionCorpora {
  const resolved = dir ?? getDevotionalCorpusDir() ?? defaultCorpusDir()
  if (cache && cache.dir === resolved) return cache.corpora
  const corpora: ReflectionCorpora = {
    ryleMatthew: readCorpus(resolved, "ryle-matthew.json"),
    matthewHenry: readCorpus(resolved, "matthew-henry-gospels.json"),
    spurgeon: readCorpus(resolved, "spurgeon-morning-evening.json"),
  }
  cache = { dir: resolved, corpora }
  return corpora
}

/** Convenience: load (cached) + match in one call. */
export function findReflection(
  passageOsis: string,
  dir?: string,
): ReflectionMatch | null {
  return matchReflection(passageOsis, loadReflectionCorpora(dir))
}
