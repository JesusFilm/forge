import { z } from "zod"

/**
 * Reflection corpus reader + matcher.
 *
 * Given a clip's Bible passage (osis form, e.g. "Luke.8.22-Luke.8.25"), returns
 * the right public-domain source's text for the reflection step to adapt:
 *   - Matthew passages  → J.C. Ryle, Expository Thoughts (verse-range sections)
 *   - Mark/Luke/John    → Matthew Henry, Commentary (whole-chapter)
 * (Spurgeon is loaded for future thematic use but not part of passage routing.)
 *
 * Matching is pure. Workspace inventory/catalog code owns discovery and live
 * reads; this module only validates a selected document and runs algorithms.
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
  /**
   * Passage-keyed commentary from any source and at any granularity. One pool
   * rather than a bucket per author: `matchReflection` selects by how tightly an
   * entry covers the passage, so a section-granular source (Ryle, ~10 verses)
   * beats a chapter-granular one (Matthew Henry) on merit instead of by name.
   * That is what lets a new commentary volume be added as data alone.
   */
  commentary: ReflectionEntry[]
  /**
   * Theme-keyed entries, matched by keyword and never by passage. Kept apart
   * because such an entry is anchored to its OWN verse: pooled with commentary,
   * its osisRef would make it selectable as a commentary on a passage it never
   * discusses.
   */
  spurgeon: ReflectionEntry[]
}

const ReflectionEntrySchema = z
  .object({
    source: z.string().trim().min(1),
    reference: z.string().trim().min(1),
    osisRef: z.string().trim().min(1).nullable(),
    text: z.string().trim().min(1),
    verse: z.string().trim().min(1).optional(),
    book: z.string().trim().min(1).optional(),
    chapter: z.number().int().positive().optional(),
  })
  .strict()

const ReflectionEntriesSchema = z
  .object({ entries: z.array(ReflectionEntrySchema).min(1) })
  .strict()

/** Parse a selected JSON corpus file. Content-only prose is a single eligible
 * entry whose source/reference come from the selected Workspace path. */
export function parseReflectionDocument(options: {
  path: string
  content: string
}): ReflectionEntry[] {
  const content = options.content.trim()
  if (!content) throw new Error(`${options.path}: reflection source is empty`)
  if (options.path.toLowerCase().endsWith(".json")) {
    try {
      return ReflectionEntriesSchema.parse(JSON.parse(content)).entries
    } catch (error) {
      throw new Error(`${options.path}: invalid reflection corpus`, {
        cause: error,
      })
    }
  }
  const name = options.path
    .split("/")
    .at(-1)
    ?.replace(/\.[^.]+$/, "")
  if (!name) throw new Error(`${options.path}: invalid reflection path`)
  return [
    {
      source: name,
      reference: name,
      osisRef: null,
      text: content,
    },
  ]
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

/** Above any real verse number, so it bounds a range at its chapter's end. */
const LAST_VERSE_IN_CHAPTER = 999

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
  // A verse-less END bound means "to the end of THAT chapter", never open-ended:
  // `Number.MAX_SAFE_INTEGER` here would make a chapter-level entry such as
  // `Luke.8` cover every later chapter too, so Henry on Luke 8 would answer a
  // Luke 24 passage. Latent until commentary was pooled and matched by range;
  // the old Mark/Luke/John branch compared chapter ids exactly and never asked.
  return (
    target >= ordinal(start.chapter, start.verse ?? 0) &&
    target <= ordinal(end.chapter, end.verse ?? LAST_VERSE_IN_CHAPTER)
  )
}

/** How many verses an entry's range spans; a chapter-level ref spans it all. */
function verseSpan(osisRef: string): number {
  const [startRaw, endRaw] = osisRef.split("-")
  const start = parseOsis(startRaw)
  const end = endRaw ? parseOsis(endRaw) : start
  if (!start || !end) return Number.MAX_SAFE_INTEGER
  if (start.verse == null || end.verse == null) return Number.MAX_SAFE_INTEGER
  return ordinal(end.chapter, end.verse) - ordinal(start.chapter, start.verse)
}

/**
 * Match a passage to the best commentary entry. Pure. Returns null when nothing
 * in the pool covers it — which is a real outcome, not an error: the JESUS-film
 * catalogue includes a Genesis prologue that the Gospel volumes cannot serve.
 * Callers that reserve a clip must check this FIRST (see
 * `chaptersWithReflectionSource`); `composeDevotionalContent` throws on null.
 *
 * Preference is specificity, never authorship: the narrowest range that covers
 * the passage wins, so Ryle's per-pericope sections are chosen over Matthew
 * Henry's whole-chapter treatment of the same verses, and Henry remains the
 * fallback wherever no section covers them. There is no book allowlist — the
 * pool itself decides which books are servable, so adding a volume admits its
 * book with no code change.
 */
export function matchReflection(
  passageOsis: string,
  corpora: Pick<ReflectionCorpora, "commentary">,
): ReflectionMatch | null {
  const parts = parseOsis(passageOsis)
  if (!parts) return null

  const inBook = corpora.commentary.filter(
    (entry) =>
      entry.osisRef != null && parseOsis(entry.osisRef)?.book === parts.book,
  )
  if (inBook.length === 0) return null

  const chapterId = `${parts.book}.${parts.chapter}`
  const chapterLevel = inBook.find((entry) => entry.osisRef === chapterId)

  // A passage with no verse names a whole chapter, so the chapter-level
  // treatment is the tightest honest fit; picking the narrowest section instead
  // would answer a chapter-wide passage with one arbitrary pericope.
  const covering =
    parts.verse == null
      ? chapterLevel
      : [...inBook]
          .filter((entry) =>
            rangeCovers(entry.osisRef, parts.chapter, parts.verse),
          )
          .sort(
            (left, right) =>
              verseSpan(left.osisRef!) - verseSpan(right.osisRef!),
          )[0]

  const entry =
    covering ??
    chapterLevel ??
    inBook.find((candidate) =>
      rangeCovers(candidate.osisRef, parts.chapter, null),
    )
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
