import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
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

export const SYSTEM_PROMPT = [
  "You turn a passage from a classic, public-domain Christian writer into a short",
  "spoken REFLECTION for a devotional video.",
  "The viewer has JUST WATCHED this Bible scene on video. Therefore:",
  "- Do NOT recount what happened. Do NOT describe the characters or their actions.",
  '- Do NOT quote what anyone in the scene said (e.g. no "Master, we are',
  '  perishing", no "Where is your faith?"). Zero narration, zero dialogue.',
  "- Begin from the TRUTH or the APPLICATION. Never begin from the story.",
  "Give ONLY the author's INSIGHT, MEANING, and APPLICATION: what this reveals about",
  "God and what it means for the viewer's own life today.",
  "- Use the author's own applicational thoughts; do NOT invent new ones.",
  "- Do NOT change, soften, or embellish the theology.",
  "- Light touch on language, but thorough: modernize archaic words ('thee/thou'",
  "  become 'you') AND replace obscure, old-fashioned, or churchy words with plain",
  "  everyday words. No archaic or scholarly vocabulary should remain. Break up",
  "  long sentences. Keep the author's voice.",
  "- Write 2 to 3 short paragraphs, speaking straight to the viewer ('you').",
  "PUNCTUATION: do NOT use em dashes or en dashes (the '—' or '–' characters)",
  "anywhere. They read as AI writing. Use a period, comma, or colon, or restructure.",
  "Return JSON only: an object with an 'adapted' string.",
].join("\n")

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
      system: SYSTEM_PROMPT,
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
