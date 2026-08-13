import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"
import type { CommentaryPoint } from "./reflection-points"

/**
 * Point picker — decides WHICH of a commentary's numbered points the
 * reflection is built from. Deliberately a separate, tiny, structured call.
 *
 * Why it isn't the modernizer's job: asking one call to both choose two
 * points and write the reflection does not hold. With the four-point
 * Zacchaeus excerpt and an explicit "choose exactly two" instruction in the
 * prompt, the writer still spread across three or four points and ran well
 * over the word target — the selection decision loses to the writing task
 * for the model's attention. (Same failure shape as bundling the conclusion
 * in with title/question/prayer, which is why that got split out too.)
 *
 * Splitting it makes selection a HARD constraint rather than a request: the
 * writer is handed only the chosen points' text, so it cannot wander into
 * the others even if it wanted to.
 *
 * Returns 1–2 indices. One point is a legitimate answer when the verse
 * clearly belongs to a single point; two is the normal case and should form
 * an arc (what God does → what it means for the viewer).
 */

const MAX_POINTS = 2

const Schema = z
  .object({
    // TRIMMED, not rejected. `.max(MAX_POINTS)` was a hard reject, and once the
    // array bounds left the JSON schema (Anthropic rejects minItems/maxItems)
    // nothing told the model the cap any more — so an over-long answer became a
    // `validation` error, which this agent's fail-open path turned into "fall
    // back to point 1". A model naming three points would silently collapse the
    // devotional to one, with no error surfaced anywhere.
    //
    // Deliberately NOT capped here. The caller de-duplicates, drops
    // out-of-range indices, orders, and only then slices to MAX_POINTS, which is
    // the sequence that yields two real points. Capping the RAW answer first
    // destroys valid candidates behind a repeated or hallucinated index:
    // [3,3,5] became [3,3] became [3], and [99,2,4] became [99,2] became [2] —
    // one point, which is the exact collapse this schema's previous comment
    // claimed to prevent. Verified by running the schema, not by reading it.
    chosen: z.array(z.number().int().min(1)).min(1),
    reason: z.string(),
  })
  .strict()

const JSON_SCHEMA = {
  name: "reflection_point_choice",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      chosen: {
        type: "array",
        // NO validation keywords here — not `minimum` on the items, and not
        // `minItems`/`maxItems` on the array. Anthropic's structured-output
        // backend rejects each with a 400 ("For 'array' type, property
        // 'maxItems' is not supported"). An earlier pass removed `minimum` and
        // left the array bounds, which is precisely the half-fix that
        // `anthropic-schema-compat.test.ts` now catches automatically.
        //
        // Harmless on the OpenAI model configured today, but this agent fails
        // OPEN (falls back to point 1), so a model swap would quietly reduce
        // every devotional to its first point with nothing surfaced. Bounds are
        // enforced by the zod schema below and restated in the prompt.
        items: { type: "integer" },
      },
      reason: { type: "string" },
    },
    required: ["chosen", "reason"],
  },
}

