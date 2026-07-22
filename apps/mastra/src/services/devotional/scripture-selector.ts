import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import {
  MAX_DEVOTIONAL_SHORT_TEXT,
  MAX_DEVOTIONAL_TEXT_LENGTH,
  type Hook,
  type ScriptureRef,
} from "./types"

/**
 * Choose a scripture passage that coheres with the day's hook. Per A5 the
 * canonical text source is confirmed at exec time, so the model proposes a
 * reference + short quote and we always carry `needsCanonicalSource: true`
 * through to the report — we never present an unverified paraphrase as
 * authoritative scripture.
 */

const MAX_REFERENCE_LENGTH = 120

/**
 * Tolerant "Book Chapter[:Verse[-Verse]]" matcher. Accepts a leading 1-3 for
 * books like "1 John", multi-word book names ("Song of Solomon"), a required
 * chapter number, and an optional verse / verse-range.
 */
const REFERENCE_SHAPE =
  /^(?:[1-3]\s+)?[A-Za-z][A-Za-z.]*(?:\s+[A-Za-z][A-Za-z.]*)*\s+\d{1,3}(?::\d{1,3}(?:-\d{1,3})?)?$/

export class ScriptureSelectorError extends Error {
  constructor(
    readonly code: "invalid_reference" | "generation_failed",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ScriptureSelectorError"
  }
}

const ScriptureResponseSchema = z
  .object({
    reference: z.string().trim().min(1).max(MAX_REFERENCE_LENGTH),
    text: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
    translation: z.string().trim().max(MAX_DEVOTIONAL_SHORT_TEXT).optional(),
  })
  .strict()

const SCRIPTURE_JSON_SCHEMA = {
  name: "devotional_scripture",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reference: {
        type: "string",
        minLength: 1,
        maxLength: MAX_REFERENCE_LENGTH,
      },
      text: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
      translation: { type: "string", maxLength: MAX_DEVOTIONAL_SHORT_TEXT },
    },
    required: ["reference", "text"],
  },
}

const SYSTEM_PROMPT = [
  "You choose one short Bible passage to anchor a daily Christian devotional.",
  "The passage must cohere with the day's hook. Keep it focused — 1 to 4 verses.",
  "Return the reference (for example 'John 3:16' or '1 John 4:7-12'), the quoted",
  "passage, and the translation you are quoting. Return JSON only.",
].join("\n")

function normalizeReference(reference: string): string {
  return reference.trim().replace(/\s+/g, " ").replace(/\.$/, "")
}

function isWellFormedReference(reference: string): boolean {
  return REFERENCE_SHAPE.test(reference)
}

export type SelectScriptureOptions = {
  hook: Hook
  llm: DevotionalLlm
}

export async function selectScripture(
  options: SelectScriptureOptions,
): Promise<ScriptureRef> {
  let response: z.infer<typeof ScriptureResponseSchema>
  try {
    response = await options.llm.complete({
      system: SYSTEM_PROMPT,
      user: [
        `Hook type: ${options.hook.type}`,
        `Hook: ${options.hook.title}`,
        `Context: ${options.hook.summary}`,
        "Choose a scripture passage that fits this hook.",
      ].join("\n"),
      jsonSchema: SCRIPTURE_JSON_SCHEMA,
      schema: ScriptureResponseSchema,
      temperature: 0.3,
      maxTokens: 600,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      throw new ScriptureSelectorError(
        "generation_failed",
        `scripture selection failed: ${error.code}`,
        error,
      )
    }
    throw error
  }

  const reference = normalizeReference(response.reference)
  if (!isWellFormedReference(reference)) {
    throw new ScriptureSelectorError(
      "invalid_reference",
      `model returned a malformed scripture reference: ${response.reference}`,
    )
  }

  return {
    reference,
    text: response.text,
    translation: response.translation ?? null,
    // A5: always flagged until a canonical Bible-text source is wired.
    needsCanonicalSource: true,
  }
}

export const _internal = {
  SYSTEM_PROMPT,
  normalizeReference,
  isWellFormedReference,
}
