import { z } from "zod"

import { messageBlock, type DevotionalMessage } from "./devotional-message"
import type { DevotionalLlm } from "./llm"

/**
 * The ending of the message-first path (feat-572), in the order the viewer
 * meets it: the takeaway first, as the concentrate of the reflection, then the
 * question and the prayer built from the FINAL reflection and that takeaway.
 * The reflection can find a sharper way into the application than the message
 * did (Vineyard's "good eye" came from the language note), so the question
 * follows the text, with the message as its compass.
 */

const TakeawaySchema = z
  .object({
    title: z.string().trim().min(1),
    takeaway: z.string().trim().min(1),
  })
  .strict()
const TAKEAWAY_JSON_SCHEMA = {
  name: "message_first_takeaway",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { title: { type: "string" }, takeaway: { type: "string" } },
    required: ["title", "takeaway"],
  },
}

export const TAKEAWAY_SYSTEM_PROMPT = [
  "You write two lines for a Bible devotional video.",
  "TAKEAWAY: the one sentence the viewer carries away, shown and spoken after",
  "the reflection. The concentrate of THIS reflection's line, in fresh words:",
  "not a sentence lifted from it, not a general Christian cliche, not a",
  "command. Use only images the reflection used. Under 20 words.",
  "TITLE: two to six words, the story's tension as the viewer would feel it",
  "(Vineyard's was \"That's not fair.\"). It must not give the answer away.",
  "No em dashes or en dashes. Return JSON only.",
].join("\n")

const PersonalSchema = z
  .object({
    question: z.string().trim().min(1),
    prayer: z.string().trim().min(1),
  })
  .strict()
const PERSONAL_JSON_SCHEMA = {
  name: "message_first_personal",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { question: { type: "string" }, prayer: { type: "string" } },
    required: ["question", "prayer"],
  },
}

export const PERSONAL_SYSTEM_PROMPT = [
  "You write the closing card of a Bible devotional video. The voice says",
  '"First, ask yourself:" and then your QUESTION, then "Talk to God about',
  'it:" and then your PRAYER. The audience already follows Jesus.',
  "QUESTION: one personal question that turns the reflection's point on the",
  "viewer's own life this week. Concrete enough to answer; built from the",
  "reflection's own images and words; never a test of whether they are",
  "saved. One sentence.",
  "PRAYER: one or two short sentences telling the viewer what to bring to God",
  "about that question, in the reflection's own terms (Vineyard: \"Name that",
  'person to God, and ask him for a good eye toward them."). It follows',
  '"Talk to God about it:", so it is an invitation in the second person,',
  "not a prayer in the first person.",
  "No em dashes or en dashes. Return JSON only.",
].join("\n")

export async function writeMessageFirstEnding(input: {
  message: DevotionalMessage
  passageReference: string
  reflection: string
  llm: DevotionalLlm
}): Promise<{
  title: string
  takeaway: string
  question: string
  prayer: string
}> {
  const base = [
    messageBlock(input.message),
    "",
    `PASSAGE: ${input.passageReference}`,
    "",
    "THE REFLECTION (final):",
    input.reflection,
  ].join("\n")
  const { title, takeaway } = await input.llm.complete({
    system: TAKEAWAY_SYSTEM_PROMPT,
    user: base,
    jsonSchema: TAKEAWAY_JSON_SCHEMA,
    schema: TakeawaySchema,
    temperature: 0.6,
    maxTokens: 300,
  })
  const { question, prayer } = await input.llm.complete({
    system: PERSONAL_SYSTEM_PROMPT,
    user: [base, "", `THE TAKEAWAY (already written): ${takeaway}`].join("\n"),
    jsonSchema: PERSONAL_JSON_SCHEMA,
    schema: PersonalSchema,
    temperature: 0.6,
    maxTokens: 300,
  })
  return { title, takeaway, question, prayer }
}

export const _internal = {
  JSON_SCHEMA: TAKEAWAY_JSON_SCHEMA,
  PERSONAL_JSON_SCHEMA,
}

const OpeningSchema = z
  .object({ lines: z.array(z.string().trim().min(1)) })
  .strict()
const OPENING_JSON_SCHEMA = {
  name: "message_first_opening",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { lines: { type: "array", items: { type: "string" } } },
    required: ["lines"],
  },
}

export const OPENING_SYSTEM_PROMPT = [
  "You write the spoken OPENING of a Bible devotional video, heard over a",
  'montage of the film before it plays. After "Welcome to Daily Bible',
  'Pause." come your lines, then "Let\'s watch."',
  "Three or four short lines. Open on the story's tension as the viewer",
  'would feel it (Vineyard: "That\'s not fair." / "It is the first sentence',
  'we learn, and the last one we let go of." / "Jesus told a story about',
  'that exact complaint."). The first line is the title as given. Do not give',
  "the answer away; do not name the lesson; no questions to the viewer about",
  "their faith; no commands. The last line points at the story about to play.",
  "No em dashes or en dashes. Return JSON only.",
].join("\n")

/** The montage opening, from the message's tension (feat-572 packaging). */
export async function writeMessageFirstOpening(input: {
  message: DevotionalMessage
  title: string
  passageReference: string
  llm: DevotionalLlm
}): Promise<string[]> {
  const out = await input.llm.complete({
    system: OPENING_SYSTEM_PROMPT,
    user: [
      messageBlock(input.message),
      "",
      `PASSAGE: ${input.passageReference}`,
      `TITLE (the first line): ${input.title}`,
    ].join("\n"),
    jsonSchema: OPENING_JSON_SCHEMA,
    schema: OpeningSchema,
    temperature: 0.6,
    maxTokens: 300,
  })
  return out.lines
}

export const _openingInternal = { JSON_SCHEMA: OPENING_JSON_SCHEMA }
