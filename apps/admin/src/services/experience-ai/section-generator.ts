/**
 * Post-response allowlist filter for video-anchored section generation.
 *
 * The mastra `generate-video-section` agent is treated as UNTRUSTED: even though
 * the prompt forbids it, the model could emit a scripture reference or an FAQ
 * question that is not grounded in the anchor video's pack. This filter, run
 * admin-side AFTER the wire response (the pack is admin-owned data), drops any
 * off-pack content so it can never reach the editor / be published:
 *
 *  - SCRIPTURE: a quote survives only if its structured citation identity
 *    (osisId + chapter/verse range) matches one of the pack's real citations —
 *    matched by IDENTITY, never by the fuzzy reference label.
 *  - FAQ: a question survives only if it maps to one of the pack's real study
 *    questions (token-overlap, since the model may lightly rephrase). The
 *    `answer` is model-authored connective prose and is intentionally NOT
 *    allowlisted — it carries an editorial-verification obligation surfaced in
 *    the review ledger (`sourceKind: "needs_verification"`), per R8.
 *
 * Emptied blocks are omitted (never a hollow block). Plain-string log per drop
 * (Railway logsV2 silences JSON.stringify payloads).
 */

import type {
  DraftVideoSection,
  DraftVideoSectionBlock,
} from "@forge/experience-schema"

import type {
  ContextPackCitation,
  VideoContextPack,
} from "./video-context-pack.service"

const FAQ_MATCH_THRESHOLD = 0.4

export type SectionAllowlistOutcome = {
  /** The filtered section blocks (off-pack content removed). */
  blocks: DraftVideoSectionBlock[]
  dropped: { scriptureQuotes: number; faqQuestions: number }
  /** Pack citations actually referenced by surviving quotes — for the review ledger. */
  usedCitations: ContextPackCitation[]
  /** Count of surviving FAQ items (their answers are model-authored → needs_verification). */
  faqCount: number
}

function citationIdentity(c: {
  osisId?: string | null
  chapterStart?: number | null
  chapterEnd?: number | null
  verseStart?: number | null
  verseEnd?: number | null
}): string {
  return [
    c.osisId ?? "",
    c.chapterStart ?? "",
    c.chapterEnd ?? "",
    c.verseStart ?? "",
    c.verseEnd ?? "",
  ].join("|")
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection++
  return intersection / (a.size + b.size - intersection)
}

function warnFiltered(reason: string, count: number): void {
  console.warn(
    `[experience-ai] event=section_generation.filtered count=${count} reason=${reason}`,
  )
}

/**
 * Filter a generated section against its grounding pack. Returns the surviving
 * blocks plus the provenance the action needs to build the review ledger.
 */
export function applySectionAllowlist(
  section: DraftVideoSection,
  pack: VideoContextPack,
): SectionAllowlistOutcome {
  const citationByIdentity = new Map<string, ContextPackCitation>()
  for (const citation of pack.citations) {
    citationByIdentity.set(citationIdentity(citation), citation)
  }
  const studyQuestionTokens = pack.studyQuestions.map((q) => tokenize(q.text))

  let droppedScripture = 0
  let droppedFaq = 0
  let faqCount = 0
  const usedCitations = new Map<string, ContextPackCitation>()
  const blocks: DraftVideoSectionBlock[] = []

  for (const block of section.blocks) {
    if (block.t === "bibleQuotesCarousel") {
      const keptQuotes = block.quotes.filter((quote) => {
        const identity = citationIdentity(quote)
        const match = citationByIdentity.get(identity)
        if (match) {
          usedCitations.set(identity, match)
          return true
        }
        droppedScripture++
        return false
      })
      // Omit the block entirely rather than emit a hollow carousel.
      if (keptQuotes.length > 0) {
        blocks.push({ ...block, quotes: keptQuotes })
      }
      continue
    }

    if (block.t === "relatedQuestions") {
      const keptQuestions = block.questions.filter((item) => {
        const tokens = tokenize(item.question)
        const grounded = studyQuestionTokens.some(
          (studyTokens) => jaccard(tokens, studyTokens) >= FAQ_MATCH_THRESHOLD,
        )
        if (!grounded) droppedFaq++
        return grounded
      })
      if (keptQuestions.length > 0) {
        faqCount += keptQuestions.length
        blocks.push({ ...block, questions: keptQuestions })
      }
      continue
    }

    // videoHero / video / text pass through unchanged.
    blocks.push(block)
  }

  if (droppedScripture > 0) warnFiltered("off_pack_reference", droppedScripture)
  if (droppedFaq > 0) warnFiltered("off_pack_question", droppedFaq)

  return {
    blocks,
    dropped: { scriptureQuotes: droppedScripture, faqQuestions: droppedFaq },
    usedCitations: [...usedCitations.values()],
    faqCount,
  }
}
