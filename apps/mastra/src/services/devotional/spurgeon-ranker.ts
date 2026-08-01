import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import { requireAuthoredPrompt } from "./authored-data"
import type { ReflectionEntry } from "./reflection-corpus"

/**
 * Pick the best Spurgeon entry for a scene from a keyword shortlist.
 *
 * Keyword scoring gets us a shortlist, but it can pick a thematically-adjacent
 * entry that doesn't actually fit the scene (e.g. a Zacchaeus devotional that
 * drifted to "Christ's attributes" instead of "seeking the lost"). A cheap LLM
 * rank over the small shortlist chooses the entry that best fits — OR reports
 * that NONE genuinely fits (index -1), in which case this returns null and the
 * caller falls back to on-passage commentary. Quality over forced rotation.
 */

// -1 = "none of these genuinely fits this scene → use commentary instead".
const PickSchema = z.object({ index: z.number().int().min(-1) }).strict()

const PICK_JSON_SCHEMA = {
  name: "spurgeon_pick",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { index: { type: "integer", minimum: -1 } },
    required: ["index"],
  },
}

const SNIPPET = 240

export type PickBestSpurgeonInput = {
  sceneTitle: string
  reference: string
  candidates: ReflectionEntry[]
  llm: DevotionalLlm
  systemPrompt?: string
}

export async function pickBestSpurgeon(
  input: PickBestSpurgeonInput,
): Promise<ReflectionEntry | null> {
  const { candidates } = input
  if (candidates.length === 0) return null
  const systemPrompt = requireAuthoredPrompt(input.systemPrompt)

  const list = candidates
    .map(
      (c, i) =>
        `${i}. (${c.reference}) “${(c.verse ?? "").slice(0, 120)}” — ${c.text.slice(0, SNIPPET)}`,
    )
    .join("\n\n")

  try {
    const { index } = await input.llm.complete({
      system: systemPrompt,
      user: [
        `Scene: ${input.sceneTitle} (${input.reference})`,
        "",
        "Candidates:",
        list,
        "",
        "Which candidate best fits this scene? Return its index.",
      ].join("\n"),
      jsonSchema: PICK_JSON_SCHEMA,
      schema: PickSchema,
      temperature: 0,
      maxTokens: 50,
    })
    if (index < 0) return null // no genuine fit → caller uses commentary
    return candidates[index] ?? candidates[0]
  } catch (error) {
    // Can't judge fit → return null so the caller uses reliable on-passage
    // commentary rather than a possibly-mismatched Spurgeon entry.
    if (error instanceof DevotionalLlmError) return null
    throw error
  }
}
