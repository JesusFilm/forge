import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"

/**
 * Coherence checker: verifies the whole devotional tells ONE grounded message.
 *
 * A devotional is assembled from independent parts (scripture verse, reflection,
 * title, question, prayer) over a video scene. Each part can be fine on its own
 * yet the whole can drift — the classic failure is the reflection leaning on an
 * IMAGE (e.g. "the leftovers / twelve baskets") that is NOT in the chosen verse
 * or shown in the clip, so the viewer hears a claim with no anchor.
 *
 * This agent reads the finished parts + the scene and flags such gaps, with a
 * concrete suggestion (e.g. "the reflection centers on the leftovers — use the
 * verse that mentions them: Luke 9:17"). Advisory: it reports, it does not edit.
 */

/**
 * Wait before the single retry. The first retry used to fire IMMEDIATELY,
 * which is useless against the most likely cause of a `request_failed` — a
 * provider rate limit. The depth critic failed twice in a row on three
 * consecutive renders because of it, which meant every render printed
 * "REVIEW BEFORE PUBLISHING" and the gate stopped meaning anything.
 */
const RETRY_DELAY_MS = 2_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export type CoherenceIssue = {
  severity: "high" | "medium" | "low"
  area:
    | "scripture"
    | "title"
    | "reflection"
    | "conclusion"
    | "video"
    | "overall"
  problem: string
  suggestion: string
}

export type CoherenceReport = {
  coherent: boolean
  issues: CoherenceIssue[]
  summary: string
  /** If the reflection is best anchored by a DIFFERENT verse in the passage,
   *  the human reference to switch to (e.g. "Luke 9:17"); null when the current
   *  verse fits. */
  suggestedScriptureReference: string | null
  /** true when the LLM call failed (even after a retry) and `coherent: true`
   *  is a fallback, NOT a real verdict — the check did not actually run.
   *  Callers must not treat this the same as a genuine pass. */
  skipped?: boolean
}

const IssueSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  area: z.enum([
    "scripture",
    "title",
    "reflection",
    "conclusion",
    "video",
    "overall",
  ]),
  problem: z.string(),
  suggestion: z.string(),
})

const ReportSchema = z
  .object({
    coherent: z.boolean(),
    issues: z.array(IssueSchema),
    summary: z.string(),
    suggestedScriptureReference: z.string().nullable(),
  })
  .strict()

const JSON_SCHEMA = {
  name: "devotional_coherence_report",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      coherent: { type: "boolean" },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            severity: { type: "string", enum: ["high", "medium", "low"] },
            area: {
              type: "string",
              enum: [
                "scripture",
                "title",
                "reflection",
                "conclusion",
                "video",
                "overall",
              ],
            },
            problem: { type: "string" },
            suggestion: { type: "string" },
          },
          required: ["severity", "area", "problem", "suggestion"],
        },
      },
      summary: { type: "string" },
      suggestedScriptureReference: { type: ["string", "null"] },
    },
    required: ["coherent", "issues", "summary", "suggestedScriptureReference"],
  },
}

const SYSTEM_PROMPT = [
  "You are a devotional EDITOR checking whether a short devotional video hangs",
  "together as ONE coherent message. The viewer watches a Bible scene on video,",
  "hears a scripture verse, then a reflection, a takeaway, a question, and a prayer.",
  "Check specifically:",
  "1. GROUNDING: does every key CONCRETE DETAIL in the reflection/title have an",
  "   anchor the viewer actually sees or hears? The classic failure: the reflection",
  "   leans on a concrete detail (an object, a number, an event) that is NOT in the",
  "   chosen verse and NOT in the scene shown. Flag it as HIGH severity.",
  "   NOT a grounding failure: DOCTRINE the reflection draws from elsewhere in",
  "   Scripture to interpret the scene (e.g. explaining a Gospel narrative via",
  "   Christ's high-priestly intercession from Hebrews). The reflection is",
  "   adapted from a classic commentator, and cross-referencing other books to",
  "   expound a passage is that tradition's normal method, not drift. Only flag",
  "   theology when it CONTRADICTS the scene or replaces the passage's own",
  "   subject, not merely because the doctrine isn't visible on screen.",
  "2. SCRIPTURE FIT: does the chosen verse actually support the reflection's central",
  "   point? If a DIFFERENT verse in the same passage would anchor it far better,",
  "   name it in suggestedScriptureReference (else null).",
  "3. TITLE: does the title match what the reflection is actually about?",
  "4. FLOW: title → scripture → reflection → takeaway → question → prayer should be",
  "   about the same core idea, not drift.",
  "Be concrete and specific; quote the drifting phrase. If it all hangs together,",
  "return coherent=true with an empty issues array.",
  "Return JSON only.",
].join("\n")

export type CheckCoherenceInput = {
  /** What the viewer SEES (the film scene). */
  sceneTitle: string
  scriptureReference: string
  scriptureText: string
  title: string
  reflection: string
  conclusion: string
  question: string
  prayer: string
  /** The full passage the clip covers, so it can suggest a better verse within it. */
  passageReference?: string
  llm: DevotionalLlm
}

export async function checkDevotionalCoherence(
  input: CheckCoherenceInput,
): Promise<CoherenceReport> {
  const user = [
    `VIDEO SCENE (what the viewer watches): ${input.sceneTitle}`,
    input.passageReference
      ? `PASSAGE the clip covers: ${input.passageReference}`
      : "",
    "",
    `SCRIPTURE VERSE shown (${input.scriptureReference}): ${input.scriptureText}`,
    "",
    `TITLE: ${input.title}`,
    "",
    `REFLECTION:\n${input.reflection}`,
    "",
    `TAKEAWAY: ${input.conclusion}`,
    `QUESTION: ${input.question}`,
    `PRAYER: ${input.prayer}`,
  ]
    .filter(Boolean)
    .join("\n")

  const attempt = () =>
    input.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: JSON_SCHEMA,
      schema: ReportSchema,
      temperature: 0.2,
      maxTokens: 1200,
    })

  try {
    return await attempt()
  } catch (firstError) {
    if (!(firstError instanceof DevotionalLlmError)) throw firstError
    await sleep(RETRY_DELAY_MS)
    try {
      return await attempt()
    } catch (error) {
      if (error instanceof DevotionalLlmError) {
        // Advisory step: never block a render on a checker failure — but mark
        // it `skipped` so this is never confused with a genuine coherent=true
        // verdict (the check simply did not run after a retry also failed).
        return {
          coherent: true,
          issues: [],
          summary: `coherence check skipped after retry: ${error.code}`,
          suggestedScriptureReference: null,
          skipped: true,
        }
      }
      throw error
    }
  }
}

export const _internal = { JSON_SCHEMA }
