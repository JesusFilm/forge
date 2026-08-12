import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import { MAX_DEVOTIONAL_SHORT_TEXT } from "./types"

/**
 * Conclusion writer — a dedicated, narrow agent, split out of the general
 * copywriter (devotional-copy.ts) because "conclusion" turned out to carry a
 * different, harder set of rules than title/question/prayer: it must echo
 * THIS reflection's own imagery rather than invent new imagery, it must not
 * duplicate a sentence already in the reflection, and it must avoid abstract
 * "God's power/attribute is for/committed to you" phrasing that reads as
 * instrumentalizing God to serve the viewer's own plans (owner-reported, on
 * "All his almighty power is engaged on your behalf").
 *
 * Runs AFTER the copywriter so it can see the already-chosen title/question/
 * prayer and stay complementary to them rather than redundant. Splitting it
 * out also means a bad conclusion retries on its own — the old bundled
 * design retried all four fields together, discarding a fine title/question/
 * prayer whenever only the conclusion was the problem.
 */

const ConclusionSchema = z
  .object({
    conclusion: z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT),
  })
  .strict()

const CONCLUSION_JSON_SCHEMA = {
  name: "devotional_conclusion",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      conclusion: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVOTIONAL_SHORT_TEXT,
      },
    },
    required: ["conclusion"],
  },
}

export const SYSTEM_PROMPT = [
  "You write ONE closing line for a short vertical devotional video — the",
  "'conclusion' card the viewer sees right after the reflection, before the",
  "question and prayer. This is the single line viewers are most likely to",
  "remember, so it carries more weight than an ordinary line of copy.",
  "You are given the full reflection text, plus the title/question/prayer",
  "that have already been written for this same devotional.",
  "AUDIENCE: the viewer ALREADY follows Jesus (often a new believer).",
  "Encourage and deepen a fellow believer. Do NOT question whether they are,",
  "or can become, a Christian; do NOT make an evangelistic appeal to convert;",
  "do NOT imply they have yet to receive, accept, or come to Christ. If the",
  "reflection coaches the viewer on speaking to OTHERS who don't yet believe,",
  "keep that direction — the closing line still addresses the believer, not",
  "the people they are being sent to. A line like 'come to Jesus just as you",
  "are' is the wrong audience here even when the reflection above says it",
  "about someone else.",
  "RULES:",
  "1. Land the reflection's main truth in a fresh sentence — the one thing",
  "   the viewer should carry away.",
  "2. Draw ONLY on imagery, events, or wording already present in THIS",
  "   reflection (e.g. if it mentions a storm being calmed, you may echo",
  "   that; do NOT introduce a boat, a voice, a lighthouse, or any other",
  "   image the reflection itself never used).",
  "3. Do NOT verbatim or near-verbatim repeat any sentence already in the",
  "   reflection. Say the same truth in genuinely new words, not a copy.",
  "4. Do NOT be redundant with the title, question, or prayer you were",
  "   given — say something the rest of the set hasn't already said.",
  "5. AVOID abstract claims that God's power or attributes are 'for you' /",
  "   'engaged on your behalf' / 'committed to you' with no concrete action",
  "   named — out of context, that phrasing reads as 'God's power exists to",
  "   make my plans succeed', which is backwards. Name a concrete action",
  "   the reflection actually describes (what he did, what he will not let",
  "   happen to you) instead of an abstract claim about power being 'for' you.",
  "6. One sentence. Punchy, not a recap, not a general Christian cliche —",
  "   specific to what THIS reflection actually says.",
  "7. DESCRIBE, DON'T COMMAND. This line is spoken by a SYNTHETIC VOICE, not",
  "   by a pastor the viewer knows and trusts. A command from an anonymous",
  "   machine voice ('Let your life prove it', 'Go and do likewise') reads as",
  "   scolding, however true it is. State the truth instead and let it land:",
  "   'A changed life is the evidence grace leaves behind' says the same",
  "   thing as 'Let your transformed life be the evidence' without ordering",
  "   the viewer around. Avoid imperatives entirely unless the line is a warm",
  "   invitation rather than a demand.",
  "PUNCTUATION: do NOT use em dashes or en dashes (— or –) anywhere. They",
  "read as AI writing. Use a period, comma, or colon, or restructure.",
  "Return JSON only: an object with a 'conclusion' string.",
].join("\n")

