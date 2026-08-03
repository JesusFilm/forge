import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import { requireAuthoredPrompt } from "./authored-data"
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
 */

const CopySchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT),
    conclusion: z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT),
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
      conclusion: {
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
    required: ["title", "conclusion", "question", "prayer"],
  },
}

/**
 * Cover-hook FORMS, rotated by sequence so the opening line varies across
 * devotionals instead of collapsing to one shape (owner: every cover was opening
 * "What if..."). Each run gets one style; the model still has freedom within it.
 */
/** Deterministic hook style for a devotional's rotation counter. */
export function hookStyleForSequence(
  sequence: number,
  hookStyles?: readonly string[],
): string {
  if (!hookStyles?.length) {
    throw new Error(
      "/inputs/prompts/generation.json: hookStyles configuration is required",
    )
  }
  const n = hookStyles.length
  return hookStyles[((Math.trunc(sequence) % n) + n) % n]!
}

export type DevotionalCopyInput = {
  sceneTitle: string
  reference: string
  scriptureText: string
  reflection: string
  /** Rotated cover-hook form for THIS devotional (see hookStyleForSequence). */
  hookStyle?: string
  llm: DevotionalLlm
  systemPrompt?: string
}

export type DevotionalCopy = {
  title: string
  conclusion: string
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
  const systemPrompt = requireAuthoredPrompt(input.systemPrompt)
  let result: z.infer<typeof CopySchema>
  try {
    result = await input.llm.complete({
      system: systemPrompt,
      user: [
        `Scene: ${input.sceneTitle}`,
        `Verse (${input.reference}): ${input.scriptureText}`,
        ...(input.hookStyle
          ? ["", `Hook style for THIS devotional: ${input.hookStyle}.`]
          : []),
        "",
        "Reflection:",
        input.reflection,
      ].join("\n"),
      jsonSchema: COPY_JSON_SCHEMA,
      schema: CopySchema,
      temperature: 0.6,
      maxTokens: 300,
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
    conclusion: result.conclusion.trim(),
    question: result.question.trim(),
    prayer: result.prayer.trim(),
  }
}
