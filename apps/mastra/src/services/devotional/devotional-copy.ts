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
  "   someone stop and watch, present-tense and personal ('you'). NOT a neutral",
  "   title or a summary. VARY THE FORM from devotional to devotional — it does",
  "   NOT have to be a question. Rotate across: a bold statement, a relatable",
  "   confession or felt-need, a vivid concrete image from the scene, a direct",
  "   invitation, a surprising truth, or (only sometimes) a question. Do NOT",
  "   default to a question, and NEVER open with 'What if'. Up to ~10 words.",
  '   Examples of DIFFERENT forms: "You can stop performing for God." /',
  '   "Some storms don\'t frighten Jesus at all." / "He saw the one everyone',
  '   walked past." / "There is a table set for the person you\'d overlook."',
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
 */
export const HOOK_STYLES = [
  "a bold, declarative statement (no question mark)",
  "an emotional statement naming a feeling the viewer already knows (no question mark)",
  "a relatable confession or felt-need in the viewer's own voice",
  "direct audience identification: name the kind of believer watching, so they recognise themselves",
  "a vivid, concrete image drawn from the scene",
  "a warm, direct invitation",
  "a surprising or counterintuitive truth",
  "an intriguing question the viewer needs answered — it must NOT begin with 'What if'",
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