export const SYSTEM_PROMPT = [
  "You choose which of a classic commentator's numbered points a short",
  "devotional video should be built from. You are given the Bible scene the",
  "viewer just watched, the single verse shown on screen, and the author's",
  "numbered points.",
  "AUDIENCE (this governs the whole choice): the viewer ALREADY follows",
  "Jesus, often as a new believer. The finished reflection must encourage and",
  "deepen a fellow believer — never question whether the viewer is or can",
  "become a Christian, and never make an appeal to convert.",
  "",
  `Choose TWO points, or ONE. Rules, in priority order:`,
  "1. AUDIENCE FIT comes first. A point's REGISTER is inherited by the whole",
  "   finished reflection, so this is decided here, not later. These authors",
  "   mix two kinds of point: some address the BELIEVER directly (what a",
  "   converted life looks like, how to hold a doctrine, how to face trials),",
  "   and some coach the believer on PROCLAIMING the gospel to the lost",
  "   ('offer the Gospel boldly to the worst and wickedest', 'bid them come').",
  "   A pairing built only from the second kind produces a reflection that",
  "   preaches AT the viewer as though they were unconverted, which is the",
  "   wrong audience. At least one chosen point must speak to the believer",
  "   about their own walk. Prefer such a point even over a slightly better",
  "   verse match.",
  "2. The QUOTED VERSE decides between the remaining candidates. Pick points",
  "   whose subject is what that verse actually says, not merely what the",
  "   wider passage contains.",
  "3. Prefer TWO that form an ARC: typically what God/Christ does, then what",
  "   that means for the believer's own life (grace, then the response grace",
  "   produces). That pairing is what the approved reference used, and it",
  "   both reads better and keeps the register anchored.",
  "4. Choose ONE only when a second point would genuinely dilute the verse's",
  "   own subject. Two is the normal answer.",
  "5. Ignore how quotable or vivid a point's writing is. A point full of",
  "   striking images is not a better choice than a plainer point that",
  "   actually matches the verse and the audience.",
  "Return JSON only: { chosen: [indices], reason: one short sentence }.",
].join("\n")

export type PickReflectionPointsInput = {
  points: ReadonlyArray<CommentaryPoint>
  sceneTitle: string
  scriptureReference?: string
  scriptureText?: string
  /** Word budget for the finished reflection — the picker needs it to judge
   *  whether two points can honestly fit. */
  approxWords?: number
  llm: DevotionalLlm
}

function countWords(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/** A short label per point so the picker sees its subject, not its full text. */
function summarize(point: CommentaryPoint): string {
  // The lead-in sentence carries the point's thesis ("We learn, firstly, that
  // no one is too bad to be saved"), so the opening is the most informative
  // slice to show; the rest is elaboration the picker doesn't need.
  const firstSentence = point.text.split(/(?<=[.!?])\s+/)[0] ?? point.text
  return firstSentence.slice(0, 400)
}

/**
 * Pick the points. Best-effort: on any LLM failure, falls back to the FIRST
 * point rather than throwing — a reflection built from point 1 is always
 * better than no devotional at all, and point 1 is where these authors
 * normally state the passage's main lesson.
 */
export async function pickReflectionPoints(
  input: PickReflectionPointsInput,
): Promise<{ chosen: number[]; reason: string }> {
  const { points } = input
  if (points.length === 0) return { chosen: [], reason: "no points" }
  if (points.length <= MAX_POINTS) {
    return {
      chosen: points.map((p) => p.index),
      reason: `only ${points.length} point(s) available`,
    }
  }

  const user = [
    `Scene the viewer just watched: ${input.sceneTitle}`,
    ...(input.scriptureReference && input.scriptureText
      ? [
          `Verse shown on screen (${input.scriptureReference}): ${input.scriptureText}`,
        ]
      : []),
    ...(input.approxWords
      ? [
          `Budget for the finished reflection: about ${input.approxWords} words TOTAL.`,
        ]
      : []),
    "",
    "The author's points (source length shown — compare it to the budget):",
    ...points.map(
      (p) => `${p.index}. [${countWords(p.text)} source words] ${summarize(p)}`,
    ),
  ].join("\n")

  try {
    const result = await input.llm.complete({
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: JSON_SCHEMA,
      schema: Schema,
      temperature: 0,
      maxTokens: 200,
    })
    // Drop hallucinated indices; de-duplicate; keep the author's own order so
    // the reflection follows the commentary's flow rather than the picker's.
    const valid = [...new Set(result.chosen)]
      .filter((i) => i >= 1 && i <= points.length)
      .sort((a, b) => a - b)
      .slice(0, MAX_POINTS)
    if (valid.length === 0) {
      return {
        chosen: [points[0].index],
        reason: "picker returned no valid index",
      }
    }
    return { chosen: valid, reason: result.reason }
  } catch (error) {
    if (error instanceof DevotionalLlmError) {
      return {
        chosen: [points[0].index],
        reason: `picker skipped: ${error.code}`,
      }
    }
    throw error
  }
}

export const _internal = { JSON_SCHEMA, Schema }
