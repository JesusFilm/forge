import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import { MAX_DEVOTIONAL_SHORT_TEXT } from "./types"

/**
 * Short-form devotional copy: given the scene, its scripture, and the (already
 * modernized) reflection, produce the small pieces of on-screen/spoken copy —
 * a scroll-stopping cover HOOK, ONE practical question, and a one-line
 * invitation to pray.
 *
 * Deliberately ONE practical, present-tense question (not several deep ones):
 * viewers watch on the go, and a single concrete question sparks reflection
 * better than a quiz. The "prayer" is an INVITATION to pray (encourages the
 * viewer to pray) — not a scripted prayer addressed to God. (`title` = the hook.)
 *
 * The CONCLUSION is written separately, afterward, by devotional-conclusion.ts
 * — it needed a different, narrower set of rules (echo THIS reflection's own
 * imagery, never duplicate a reflection sentence) than title/question/prayer,
 * and splitting it out means a bad conclusion retries on its own instead of
 * discarding an otherwise-fine title/question/prayer.
 */

const CopySchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT),
    question: z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT),
    prayer: z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT),
  })
  .strict()

const COPY_JSON_SCHEMA = {
  name: "devotional_copy",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_SHORT_TEXT,
      },
      question: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_SHORT_TEXT,
      },
      prayer: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_SHORT_TEXT,
      },
    },
    required: ["title", "question", "prayer"],
  },
}

export const SYSTEM_PROMPT = [
  "You write copy for a short vertical devotional video (Reels/TikTok/Shorts).",
  "AUDIENCE: the viewer ALREADY follows Jesus (often a new believer) — encourage",
  "and deepen a fellow believer. Do NOT question whether they are/can become a",
  "Christian or 'reach heaven', and do NOT make an evangelistic appeal to convert;",
  "frame any 'can the lost be saved' idea as hope about others or as 'we'.",
  "Given the scene, its Bible verse, and a short reflection, return three things:",
  "1. title — a HOOK for the cover: a scroll-stopping opening line that makes",
  "   someone stop and watch. Up to ~10 words. Follow the hook style given",
  "   below; it rotates so the covers don't all sound alike.",
  "   THE ONE TEST THAT MATTERS: a hook OPENS a gap, a summary CLOSES it. If",
  "   someone who heard only your line already knows the devotional's point,",
  "   you have written a summary and it is wrong, however true and well put.",
  '   "Jesus invites himself into the life of the person no one wanted" tells',
  '   the whole story in one breath and leaves nothing to watch for. "When',
  '   everyone else had written him off, Jesus stopped" carries the same idea',
  "   and makes you ask who, and why, and what happened next.",
  "   Say the least that still intrigues. NEVER open with 'What if'.",
  "   If the per-devotional hook style below is set, follow it — but the",
  "   AUDIENCE rule above outranks it. A hook must never put the viewer's own",
  "   standing with God in doubt, however well it fits the requested style:",
  "   'Does Jesus really want someone like you?' and 'You don't have to earn",
  "   your way BACK to God' both treat the viewer as an outsider and are",
  "   forbidden. Aim the same emotional pull at a believer instead ('You're",
  "   the one he stopped for', 'Jesus went looking for the man everyone",
  "   wrote off'). If a style cannot be satisfied without questioning the",
  "   viewer's standing, keep the style and change the angle, never the",
  "   audience.",
  "2. question — exactly ONE practical, present-tense question that sparks",
  "   reflection. Concrete and personal, answerable in a moment. NOT abstract",
  "   theology, NOT multiple questions.",
  "3. prayer — a short one-line ENCOURAGEMENT that INVITES the viewer to pray",
  '   about this (e.g. "Take a moment to bring your fear to God and ask for his',
  '   peace"). It invites the viewer to pray — it is NOT a scripted prayer',
  "   addressed to God, not words to recite.",
  "ALL THREE ARE ABOUT THE VIEWER AND CHRIST — never about a third party.",
  "The commonest drift, and it looks harmless every time: the hook names a",
  "feeling the viewer knows, and then the question and the prayer quietly turn",
  "outward to somebody else who needs saving. 'Who in your life seems too far",
  "from God?' and 'Ask God to show you someone who needs to hear this' hand the",
  "viewer an errand about other people instead of anything for their own walk,",
  "and they arrive right after a reflection that WAS about them, so the",
  "devotional changes address halfway through.",
  "Turn the same idea inward and it works: 'Where do you need to remember he",
  "chose you first?' rather than 'Who do you know that needs to hear it?'",
  "This binds even when the reflection is about the unlikeliness of grace: that",
  "the grace was unlikely is a fact about the VIEWER's rescue too.",
  "Match the tone of the scene.",
  "THEOLOGY (hook especially): a hook may provoke with a real felt-need or",
  "tension, but must NEVER state or imply something theologically false, even as",
  "a rhetorical question. Do NOT call sin good, a gift, or desirable; do NOT",
  "imply God needs you, or that faith guarantees wealth or health. Grace,",
  "forgiveness, or restored dignity can be the gift — the sin itself never is.",
  "PUNCTUATION: do NOT use em dashes or en dashes (— or –) anywhere. They read",
  "as AI writing. Use a period, comma, or colon, or restructure the sentence.",
  "Return JSON only.",
].join("\n")

