// KTD7: pure builders feeding section renderers with wire-conformant block
// models (the same typed shapes the SDUI normalizer emits), so the watch page
// reuses the Experience renderers. Returning null omits the whole section
// (heading + body) — U5 contract.

import {
  BIBLE_IMAGES,
  JOIN_BIBLE_STUDY_URL,
  PROMO_IMAGE_URL,
} from "../../lib/bibleContent"
import type {
  BibleQuotesCarouselBlockModel,
  RelatedQuestionsBlockModel,
  TextBlockModel,
} from "../../lib/normalizer"
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
): TextBlockModel | null {
  const trimmed = description?.trim()
  if (!trimmed) return null
  return {
    kind: "text",
    __typename: "TextBlock",
    sectionKey: null,
    textHeading: null,
    headingLevel: null,
    subtitle: null,
    contentParagraphs: [trimmed],
    textVariant: null,
  }
}

// ── Study questions → RelatedQuestionsRenderer block ───────────────

/**
 * RelatedQuestionsRenderer input from study questions, or null when none. Rows
 * key on their index; `answer` is empty — the data has no inline answers; the
 * QR / CTA-on-expand handoff is layered by the screen, not here.
 */
export function buildRelatedQuestionsBlock(
  studyQuestions: readonly WatchStudyQuestion[] | null | undefined,
): RelatedQuestionsBlockModel | null {
  if (!studyQuestions || studyQuestions.length === 0) return null
  const questions = studyQuestions
    .map((q) => ({
      question: q.value,
      answer: "",
    }))
    .filter((q) => q.question.length > 0)
  if (questions.length === 0) return null
  return {
    kind: "relatedQuestions",
    __typename: "RelatedQuestionsBlock",
    sectionKey: null,
    rqHeading: "Related Questions",
    ctaLabel: null,
    ctaLink: null,
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

type BibleQuoteCard = NonNullable<
  BibleQuotesCarouselBlockModel["quotes"]
>[number] & { id: string }

/**
 * BibleQuotesCarouselRenderer input from bible citations, or null when none have
 * a usable reference. Verse text comes from the `verses` map (by documentId);
 * a "Join Our Bible Study" promo card closes the rail — same set mobile/web use.
 */
export function buildBibleQuotesBlock(
  bibleCitations: readonly WatchBibleCitation[] | null | undefined,
  verses: Record<string, string> = {},
): BibleQuotesCarouselBlockModel | null {
  if (!bibleCitations || bibleCitations.length === 0) return null
  const quotes = bibleCitations
    .map((c, i): BibleQuoteCard | null => {
      const reference = formatCitationReference(c)
      if (reference == null) return null
      return {
        id: String(i),
        reference,
        text: verses[c.documentId] ?? "",
        attribution: null,
        imageUrl: BIBLE_IMAGES[i % BIBLE_IMAGES.length],
        backgroundColor: null,
        ctaLabel: null,
        ctaLink: null,
      }
    })
    .filter((q): q is BibleQuoteCard => q != null)
  if (quotes.length === 0) return null
  quotes.push({
    id: "promo",
    reference: "Free Resources",
    text: "Want to explore life's biggest questions?",
    attribution: null,
    imageUrl: PROMO_IMAGE_URL,
    backgroundColor: null,
    ctaLabel: "Join Our Bible Study",
    ctaLink: JOIN_BIBLE_STUDY_URL,
  })
  return {
    kind: "bibleQuotesCarousel",
    __typename: "BibleQuotesCarouselBlock",
    sectionKey: null,
    bqcHeading: "Bible Quotes",
    quotes,
  }
}
