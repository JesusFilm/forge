import { z } from "zod"

import type { DevotionalLlm } from "./llm"

/**
 * Creative review: one model writes, another reviews (owner, 2026-10-29).
 *
 * The owner found that an outside read by a second model (GPT) caught what the
 * writer (Claude) missed on the Peter's Confession carousel: a hook answered
 * too early, an ending that only repeated a translation. This module makes that
 * a step: `reviewDraft` asks the reviewer for a scored critique against the
 * kind's rubric and the house rules, and `reviseDraft` hands the critique back
 * to the writer, who may reject any suggestion that breaks a house rule and
 * says why. Both are plain functions over an injected `DevotionalLlm`, so the
 * same code runs from a story session (`creative-review.ts` script) and as the
 * `creative-review` Mastra workflow.
 */

export const CREATIVE_KINDS = ["script", "shorts", "carousel"] as const
export type CreativeKind = (typeof CREATIVE_KINDS)[number]

export const DEFAULT_REVIEW_MODEL = "openai/gpt-6.1-sol"
export const DEFAULT_WRITER_MODEL = "anthropic/claude-fable-5.1"

/**
 * Rules a suggestion may never break. The reviewer sees them so it does not
 * propose what we would only throw away; the writer sees them as the reason
 * to reject a suggestion.
 */
export const HOUSE_RULES = [
  "Never use em dashes or en dashes in any text.",
  "Every line must be literally true to the Bible passage. Never invent words, actions or feelings the passage does not give.",
  "Quote Scripture exactly as given in the draft (English: Berean Standard Bible; Russian: Synodal). Do not paraphrase a quotation.",
  "Russian text addresses the viewer without gendered past-tense forms (write 'больше не приходишь', never 'перестал').",
  "A voiced script never names commentators, dictionaries or Greek and Hebrew words aloud; credits are on screen.",
  "One thought per piece. Do not add a second idea to make it richer.",
  "Plain, warm, friend-to-friend words; no church jargon, no hype, no clickbait.",
  "Daily Bible Pause ends on the viewer: the reader's own response, not a summary of facts.",
] as const

const RUBRICS: Record<CreativeKind, readonly string[]> = {
  script: [
    "Hook: does the first sentence name a felt need the viewer recognises, and make them want the next sentence?",
    "Opening length: the spoken opening before the film must stay under about 15 seconds (roughly 30 English or 25 Russian words).",
    "One thought: is there a single line of thought from hook to conclusion, with one insight explained, not several thin notes?",
    "Momentum: does each paragraph earn the next, or are there stretches that only add information?",
    "Payoff: does the conclusion land a new meaning rather than repeat what was already said?",
    "Ending: does the question and prayer turn to the viewer personally?",
  ],
  shorts: [
    "First two seconds: does each short open on something that stops the scroll (a question, a strong image, a line)?",
    "Standalone: does each short make sense to someone who has not seen the long video?",
    "Each short has one job; are any two shorts doing the same job?",
    "Closing line: does each short end on a turn that makes the viewer want the full story, without promising what the video does not deliver?",
    "On-screen text: short enough to read at a glance; key words picked to highlight.",
  ],
  carousel: [
    "Hook: does card 1 ask a question built on a common assumption, rather than state a fact?",
    "Chain of open questions: does every card answer the previous card's question and raise a new one? Name any card that gives no reason to swipe.",
    "Pacing: is the full answer held back until the end, or given away too early?",
    "Payoff: does the last card add a new meaning (not repeat an earlier card) and turn to the viewer?",
    "Visual storytelling: does each card's picture show the person or scene the text is about?",
    "Readability: is each card short enough to read in a few seconds; are only one or two words per card highlighted?",
  ],
}

export const ReviewItemSchema = z
  .object({
    target: z
      .string()
      .describe("Where: 'card 2', 'paragraph 3', 'short: intro', 'hook'."),
    problem: z.string(),
    suggestion: z
      .string()
      .describe("A concrete rewrite or change, in the draft's language."),
    severity: z.enum(["major", "minor"]),
  })
  .strict()

export const CreativeReviewSchema = z
  .object({
    verdict: z
      .string()
      .describe("Two or three sentences on the draft as a whole."),
    scores: z
      .array(
        z
          .object({
            criterion: z.string(),
            score: z.number().int().min(1).max(10),
            note: z.string(),
          })
          .strict(),
      )
      .min(1),
    items: z.array(ReviewItemSchema),
    mostImportant: z
      .string()
      .describe("The one change that would help the draft most."),
  })
  .strict()
