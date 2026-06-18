import { z } from "zod"

import {
  MAX_DEVOTIONAL_REASONS,
  MAX_DEVOTIONAL_SHORT_TEXT,
  type Devotional,
  type SafetyDimension,
  type SafetyVerdict,
} from "./types"
import type { DevotionalLlm } from "./llm"

/**
 * The load-bearing automated check that decides whether a devotional may
 * auto-publish. An LLM judge scores doctrine, tone, and sensitivity; but the
 * FINAL verdict is computed in code, not delegated to the model: the gate
 * blocks if the judge says block, if any dimension is below the confidence
 * threshold (ambiguous -> block), or if the judge call fails (fail closed).
 * The workflow publishes ONLY on `pass`.
 */

const DEFAULT_MIN_CONFIDENCE = 0.6
const SAFETY_DIMENSIONS: SafetyDimension[] = ["doctrine", "tone", "sensitivity"]

const SYSTEM_PROMPT = [
  "You are a strict reviewer guarding a Jesus Film-branded daily devotional",
  "before it auto-publishes. Score three dimensions from 0 to 1 (1 = clearly",
  "safe): doctrine (sound, orthodox, no scripture misuse), tone (warm, never",
  "opportunistic about tragedy), sensitivity (no partisan or political stance).",
  "Recommend verdict 'block' for any doctrinal error, partisan/political stance,",
  "insensitively framed tragedy, or scripture misuse. When uncertain, prefer",
  "'block'. List concrete reasons, especially when blocking. Return JSON only.",
].join("\n")

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
      verdict: { type: "string", enum: ["pass", "block"] },
      doctrine: { type: "number", minimum: 0, maximum: 1 },
      tone: { type: "number", minimum: 0, maximum: 1 },
      sensitivity: { type: "number", minimum: 0, maximum: 1 },
      reasons: {
        type: "array",
        maxItems: MAX_DEVOTIONAL_REASONS,
        items: { type: "string", minLength: 1, maxLength: MAX_DEVOTIONAL_SHORT_TEXT },
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
}

function renderDevotional(devotional: Devotional): string {
  return [
    `Hook (${devotional.hook.type}): ${devotional.hook.title} — ${devotional.hook.summary}`,
    `Scripture ${devotional.scripture.reference}: ${devotional.scripture.text}`,
    devotional.video ? `Video: ${devotional.video.title}` : "Video: (none)",
    `Reflection: ${devotional.reflection}`,
    `Questions: ${devotional.questions.join(" | ")}`,
    devotional.furtherReading
      ? `Further reading: ${devotional.furtherReading}`
      : "Further reading: (none)",
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
  const threshold = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE

  let response: z.infer<typeof JudgeResponseSchema>
  try {
    response = await options.llm.complete({
      system: SYSTEM_PROMPT,
      user: renderDevotional(options.devotional),
      jsonSchema: SAFETY_JSON_SCHEMA,
      schema: JudgeResponseSchema,
      temperature: 0,
      maxTokens: 600,
    })
  } catch {
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
    reasons.push(`low confidence on: ${lowDimensions.join(", ")}`)
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
  SYSTEM_PROMPT,
  DEFAULT_MIN_CONFIDENCE,
  failClosed,
}
