import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"

/**
 * Reflection depth critic — flags a shallow/empty reflection before it ships.
 *
 * The reflection is a faithful adaptation of a public-domain author (Spurgeon
 * first, else Matthew Henry). When the source is thin, the reflection can read
 * as padded: tautologies ("when he feeds you, he fills you"), the same point
 * restated, obvious conclusions, or a concrete image referenced without grounding
 * ("the leftovers" with no antecedent). This agent scores those failure modes so
 * the operator (or a future auto-redo / source-switch) can catch them.
 *
 * It judges DEPTH and CRAFT, not doctrine, and does NOT ask the author to invent
 * — a thin source flagged here should be swapped, not embellished.
 */

export type ReflectionIssue = {
  kind: "tautology" | "repetition" | "obvious" | "ungrounded" | "no-single-idea"
  severity: "high" | "medium" | "low"
  problem: string
  suggestion: string
}

export type ReflectionCritique = {
  /** true when the reflection lands one clear, non-obvious, grounded idea. */
  solid: boolean
  /** 1–5: 1 = empty/tautological, 5 = one sharp grounded insight. */
  depthScore: number
  issues: ReflectionIssue[]
  summary: string
  /** true when the LLM call failed (even after a retry) and `solid: true` /
   *  `depthScore: 3` are a fallback, NOT a real judgment — the check did not
   *  actually run. Callers must not treat this the same as a genuine pass. */
  skipped?: boolean
}

/**
 * Wait before the single retry, which used to fire IMMEDIATELY. The depth critic
 * failed twice in a row on three consecutive renders because of it, so every
 * render printed "REVIEW BEFORE PUBLISHING" and the gate stopped meaning
 * anything.
 *
 * The original note here blamed "a provider rate limit". That diagnosis does not
 * survive reading one layer down: createDevotionalLlm already retries 429 and
 * 5xx itself, honouring Retry-After, before it ever throws to this caller — so a
 * rate limit is the one cause that CANNOT reach here unresolved. What actually
 * reaches here is post-exhaustion network trouble, an upstream unhealthy for the
 * whole window, or a deterministic rejection. Only the first two are retried now
 * (see isWorthRetrying); the delay helps them, and the third no longer pays for a
 * second identical call.
 *
 * The measured cause of that incident was a deterministic one: the provider
 * rejecting a JSON-schema keyword, which failed on every call. A delay was never
 * going to fix it.
 */

const Schema = z
  .object({
    solid: z.boolean(),
    // CLAMPED, not rejected. The 1-5 bound cannot live in the JSON schema
    // (Anthropic 400s on integer minimum/maximum), and without it gpt-4o
    // happily answers "8" — which a strict zod bound then threw out as a
    // `validation` error, silently skipping the whole check. An out-of-range
    // score is a scale misread, not a reason to lose the critique, so pull it
    // back into range and keep the issues the critic actually found.
    depthScore: z
      .number()
      .int()
      .transform((n) => Math.min(5, Math.max(1, n))),
    issues: z.array(
      z.object({
        kind: z.enum([
          "tautology",
          "repetition",
          "obvious",
          "ungrounded",
          "no-single-idea",
        ]),
        severity: z.enum(["high", "medium", "low"]),
        problem: z.string(),
        suggestion: z.string(),
      }),
    ),
    summary: z.string(),
  })
  .strict()

const JSON_SCHEMA = {
  name: "reflection_critique",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      solid: { type: "boolean" },
      // NO minimum/maximum here. Anthropic's structured-output backend
      // (via OpenRouter's Azure/Bedrock providers) rejects them outright:
      // "For 'integer' type, properties maximum, minimum are not supported"
      // → HTTP 400 on EVERY call. This critic therefore never ran once; the
      // fail-open default (3/5, solid) made the logs look like it had. The
      // range is still enforced — by the zod schema below, on our side.
      depthScore: { type: "integer" },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: [
                "tautology",
                "repetition",
                "obvious",
                "ungrounded",
                "no-single-idea",
              ],
            },
            severity: { type: "string", enum: ["high", "medium", "low"] },
            problem: { type: "string" },
            suggestion: { type: "string" },
          },
          required: ["kind", "severity", "problem", "suggestion"],
        },
      },
      summary: { type: "string" },
    },
    required: ["solid", "depthScore", "issues", "summary"],
  },
}