export type CreativeReview = z.infer<typeof CreativeReviewSchema>

export const CreativeRevisionSchema = z
  .object({
    revised: z
      .string()
      .describe("The full revised draft, same format as the input."),
    decisions: z.array(
      z
        .object({
          item: z
            .number()
            .int()
            .min(1)
            .describe("1-based index into the review items."),
          accepted: z.boolean(),
          why: z.string(),
        })
        .strict(),
    ),
  })
  .strict()
export type CreativeRevision = z.infer<typeof CreativeRevisionSchema>

export type CreativeDraft = {
  kind: CreativeKind
  /** The draft as the owner would read it (markdown or plain text). */
  draft: string
  /** "en" | "ru" | ...; the reviewer answers in this language. */
  lang: string
  /** Optional background: the passage, the long-form script, notes. */
  context?: string
  /**
   * The owner's decisions, one per line ("keep the Greek and Hebrew words on
   * card 2", "the suffering in v. 22 is saved for Holy Week"). The reviewer
   * may not suggest changing them and the writer rejects any suggestion that
   * does: on the first run both models talked the owner's picks out of the
   * Peter's Confession carousel (2026-10-29).
   */
  locked?: string
}

const LANG_NAMES: Record<string, string> = {
  en: "English",
  ru: "Russian",
  es: "Spanish",
}
const langName = (lang: string) => LANG_NAMES[lang] ?? lang

const KIND_NAMES: Record<CreativeKind, string> = {
  script: "a long-form devotional video script",
  shorts: "a plan of short vertical videos cut from one devotional",
  carousel: "an image carousel for a YouTube Community post",
}

function rulesBlock(): string {
  return HOUSE_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n")
}

/** JSON schema sent as OpenRouter's structured output for the review. */
const REVIEW_JSON_SCHEMA = {
  name: "creative_review",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "scores", "items", "mostImportant"],
    properties: {
      verdict: { type: "string" },
      scores: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["criterion", "score", "note"],
          properties: {
            criterion: { type: "string" },
            score: { type: "integer", minimum: 1, maximum: 10 },
            note: { type: "string" },
          },
        },
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["target", "problem", "suggestion", "severity"],
          properties: {
            target: { type: "string" },
            problem: { type: "string" },
            suggestion: { type: "string" },
            severity: { type: "string", enum: ["major", "minor"] },
          },
        },
      },
      mostImportant: { type: "string" },
    },
  },
} as const

const REVISION_JSON_SCHEMA = {
  name: "creative_revision",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["revised", "decisions"],
    properties: {
      revised: { type: "string" },
      decisions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["item", "accepted", "why"],
          properties: {
            item: { type: "integer", minimum: 1 },
            accepted: { type: "boolean" },
            why: { type: "string" },
          },
        },
      },
    },
  },
} as const

export function reviewPrompt(input: CreativeDraft): {
  system: string
  user: string
} {
  const system = [
    `You are a senior storytelling editor reviewing ${KIND_NAMES[input.kind]} for Daily Bible Pause, a short Bible devotional series on YouTube, Instagram and Facebook.`,
    "Your job is to make the piece hold attention and land its point. Be direct and specific. Praise only what a change should keep.",
    "Score each rubric criterion from 1 to 10, then list concrete problems with a rewrite for each. Mark an item major only if it would change whether a viewer keeps going.",
    "Every suggestion must obey these house rules; do not suggest anything that breaks them:",
    rulesBlock(),
    ...(input.locked
      ? [
          "The owner has already decided the following. Treat them as fixed: work within them and never suggest changing them:",
          input.locked,
        ]
      : []),
    `Write the whole review in ${langName(input.lang)}, and write suggested rewrites in the draft's own language.`,
  ].join("\n\n")
  const user = [
    "Rubric:",
    RUBRICS[input.kind].map((r, i) => `${i + 1}. ${r}`).join("\n"),
    input.context ? `Background:\n${input.context}` : "",
    `Draft:\n${input.draft}`,
  ]
    .filter(Boolean)
    .join("\n\n")
  return { system, user }
}

