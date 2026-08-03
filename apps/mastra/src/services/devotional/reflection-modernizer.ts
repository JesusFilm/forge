import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import { requireAuthoredPrompt } from "./authored-data"
import { MAX_DEVOTIONAL_TEXT_LENGTH } from "./types"

/**
 * Reflection modernizer — a dedicated, tightly-bounded agent.
 *
 * The reflection content comes from public-domain preachers (Ryle, Matthew
 * Henry), written 150–300 years ago in archaic English. This step makes ONE
 * short excerpt readable for a modern short-video audience with a LIGHT TOUCH:
 * it updates archaic language and breaks up long sentences while preserving the
 * author's meaning, argument, imagery, and voice. It does NOT rewrite, add
 * ideas, or change theology — so the reflection stays the author's, not the
 * model's. Kept separate from selection so it can be tuned/swapped on its own,
 * and so it doubles as the future localization seam (adapt → translate).
 *
 * Because the source can be a whole long chapter (Matthew Henry), the step also
 * focuses on the passage's verses and trims to a spoken ~30–45s length. The
 * output is attributed "Adapted from <source>" (not a verbatim quote), and the
 * original text is preserved by the caller for provenance.
 */

export type ReflectionModernizerErrorCode = "generation_failed" | "empty_output"

export class ReflectionModernizerError extends Error {
  constructor(
    readonly code: ReflectionModernizerErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ReflectionModernizerError"
  }
}

const ModernizedSchema = z
  .object({
    adapted: z.string().trim().min(1).max(MAX_DEVOTIONAL_TEXT_LENGTH),
  })
  .strict()

const MODERNIZED_JSON_SCHEMA = {
  name: "modernized_reflection",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      adapted: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_TEXT_LENGTH,
      },
    },
    required: ["adapted"],
  },
}

export type ModernizeReflectionOptions = {
  /** Source excerpt (may be a whole chapter; focus on the passage). */
  sourceText: string
  /** Human/osis reference to focus on, e.g. "Luke 8:22-25". */
  focusReference: string
  /** Attribution name, e.g. "Matthew Henry, Commentary on the Whole Bible". */
  sourceName: string
  /** Target spoken length in words (~60–75s ≈ 170; 2–3 short paragraphs). */
  approxWords?: number
  llm: DevotionalLlm
  systemPrompt?: string
}

export type ModernizedReflection = {
  adapted: string
  /** "Adapted from <source>" — NOT a verbatim quote (light modernization applied). */
  attribution: string
  focusReference: string
}

export async function modernizeReflection(
  options: ModernizeReflectionOptions,
): Promise<ModernizedReflection> {
  const systemPrompt = requireAuthoredPrompt(options.systemPrompt)
  const approxWords = options.approxWords ?? 170
  const user = [
    `Passage to focus on: ${options.focusReference}`,
    `Author/source: ${options.sourceName}`,
    `Target length: about ${approxWords} words across 2–3 short paragraphs (a ~60–75 second spoken reflection).`,
    "",
    "Source text:",
    options.sourceText,
  ].join("\n")

  let result: z.infer<typeof ModernizedSchema>
  try {
    result = await options.llm.complete({
      system: systemPrompt,
      user,
      jsonSchema: MODERNIZED_JSON_SCHEMA,
      schema: ModernizedSchema,
      temperature: 0.3,
      maxTokens: 1200,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      throw new ReflectionModernizerError(
        "generation_failed",
        `reflection modernization failed: ${error.code}`,
        error,
      )
    }
    throw error
  }

  const adapted = result.adapted.trim()
  if (!adapted) {
    throw new ReflectionModernizerError(
      "empty_output",
      "modernizer returned empty text",
    )
  }

  return {
    adapted,
    // "a trusted classic" signals a historic, credible source even to viewers
    // who don't recognize the author's name (owner note). Use just the AUTHOR
    // (the part before the first comma of the citation, e.g. "Matthew Henry"
    // from "Matthew Henry, Commentary on the Whole Bible") so it stays short.
    // Generalizes across the commentators (Henry/Ryle) and Spurgeon.
    attribution: `Adapted from a trusted classic · ${options.sourceName.split(",")[0].trim()}`,
    focusReference: options.focusReference,
  }
}
