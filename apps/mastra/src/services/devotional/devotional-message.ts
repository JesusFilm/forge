import { z } from "zod"

import type { DevotionalLlm } from "./llm"

/**
 * The devotional's message, decided before anything is written (feat-572).
 * Every later agent receives it, so the title, the reflection, the takeaway,
 * the question and the prayer all serve one idea instead of each inferring its
 * own from the text. There is no separate approval stop for it (owner,
 * 2026-09-29): she reviews it beside the finished script, and changing it
 * regenerates everything downstream.
 */
export type DevotionalMessage = {
  /** What the viewer should carry away, one or two sentences. */
  idea: string
  /** What in the story resists that idea: why it is not obvious. */
  tension: string
  /** Where the personal question should point (a direction, not the question). */
  askDirection: string
  /** Why this idea, in the passage's own terms: which verses carry it. */
  grounding: string
  /** The one or two commentator points (1-based) that carry the idea; the
   *  writer sees only these, and fidelity is judged against only these. */
  classicPoints: number[]
}

const MessageSchema = z
  .object({
    idea: z.string().trim().min(1),
    tension: z.string().trim().min(1),
    askDirection: z.string().trim().min(1),
    grounding: z.string().trim().min(1),
    classicPoints: z.array(z.number().int()),
  })
  .strict()

const JSON_SCHEMA = {
  name: "devotional_message",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      idea: { type: "string" },
      tension: { type: "string" },
      askDirection: { type: "string" },
      grounding: { type: "string" },
      classicPoints: { type: "array", items: { type: "integer" } },
    },
    required: ["idea", "tension", "askDirection", "grounding", "classicPoints"],
  },
}

export const SYSTEM_PROMPT = [
  "You decide the MESSAGE of a short Bible devotional video before anyone",
  "writes it. The viewer watches a film scene that reads a Gospel passage word",
  "for word, then hears a reflection of about two minutes, a takeaway, one",
  "personal question and a short prayer. The audience already follows Jesus.",
  "",
  "You get the passage (Berean Standard Bible), the verses around it that set",
  "the scene, and the points a classic commentator (public domain) makes on it.",
  "",
  "Return:",
  "- idea: the one thing the viewer should carry away. One or two sentences,",
  "  plain words, specific to THIS passage. Not a general Christian truth that",
  "  would fit any passage. It must be something the text itself says or",
  "  clearly shows; Scripture bounds the idea, never the other way round.",
  "- tension: what in the story resists that idea, so it is not obvious: the",
  "  reasonable objection, the character the viewer secretly agrees with, the",
  "  detail that does not sit right. This is what keeps someone watching.",
  "- askDirection: where the personal question at the end should point. A",
  "  direction for a later writer, not the question itself.",
  "- grounding: which verses carry the idea and why, in one or two sentences.",
  "- classicPoints: the numbers of the ONE or TWO commentator points that",
  "  carry this idea. The reflection is about two minutes long: it can hold",
  "  one or two of his points well, never all of them.",
  "",
  "Prefer the reading a careful reader of the whole passage would reach over",
  "the most familiar one. Use the setting verses: who Jesus is speaking to",
  "often decides what the story is about. The commentator is a guide, not a",
  "master: take his insight where the text supports it.",
  "No em dashes or en dashes. Return JSON only.",
].join("\n")

export async function decideMessage(input: {
  passageReference: string
  passageText: string
  settingReference?: string
  settingText?: string
  classicSource: string
  classicPoints: string[]
  llm: DevotionalLlm
}): Promise<DevotionalMessage> {
  const user = [
    `Passage (${input.passageReference}, BSB):`,
    input.passageText,
    "",
    ...(input.settingText
      ? [`Setting (${input.settingReference}, BSB):`, input.settingText, ""]
      : []),
    `Classic commentary (${input.classicSource}), its points:`,
    ...input.classicPoints.map((p, i) => `(${i + 1}) ${p}`),
  ].join("\n")
  return input.llm.complete({
    system: SYSTEM_PROMPT,
    user,
    jsonSchema: JSON_SCHEMA,
    schema: MessageSchema,
    temperature: 0.4,
    maxTokens: 700,
  })
}

/** The message as a block for a later agent's prompt. */
export function messageBlock(m: DevotionalMessage): string {
  return [
    "THE MESSAGE this devotional serves (decided earlier; every part of your",
    "output must serve it, and none of it may stretch Scripture to fit it):",
    `- Idea: ${m.idea}`,
    `- Tension: ${m.tension}`,
    `- The personal question points toward: ${m.askDirection}`,
    `- Grounding: ${m.grounding}`,
  ].join("\n")
}

export const _internal = { JSON_SCHEMA }