export function revisionPrompt(
  input: CreativeDraft,
  review: CreativeReview,
): { system: string; user: string } {
  const system = [
    `You wrote ${KIND_NAMES[input.kind]} for Daily Bible Pause. An editor from another team reviewed it.`,
    "Revise the draft. Take a suggestion when it makes the piece hold attention better and is true to the passage. Reject a suggestion when it breaks a house rule, adds a second idea, or claims more than the passage says, and say why in one sentence.",
    "House rules (they win over any suggestion):",
    rulesBlock(),
    ...(input.locked
      ? [
          "The owner's decisions (they also win; reject any suggestion that changes one and name it):",
          input.locked,
        ]
      : []),
    "Keep the draft's format, language and length roughly the same. Return the full revised draft and one decision for every review item.",
  ].join("\n\n")
  const items = review.items
    .map(
      (it, i) =>
        `${i + 1}. [${it.severity}] ${it.target}: ${it.problem}\n   Suggestion: ${it.suggestion}`,
    )
    .join("\n")
  const user = [
    `Review verdict: ${review.verdict}`,
    `Most important: ${review.mostImportant}`,
    `Review items:\n${items || "(none)"}`,
    input.context ? `Background:\n${input.context}` : "",
    `Draft:\n${input.draft}`,
  ]
    .filter(Boolean)
    .join("\n\n")
  return { system, user }
}

/** Strip em and en dashes a model slipped in (house rule 1). */
export function stripDashes(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",")
}

export async function reviewDraft(
  reviewer: DevotionalLlm,
  input: CreativeDraft,
): Promise<CreativeReview> {
  const { system, user } = reviewPrompt(input)
  return reviewer.complete({
    system,
    user,
    jsonSchema: REVIEW_JSON_SCHEMA as unknown as {
      name: string
      schema: Record<string, unknown>
    },
    schema: CreativeReviewSchema,
    maxTokens: 4000,
    temperature: 0.4,
  })
}

export async function reviseDraft(
  writer: DevotionalLlm,
  input: CreativeDraft,
  review: CreativeReview,
): Promise<CreativeRevision> {
  const { system, user } = revisionPrompt(input, review)
  const out = await writer.complete({
    system,
    user,
    jsonSchema: REVISION_JSON_SCHEMA as unknown as {
      name: string
      schema: Record<string, unknown>
    },
    schema: CreativeRevisionSchema,
    maxTokens: 6000,
    temperature: 0.5,
  })
  return { ...out, revised: stripDashes(out.revised) }
}

export type CreativeReviewResult = {
  review: CreativeReview
  revision?: CreativeRevision
  reviewerModel: string
  writerModel?: string
}

export async function runCreativeReview(
  input: CreativeDraft,
  models: { reviewer: DevotionalLlm; writer?: DevotionalLlm },
): Promise<CreativeReviewResult> {
  const review = await reviewDraft(models.reviewer, input)
  if (!models.writer) return { review, reviewerModel: models.reviewer.model }
  const revision = await reviseDraft(models.writer, input, review)
  return {
    review,
    revision,
    reviewerModel: models.reviewer.model,
    writerModel: models.writer.model,
  }
}

/** The review as the owner reads it (the review doc's "Review" tab). */
export function reviewMarkdown(
  result: CreativeReviewResult,
  input: Pick<CreativeDraft, "kind" | "lang">,
): string {
  const ru = input.lang === "ru"
  const { review, revision } = result
  const lines: string[] = []
  lines.push(
    ru
      ? `# Ревью (${result.reviewerModel})`
      : `# Review (${result.reviewerModel})`,
  )
  lines.push("", review.verdict, "")
  lines.push(ru ? "## Оценки" : "## Scores", "")
  for (const s of review.scores)
    lines.push(`- **${s.criterion}**: ${s.score}/10. ${s.note}`)
  lines.push(
    "",
    ru ? "## Главное" : "## Most important",
    "",
    review.mostImportant,
    "",
  )
  lines.push(ru ? "## Замечания" : "## Notes", "")
  review.items.forEach((it, i) => {
    const d = revision?.decisions.find((x) => x.item === i + 1)
    const mark = d ? (d.accepted ? "✓" : "✗") : "·"
    lines.push(
      `${i + 1}. ${mark} **${it.target}** (${it.severity}): ${it.problem}`,
      `   ${ru ? "Предложение" : "Suggestion"}: ${it.suggestion}`,
    )
    if (d) lines.push(`   ${ru ? "Решение" : "Decision"}: ${d.why}`)
  })
  return lines.join("\n") + "\n"
}