/** Normalize for a loose duplicate check: lowercase, strip trailing/leading
 *  punctuation, collapse whitespace. */
function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** true when `conclusion` is a verbatim (or near-verbatim) copy of a sentence
 *  already present in `reflection` — reaching for the easiest "punchy" line
 *  by lifting one straight out instead of restating it. */
export function conclusionDuplicatesReflection(
  conclusion: string,
  reflection: string,
): boolean {
  const normalizedConclusion = normalizeForCompare(conclusion)
  if (!normalizedConclusion) return false
  const normalizedReflection = normalizeForCompare(
    reflection.replace(/[.!?]+/g, ". "),
  )
  return normalizedReflection.includes(normalizedConclusion)
}

export type WriteDevotionalConclusionInput = {
  sceneTitle: string
  reference: string
  scriptureText: string
  /** The already-modernized reflection text this conclusion must echo. */
  reflection: string
  /** Already-chosen fields from the copywriter, so the conclusion stays
   *  complementary rather than redundant. */
  title: string
  question: string
  prayer: string
  llm: DevotionalLlm
}

export class DevotionalConclusionError extends Error {
  constructor(
    readonly code: "generation_failed" | "empty_output",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = "DevotionalConclusionError"
  }
}

function buildUser(input: WriteDevotionalConclusionInput): string {
  return [
    `Scene: ${input.sceneTitle}`,
    `Verse (${input.reference}): ${input.scriptureText}`,
    "",
    "Reflection:",
    input.reflection,
    "",
    `Title (already chosen): ${input.title}`,
    `Question (already chosen): ${input.question}`,
    `Prayer (already chosen): ${input.prayer}`,
  ].join("\n")
}

async function requestConclusion(
  llm: DevotionalLlm,
  user: string,
): Promise<string> {
  let result: z.infer<typeof ConclusionSchema>
  try {
    result = await llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: CONCLUSION_JSON_SCHEMA,
      schema: ConclusionSchema,
      temperature: 0.6,
      maxTokens: 150,
    })
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      throw new DevotionalConclusionError(
        "generation_failed",
        `devotional conclusion generation failed: ${error.code}`,
        error,
      )
    }
    throw error
  }
  return result.conclusion.trim()
}

export async function writeDevotionalConclusion(
  input: WriteDevotionalConclusionInput,
): Promise<{ conclusion: string }> {
  const user = buildUser(input)
  let conclusion = await requestConclusion(input.llm, user)
  if (!conclusion) {
    throw new DevotionalConclusionError(
      "empty_output",
      "conclusion writer returned empty text",
    )
  }

  // Mechanical backstop: the copywriter used to reach for the easiest
  // "punchy" conclusion by lifting a sentence straight out of the reflection
  // (observed live: "All his almighty power is engaged on your behalf"
  // appeared verbatim in both). One retry, asking explicitly for different
  // words, before accepting it as-is.
  if (conclusionDuplicatesReflection(conclusion, input.reflection)) {
    const retryUser = [
      user,
      "",
      `Your previous conclusion ("${conclusion}") just repeats a sentence`,
      "already in the reflection above. Write a DIFFERENT conclusion — the",
      "same core truth, in genuinely new words, not a copy of an existing",
      "sentence.",
    ].join("\n")
    conclusion = await requestConclusion(input.llm, retryUser)
    if (!conclusion) {
      throw new DevotionalConclusionError(
        "empty_output",
        "conclusion writer returned empty text on retry",
      )
    }
  }

  return { conclusion }
}

export const _internal = { JSON_SCHEMA: CONCLUSION_JSON_SCHEMA }
