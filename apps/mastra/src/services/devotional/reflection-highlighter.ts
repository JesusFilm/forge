import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"

/**
 * Pick the 3 STRONGEST phrases across the WHOLE reflection to emphasize (orange
 * italic accent) — NOT one per paragraph. Each is copied VERBATIM so the
 * composition can find and color it. Returns a per-chunk array aligned with
 * `chunks`: the phrase for the chunk that contains it, "" otherwise — so only
 * ~3 cards are accented.
 *
 * Best-effort: on failure, or for phrases that aren't exact substrings, those
 * chunks get "" (no accent).
 */

const MAX_HIGHLIGHTS = 3

const HighlightsSchema = z.object({ phrases: z.array(z.string()) }).strict()

const JSON_SCHEMA = {
  name: "reflection_highlights",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { phrases: { type: "array", items: { type: "string" } } },
    required: ["phrases"],
  },
}

export const SYSTEM_PROMPT = [
  "You choose the phrases to visually emphasize in a devotional reflection",
  "(shown in an accent color).",
  `From the WHOLE reflection, pick the ${MAX_HIGHLIGHTS} STRONGEST phrases — the`,
  "lines that carry the most emotional or spiritual weight and should land hardest.",
  "Each phrase must be SHORT (about 2–7 words) and copied EXACTLY (verbatim, same",
  "words and punctuation) from the reflection. Do not pick more than",
  `${MAX_HIGHLIGHTS}. Spread them across the reflection, not all in one place.`,
  "Return JSON { phrases: string[] }.",
].join("\n")

export type PickHighlightsInput = {
  chunks: string[]
  llm: DevotionalLlm
}

/** Per-chunk array: the strongest phrase found in that chunk (one of the top 3),
 *  or "" — only ~3 chunks get a highlight. */
export async function pickReflectionHighlights(
  input: PickHighlightsInput,
): Promise<string[]> {
  if (input.chunks.length === 0) return []
  const full = input.chunks.join(" ")
  let result: z.infer<typeof HighlightsSchema>
  try {
    result = await input.llm.complete({
      system: SYSTEM_PROMPT,
      user: full,
      jsonSchema: JSON_SCHEMA,
      schema: HighlightsSchema,
      temperature: 0.2,
      maxTokens: 200,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) return input.chunks.map(() => "")
    throw error
  }

  // Keep the top few verbatim phrases, then assign each to the first chunk that
  // contains it (one accent per card).
  const phrases = (result.phrases ?? [])
    .map((p) => p.trim())
    .filter((p) => p && full.includes(p))
    .slice(0, MAX_HIGHLIGHTS)
  const used = new Set<string>()
  return input.chunks.map((chunk) => {
    const hit = phrases.find((p) => !used.has(p) && chunk.includes(p))
    if (hit) used.add(hit)
    return hit ?? ""
  })
}
