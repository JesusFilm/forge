// KTD7: pure builders feeding the existing section renderers via adapter objects
// that reproduce TV's ALIASED block keys (rqHeading/textHeading/bqcHeading + per-
// item arrays) — see RelatedQuestions/Text/BibleQuotesCarousel renderers.
//
// Study questions have no inline answers (empty strings); bible verse text comes
// via the useBibleVerses fetch map with stock Unsplash backgrounds cycled by
// index. Returning null omits the whole section (heading + body) — U5 contract.

import {
  BIBLE_IMAGES,
  JOIN_BIBLE_STUDY_URL,
  PROMO_IMAGE_URL,
} from "../../lib/bibleContent"
import type { NormalizedBlock } from "../../lib/normalizer"
import type {
  WatchBibleCitation,
  WatchStudyQuestion,
} from "../../lib/normalizeVideo"

// ── Description → TextRenderer block ───────────────────────────────

/**
 * TextRenderer input from the video description, or null when none. `textHeading`
 * is null (description stands alone under the title); `contentParagraphs` is the
 * renderer's `string[]` field.
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
 * RelatedQuestionsRenderer input from study questions, or null when none. Each
 * gets a stable `id` (its index) and empty `answer` — the data has no inline
 * answers; the QR / CTA-on-expand handoff is layered by the screen, not here.
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
 * range. Returns null when there isn't even a book name to anchor the reference.
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

type BibleQuoteCard = {
  id: string
  reference: string
  text: string
  imageUrl: string
  ctaLabel?: string
  ctaLink?: string
}

/**
 * BibleQuotesCarouselRenderer input from bible citations, or null when none have
 * a usable reference. Verse text comes from the `verses` map (by documentId,
 * empty while loading) over stock bgs cycled by index; a "Join Our Bible Study"
 * promo card closes the rail — same card set mobile/web render here.
 */
export function buildBibleQuotesBlock(
  bibleCitations: readonly WatchBibleCitation[] | null | undefined,
  verses: Record<string, string> = {},
): NormalizedBlock | null {
  if (!bibleCitations || bibleCitations.length === 0) return null
  const quotes = bibleCitations
    .map((c, i): BibleQuoteCard | null => {
      const reference = formatCitationReference(c)
      if (reference == null) return null
      return {
        id: String(i),
        reference,
        text: verses[c.documentId] ?? "",
        imageUrl: BIBLE_IMAGES[i % BIBLE_IMAGES.length],
      }
    })
    .filter((q): q is BibleQuoteCard => q != null)
  if (quotes.length === 0) return null
  quotes.push({
    id: "promo",
    reference: "Free Resources",
    text: "Want to explore life's biggest questions?",
    imageUrl: PROMO_IMAGE_URL,
    ctaLabel: "Join Our Bible Study",
    ctaLink: JOIN_BIBLE_STUDY_URL,
  })
  return {
    kind: "bibleQuotesCarousel",
    __typename: "BibleQuotesCarouselBlock",
    bqcHeading: "Bible Quotes",
    quotes,
  }
}
