// Pure builders that turn a normalized WatchVideoRecord's content into the
// NormalizedBlock-shaped inputs the existing section renderers consume. The
// renderers read TV's ALIASED field names off the block (rqHeading, textHeading,
// bqcHeading + per-item arrays), so these adapters reproduce exactly those keys
// — see RelatedQuestionsRenderer / TextRenderer / BibleQuotesCarouselRenderer.
//
// KTD7: feed the existing renderers via small adapter objects rather than
// rebuilding them. Study questions carry no inline answers (the data has none),
// so answers are empty strings; Bible citations render at reference level for v1
// (synthesized reference, empty verse text). Returning null when there are no
// items lets the screen omit the whole section (heading + body) — the degraded
// contract in U5.

import type { NormalizedBlock } from "../../lib/normalizer"
import type {
  WatchBibleCitation,
  WatchStudyQuestion,
} from "../../lib/normalizeVideo"

// ── Description → TextRenderer block ───────────────────────────────

/**
 * Build the TextRenderer input from the video description, or null when there's
 * no usable description. `textHeading` is null (the description stands alone
 * under the title); `contentParagraphs` is the renderer's `string[]` field.
 */
export function buildDescriptionBlock(
  description: string | null | undefined,
): NormalizedBlock | null {
  const trimmed = description?.trim()
  if (!trimmed) return null
  return {
    kind: "text",
    __typename: "TextBlock",
    textHeading: null,
    contentParagraphs: [trimmed],
  }
}

// ── Study questions → RelatedQuestionsRenderer block ───────────────

/**
 * Build the RelatedQuestionsRenderer input from the video's study questions, or
 * null when there are none. Each question gets a per-question stable `id` (its
 * index) and an empty `answer` — the data carries no inline answers; the QR /
 * CTA-on-expand handoff is layered by the screen, not here.
 */
export function buildRelatedQuestionsBlock(
  studyQuestions: readonly WatchStudyQuestion[] | null | undefined,
): NormalizedBlock | null {
  if (!studyQuestions || studyQuestions.length === 0) return null
  const questions = studyQuestions
    .map((q, i) => ({
      id: String(i),
      question: q.value,
      answer: "",
    }))
    .filter((q) => q.question.length > 0)
  if (questions.length === 0) return null
  return {
    kind: "relatedQuestions",
    __typename: "RelatedQuestionsBlock",
    rqHeading: "Related Questions",
    questions,
  }
}

// ── Bible citations → BibleQuotesCarouselRenderer block ────────────

/**
 * Synthesize a human-readable reference from a citation's book / chapter / verse
 * range. v1 is reference-level only — full verse text is a deferred follow-up.
 * Returns null when there isn't even a book name to anchor the reference.
 */
export function formatCitationReference(c: WatchBibleCitation): string | null {
  if (!c.bookName) return null
  const chapter = c.chapterStart
  if (chapter == null) return c.bookName

  const verse = c.verseStart
  const verseEnd =
    c.verseEnd != null && c.verseEnd !== c.verseStart ? c.verseEnd : null

  // Same chapter, verse range: "John 3:16-18". Single verse: "John 3:16".
  // Chapter only: "John 3".
  if (verse == null) return `${c.bookName} ${chapter}`
  if (verseEnd != null) return `${c.bookName} ${chapter}:${verse}-${verseEnd}`
  return `${c.bookName} ${chapter}:${verse}`
}

/**
 * Build the BibleQuotesCarouselRenderer input from the video's bible citations,
 * or null when there are none with a usable reference. Reference-level for v1:
 * each quote has a synthesized `reference` and an empty `text`.
 */
export function buildBibleQuotesBlock(
  bibleCitations: readonly WatchBibleCitation[] | null | undefined,
): NormalizedBlock | null {
  if (!bibleCitations || bibleCitations.length === 0) return null
  const quotes = bibleCitations
    .map((c, i) => ({
      id: String(i),
      reference: formatCitationReference(c),
      text: "",
    }))
    .filter(
      (q): q is { id: string; reference: string; text: string } =>
        q.reference != null,
    )
  if (quotes.length === 0) return null
  return {
    kind: "bibleQuotesCarousel",
    __typename: "BibleQuotesCarouselBlock",
    bqcHeading: "Bible Quotes",
    quotes,
  }
}