/**
 * Cover-hook FORMS, rotated by sequence so the opening line varies across
 * devotionals instead of collapsing to one shape (owner: every cover was opening
 * "What if..."). Each run gets one style; the model still has freedom within it.
 *
 * Owner-chosen, and cut down to THREE. The previous eight were abstract labels
 * with no examples ("a bold, declarative statement"), and abstract labels are
 * what let the hook drift into summary: a summary is, after all, bold and
 * declarative. Each form now carries the owner's own example, because we have
 * twice watched an example in a prompt outweigh the rule beside it.
 */
export const HOOK_STYLES = [
  "DIRECT ADDRESS — name the kind of person watching, so they recognise " +
    "themselves and know the next two minutes are for them. Often opens " +
    "'For anyone who…'. Example: \"For anyone who thinks they've gone too " +
    'far." Name the feeling they arrived with, not the lesson they leave with.',
  "INTRIGUING STATEMENT about Jesus — one moment from the scene, stated so " +
    'that it raises a question instead of answering one. Example: "When ' +
    'everyone else had written him off, Jesus stopped." The viewer should ' +
    "want to know who was written off, and why, and what happened next.",
  "INTRIGUING QUESTION — one the viewer cannot answer from the title alone, " +
    'and now wants answered. Example: "What changed Zacchaeus so completely?" ' +
    "Never begins with 'What if'.",
] as const

/** Deterministic hook style for a devotional's rotation counter. */
export function hookStyleForSequence(sequence: number): string {
  const n = HOOK_STYLES.length
  return HOOK_STYLES[((Math.trunc(sequence) % n) + n) % n]
}

export type DevotionalCopyInput = {
  sceneTitle: string
  reference: string
  scriptureText: string
  reflection: string
  /** Rotated cover-hook form for THIS devotional (see hookStyleForSequence). */
  hookStyle?: string
  llm: DevotionalLlm
}

export type DevotionalCopy = {
  title: string
  question: string
  prayer: string
}

export class DevotionalCopyError extends Error {
  constructor(
    readonly code: "generation_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "DevotionalCopyError"
  }
}

export async function writeDevotionalCopy(
  input: DevotionalCopyInput,
): Promise<DevotionalCopy> {
  const user = [
    `Scene: ${input.sceneTitle}`,
    `Verse (${input.reference}): ${input.scriptureText}`,
    ...(input.hookStyle
      ? ["", `Hook style for THIS devotional: ${input.hookStyle}.`]
      : []),
    "",
    "Reflection:",
    input.reflection,
  ].join("\n")

  let result: z.infer<typeof CopySchema>
  try {
    result = await input.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: COPY_JSON_SCHEMA,
      schema: CopySchema,
      temperature: 0.6,
      maxTokens: 250,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      throw new DevotionalCopyError(
        "generation_failed",
        `devotional copy generation failed: ${error.code}`,
        error,
      )
    }
    throw error
  }

  return {
    title: result.title.trim(),
    question: result.question.trim(),
    prayer: result.prayer.trim(),
  }
}

export const _internal = { JSON_SCHEMA: COPY_JSON_SCHEMA }
