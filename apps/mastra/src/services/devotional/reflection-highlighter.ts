import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"

/**
 * Pick the strongest phrases across the WHOLE reflection to emphasize (orange
 * italic accent) — NOT one per paragraph. Each is copied VERBATIM so the
 * composition can find and color it. Returns a per-chunk array aligned with
 * `chunks`: the phrase for the chunk that contains it, "" otherwise — so only
 * ~3 cards are accented.
 *
 * Best-effort: on failure, or for phrases that aren't exact substrings, those
 * chunks get "" (no accent).
 */

/**
 * How many phrases to accent. It used to be a flat 3, which was right when a
 * reflection was six or seven chunks. The vineyard-era reflections carry
 * historical and language notes as well, and at that length three accents
 * disappear (owner, 2026-09-25: "there is more text now, so more of it can be
 * marked"). Roughly one accent per two chunks, never fewer than 3, never more
 * than 8 — past that everything is emphasized and nothing is.
 */
const MIN_HIGHLIGHTS = 3
const HIGHLIGHT_CEILING = 8
export function highlightCount(chunkCount: number): number {
  return Math.max(
    MIN_HIGHLIGHTS,
    Math.min(HIGHLIGHT_CEILING, Math.round(chunkCount / 2)),
  )
}

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

export const systemPrompt = (max: number): string =>
  [
    "You choose the phrases to visually emphasize in a devotional reflection",
    "(shown in an accent color, bold and italic).",
    `From the WHOLE reflection, pick the ${max} STRONGEST phrases — the`,
    "lines that carry the most emotional or spiritual weight and should land hardest.",
    "A phrase may be a few words or a whole short sentence (about 2 to 12 words),",
    "and must be copied EXACTLY (verbatim, same words and punctuation) from the",
    `reflection. Do not pick more than ${max}. Spread them across the reflection,`,
    "not all in one place, and never mark two in the same sentence.",
    "Return JSON { phrases: string[] }.",
  ].join("\n")

/** Back-compat for callers and tests that want the default shape. */
export const SYSTEM_PROMPT = systemPrompt(MIN_HIGHLIGHTS)

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
      system: systemPrompt(highlightCount(input.chunks.length)),
      user: full,
      jsonSchema: JSON_SCHEMA,
      schema: HighlightsSchema,
      temperature: 0.2,
      // Up to eight phrases of up to twelve words each. The old 200 fitted the
      // old three short ones; at the new count the JSON was cut off mid-array,
      // failed the schema, and the call quietly returned no accents at all.
      maxTokens: 700,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) return input.chunks.map(() => "")
    throw error
  }

  // Keep the top few verbatim phrases, then assign each to the first chunk that
  // contains it (one accent per card).
  //
  // Trailing punctuation is forgiven before matching. The model is asked for a
  // phrase that may end mid-sentence, and gpt-4o-mini reliably tidies it into a
  // sentence by appending a full stop: "The door of hope is wide open." where
  // the reflection reads "...wide open, and it opens from the outside." A
  // strict compare then dropped it. Reproduced 3 runs out of 3, and it cost two
  // of every three accents on screen with nothing logged to say so.
  const phrases = (result.phrases ?? [])
    .map((p) => normalizeHighlight(p, full))
    .filter((p): p is string => p !== null)
    .slice(0, highlightCount(input.chunks.length))
  const used = new Set<string>()
  return input.chunks.map((chunk) => {
    const hit = phrases.find((p) => !used.has(p) && chunk.includes(p))
    if (hit) used.add(hit)
    return hit ?? ""
  })
}

/**
 * The phrase as it appears in `full`, or null when it genuinely isn't there.
 *
 * Only the ENDING is negotiable: a phrase the model closed off with punctuation
 * the source doesn't have is still the author's phrase, while a phrase whose
 * WORDS differ is a paraphrase and must stay rejected — the accent is drawn on
 * the card by finding this exact substring, so a near-miss would render nothing
 * and take the card's emphasis with it.
 */
export function normalizeHighlight(raw: string, full: string): string | null {
  const phrase = raw.trim()
  // Must contain a word. Bare punctuation passes a naive substring test — the
  // reflection obviously contains "." — and would set a card's accent to a
  // character, which the composition then highlights somewhere arbitrary.
  if (!/\p{L}/u.test(phrase)) return null
  if (full.includes(phrase)) return phrase
  const stripped = phrase.replace(/[.,;:!?\s]+$/, "")
  if (stripped && full.includes(stripped)) return stripped
  return null
}

export const _internal = { JSON_SCHEMA }