const SYSTEM_PROMPT = [
  "You are a demanding devotional editor judging the DEPTH of a short reflection",
  "(a spoken meditation the viewer hears after watching a Bible scene).",
  "Flag these failure modes:",
  "- tautology: says the same thing twice as if it were a point ('when he feeds",
  "  you, he fills you').",
  "- repetition: the same idea restated in different words across sentences.",
  "- obvious: a conclusion no one would dispute or learn from (feeding = being fed).",
  "- ungrounded: leans on a concrete image with no antecedent ('the leftovers'",
  "  when leftovers were never set up).",
  "- no-single-idea: a scattered list of UNRELATED points with no throughline.",
  "  Do NOT flag this just because the reflection covers more than one point —",
  "  classic commentators (e.g. Ryle) often build 2-3 CONNECTED points toward one",
  "  argument about the passage; covering those faithfully is fidelity, not",
  "  padding. Only flag when the points don't actually connect to each other.",
  "depthScore MUST be an integer from 1 to 5 — 1 = empty/tautological, 5 = one",
  "sharp grounded insight. Never answer outside 1-5 (the range cannot be",
  "enforced by the response schema, so it is on you).",
  "A SOLID reflection lands one clear, non-obvious, grounded insight the viewer",
  "can carry, even if it takes the author's own connected points to get there.",
  "Judge depth and craft, NOT doctrine. If it is thin, say so plainly — the fix",
  "is a richer source, not invented content.",
  "HARD GUARDRAIL (set solid=false and say so in the summary if violated): the",
  "reflection must NOT contain denominational/confessional polemic (attacks on",
  "Catholics or other traditions) or predestination/election teaching. Flag",
  "either as an 'obvious' issue.",
  "WHAT COUNTS as predestination/election, precisely — the line matters and",
  "this guardrail has already misfired on the wrong side of it:",
  "- VIOLATION: God pre-chose only SOME people to be saved and the rest are",
  "  excluded; 'the elect' as a closed group; grace offered to a limited set.",
  "  The test is EXCLUSION of others.",
  "- NOT a violation: Christ taking the initiative toward one person unasked,",
  "  and that person doing nothing to deserve it. 'He stopped without being",
  "  asked', 'he sent his renewing grace into that heart that very day',",
  "  'sought and saved without having done anything to deserve it' are the",
  "  plain sense of these passages and the classic authors' central point.",
  "  Unearned, unasked grace toward THIS person says nothing about anyone",
  "  being excluded. Do NOT flag it.",
  "Return JSON only.",
].join("\n")

export type CritiqueReflectionInput = {
  sceneTitle: string
  reflection: string
  conclusion: string
  llm: DevotionalLlm
  /** Cancellation from the workflow step. Without it a cancelled run keeps
   *  paying for critics nobody will read. */
  abortSignal?: AbortSignal
}

export async function critiqueReflection(
  input: CritiqueReflectionInput,
): Promise<ReflectionCritique> {
  const user = [
    `SCENE: ${input.sceneTitle}`,
    "",
    `REFLECTION:\n${input.reflection}`,
    "",
    `CLOSING TAKEAWAY: ${input.conclusion}`,
  ].join("\n")
  const attempt = () =>
    input.llm.complete({
      abortSignal: input.abortSignal,
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: JSON_SCHEMA,
      schema: Schema,
      temperature: 0.2,
      maxTokens: 1000,
    })

  // Degraded result shared by both give-up paths, so a non-retryable failure and
  // a failed retry cannot drift into different shapes.
  /**
   * The degraded result.
   *
   * Advisory step: never block a render on a checker failure — but mark it
   * `skipped`, so a mid-range `depthScore` from this fallback is never read as a
   * real score. The check did not run; it did not pass.
   */
  const skipped = (cause: DevotionalLlmError) => ({
    solid: true,
    depthScore: 3,
    issues: [],
    summary: `reflection critique skipped: ${cause.code}${cause.status ? ` (${cause.status})` : ""}`,
    skipped: true,
  })

  try {
    return await attempt()
  } catch (error) {
    // ONE attempt. The client below owns the retry budget — 429/5xx up to three
    // attempts honouring Retry-After — so by the time it throws, trying again
    // here just doubles a budget that is already spent. A previous version added
    // a retry plus a 2s delay, justified by "the most likely cause is a provider
    // rate limit"; that is the one cause the client cannot pass through
    // unresolved, and the incident behind it was a deterministic schema
    // rejection that failed identically on every call.
    if (error instanceof DevotionalLlmError) return skipped(error)
    throw error
  }
}

export const _internal = { JSON_SCHEMA, Schema }
