import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import {
  MAX_DEVOTIONAL_SHORT_TEXT,
  MAX_DEVOTIONAL_TEXT_LENGTH,
  type ScriptureRef,
} from "./types"
import { getVerseText } from "./web-bible"

/**
 * Video-first scripture selection: given the clip's Bible passage, pick ONE key
 * verse to anchor the devotional and quote it in a public-domain modern
 * translation (World English Bible). This inverts the old hook-first
 * `scripture-selector` (which chose scripture to fit a hook).
 *
 * `needsCanonicalSource` stays true: the quote is model-proposed until a real
 * WEB Bible-text source is wired (A5), so we never present it as verified.
 */

const ScriptureResponseSchema = z
  .object({
    reference: z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT),
    text: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
  })
  .strict()

const SCRIPTURE_JSON_SCHEMA = {
  name: "passage_scripture",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reference: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_SHORT_TEXT,
      },
      text: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
    },
    required: ["reference", "text"],
  },
}

export const SYSTEM_PROMPT = [
  "You anchor a short devotional video in one Bible verse.",
  "You are given the Gospel passage the video's clip depicts.",
  "Choose ONE key verse from within that passage — the heart of the scene.",
  "Quote it in the World English Bible (WEB, public domain, modern English).",
  "Keep it to a single verse (or two short ones). Return JSON only.",
].join("\n")

export type SelectScriptureForPassageOptions = {
  /** Human passage reference, e.g. "Luke 8:22-25". */
  reference: string
  llm: DevotionalLlm
  /** Exact-verse lookup (defaults to the WEB Bible). Injectable for tests. */
  lookupVerse?: (reference: string) => string | null
}

export class PassageScriptureError extends Error {
  constructor(
    readonly code: "generation_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "PassageScriptureError"
  }
}

export async function selectScriptureForPassage(
  options: SelectScriptureForPassageOptions,
): Promise<ScriptureRef> {
  let response: z.infer<typeof ScriptureResponseSchema>
  try {
    response = await options.llm.complete({
      system: SYSTEM_PROMPT,
      user: [
        `Passage: ${options.reference}`,
        "Choose the key verse from this passage and quote it (WEB).",
      ].join("\n"),
      jsonSchema: SCRIPTURE_JSON_SCHEMA,
      schema: ScriptureResponseSchema,
      temperature: 0.2,
      maxTokens: 400,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      throw new PassageScriptureError(
        "generation_failed",
        `passage scripture selection failed: ${error.code}`,
        error,
      )
    }
    throw error
  }

  const reference = response.reference.trim()
  // Prefer the EXACT WEB text for the chosen reference; the model only picks
  // WHICH verse. Fall back to the model's quote (flagged) if the reference
  // doesn't resolve (e.g. outside the ingested Gospels+Acts).
  const lookup = options.lookupVerse ?? getVerseText
  const exact = lookup(reference)
  return {
    reference,
    text: exact ?? response.text.trim(),
    translation: "WEB",
    needsCanonicalSource: exact == null,
  }
}
