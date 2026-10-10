import { z } from "zod"

import {
  MAX_DEVOTIONAL_REASONS,
  MAX_DEVOTIONAL_SHORT_TEXT,
  type Devotional,
  type SafetyDimension,
  type SafetyVerdict,
} from "./types"
import type { DevotionalLlm } from "./llm"
import {
  IMMUTABLE_MIN_SAFETY_CONFIDENCE,
  requireAuthoredPrompt,
} from "./authored-data"

/**
 * The load-bearing automated check that decides whether a devotional may
 * auto-publish. An LLM judge scores doctrine, tone, and sensitivity; but the
 * FINAL verdict is computed in code, not delegated to the model: the gate
 * blocks if the judge says block, if any dimension is below the confidence
 * threshold (ambiguous -> block), or if the judge call fails (fail closed).
 * The workflow publishes ONLY on `pass`.
 */

const SAFETY_DIMENSIONS: SafetyDimension[] = ["doctrine", "tone", "sensitivity"]

const JudgeResponseSchema = z
  .object({
    verdict: z.enum(["pass", "block"]),
    doctrine: z.number().min(0).max(1),
    tone: z.number().min(0).max(1),
    sensitivity: z.number().min(0).max(1),
    reasons: z
      .array(z.string().trim().min(1).max(MAX_DEVOTIONAL_SHORT_TEXT))
      .max(MAX_DEVOTIONAL_REASONS)
      .default([]),
  })
  .strict()

const SAFETY_JSON_SCHEMA = {
  name: "devotional_safety_verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      // No minimum/maximum — Anthropic's structured-output schema (the default
      // safety-model provider) rejects numeric range constraints, the same way
      // it rejects array maxItems. The 0..1 range is steered by the prompt and
      // enforced by SafetyVerdictResponseSchema (.min(0).max(1)) after parse.
      verdict: { type: "string", enum: ["pass", "block"] },
      doctrine: { type: "number" },
      tone: { type: "number" },
      sensitivity: { type: "number" },
      // No maxItems — Anthropic's structured-output schema rejects array
      // item-count constraints. Count is enforced by the Zod schema after parse.
      reasons: {
        type: "array",
        items: {
          type: "string",
          minLength: 1,
          maxLength: MAX_DEVOTIONAL_SHORT_TEXT,
        },
      },
    },
    required: ["verdict", "doctrine", "tone", "sensitivity", "reasons"],
  },
}

export type EvaluateSafetyOptions = {
  devotional: Devotional
  llm: DevotionalLlm
  /** Minimum per-dimension score to allow a pass. Below this -> block. */
  minConfidence?: number
  systemPrompt?: string
}

function renderDevotional(devotional: Devotional): string {
  // Every publishable field is rendered — including link fields — so the gate
  // can score them. Wrapped in <CONTENT> markers and treated as untrusted data
  // by the system prompt so injected instructions in generated/fetched text
  // cannot steer the verdict.
  return [
    "<CONTENT>",
    `Hook (${devotional.hook.type}): ${devotional.hook.title} — ${devotional.hook.summary}`,
    devotional.hook.sourceUrl
      ? `Hook source: ${devotional.hook.sourceUrl}`
      : "Hook source: (none)",
    `Scripture ${devotional.scripture.reference}: ${devotional.scripture.text}`,
    devotional.video
      ? `Video: ${devotional.video.title} (${devotional.video.url})`
      : "Video: (none)",
    `Reflection: ${devotional.reflection}`,
    `Questions: ${devotional.questions.join(" | ")}`,
    // The guided prayer is spoken and burned into the video, so the judge must
    // score it too (a false "invitation to pray" is a doctrine defect).
    devotional.prayer ? `Prayer: ${devotional.prayer}` : "Prayer: (none)",
    devotional.furtherReading
      ? `Further reading: ${devotional.furtherReading}`
      : "Further reading: (none)",
    "</CONTENT>",
  ].join("\n")
}

/** Fail-closed verdict used whenever the judge cannot be trusted to run. */
function failClosed(reason: string): SafetyVerdict {
  return {
    verdict: "block",
    scores: { doctrine: 0, tone: 0, sensitivity: 0 },
    reasons: [reason],
  }
}

export async function evaluateSafety(
  options: EvaluateSafetyOptions,
): Promise<SafetyVerdict> {
  const threshold = Math.max(
    IMMUTABLE_MIN_SAFETY_CONFIDENCE,
    options.minConfidence ?? IMMUTABLE_MIN_SAFETY_CONFIDENCE,
  )

  let response: z.infer<typeof JudgeResponseSchema>
  try {
    response = await options.llm.complete({
      system: requireAuthoredPrompt(options.systemPrompt),
      user: renderDevotional(options.devotional),
      jsonSchema: SAFETY_JSON_SCHEMA,
      schema: JudgeResponseSchema,
      temperature: 0,
      maxTokens: 600,
    })
  } catch (error) {
    // Fail closed on any judge failure — but DON'T swallow the cause: a silent
    // catch here turned a schema-incompatibility into "every devotional blocked
    // with score 0", which looks like a content decision, not a bug. Surface it.
    console.warn(
      `[devotional safety] judge call failed, failing closed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    // Any judge failure (transport, request, validation) fails closed.
    return failClosed("safety judge unavailable — failing closed")
  }

  const scores: Record<SafetyDimension, number> = {
    doctrine: response.doctrine,
    tone: response.tone,
    sensitivity: response.sensitivity,
  }

  const lowDimensions = SAFETY_DIMENSIONS.filter(
    (dimension) => scores[dimension] < threshold,
  )

  // Code — not the model alone — decides: block on judge-block OR any
  // low-confidence dimension (ambiguous -> block).
  const blocked = response.verdict === "block" || lowDimensions.length > 0

  const reasons = [...response.reasons]
  if (lowDimensions.length > 0) {
    // Prepend so the block rationale survives the reasons.slice cap below even
    // when the judge already returned the maximum number of reasons.
    reasons.unshift(`low confidence on: ${lowDimensions.join(", ")}`)
  }
  if (blocked && reasons.length === 0) {
    reasons.push("blocked by safety judge")
  }

  return {
    verdict: blocked ? "block" : "pass",
    scores,
    reasons: reasons.slice(0, MAX_DEVOTIONAL_REASONS),
  }
}

export const _internal = {
  DEFAULT_MIN_CONFIDENCE: IMMUTABLE_MIN_SAFETY_CONFIDENCE,
  failClosed,
  SAFETY_JSON_SCHEMA,
}
