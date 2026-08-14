import { z } from "zod"

import { DevotionalLlmError, type DevotionalLlm } from "./llm"

/**
 * Reflection fidelity critic — checks the MODERNIZED text against the actual
 * source excerpt (Ryle/Henry), not just against itself.
 *
 * `devotional-reflection-critic.ts` judges depth/craft in isolation (is this
 * ONE reflection tautological, obvious, ungrounded?). This agent instead does
 * a side-by-side: did the adaptation invent a claim the author never made, drop
 * one of the author's own connected points and so unbalance the argument
 * (typically toward the more comforting half), erase a concrete detail the
 * author explicitly builds a lesson on (e.g. Zacchaeus climbing the tree), or
 * describe Christ's heavenly role in a way that reads as him existing "for"
 * the viewer rather than interceding for them (Hebrews 7:25)?
 *
 * Added after a real incident: two modernized reflections (Luke 8's storm,
 * Luke 19's Zacchaeus) both compressed the source down to its single most
 * comforting point, dropping load-bearing detail and — in the storm case —
 * echoing Ryle's own "living for them in Heaven" shorthand without the
 * Mediator/High-Priest framing that keeps it precise.
 *
 * This critic is the whole guard for that class today. An earlier version of
 * this comment pointed at "reflection-modernizer.ts's PRESERVE BALANCE /
 * heavenly-role guardrails" as the rules it verifies were followed. No such
 * section exists in any file — the modernizer's instructions are authored
 * Workspace data now, and neither phrase appears there either. So the critic
 * checks against its own criteria below, not against a named upstream rule, and
 * adding those rules to the authored modernizer prompt is still open work.
 */

export type FidelityIssue = {
  kind:
    | "invented-content"
    | "dropped-argument"
    | "narrative-erasure"
    | "imprecise-theology"
  severity: "high" | "medium" | "low"
  problem: string
  suggestion: string
}

export type ReflectionFidelityCritique = {
  /** true when the adaptation is a faithful, balanced compression of the source. */
  faithful: boolean
  issues: FidelityIssue[]
  summary: string
  /** true when the LLM call failed (even after a retry) and `faithful: true`
   *  is a fallback, NOT a real verdict — the check did not actually run.
   *  Callers must not treat this the same as a genuine pass. */
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
    faithful: z.boolean(),
    issues: z.array(
      z.object({
        kind: z.enum([
          "invented-content",
          "dropped-argument",
          "narrative-erasure",
          "imprecise-theology",
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
  name: "reflection_fidelity_critique",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      faithful: { type: "boolean" },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            kind: {
              type: "string",
              enum: [
                "invented-content",
                "dropped-argument",
                "narrative-erasure",
                "imprecise-theology",
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
    required: ["faithful", "issues", "summary"],
  },
}

const SYSTEM_PROMPT = [
  "You are a demanding theological editor comparing a MODERNIZED reflection",
  "against the ORIGINAL classic-author excerpt it was adapted from (Ryle or",
  "Matthew Henry). Your job is FIDELITY, not style — did the adaptation keep the",
  "author's actual argument and balance, or did it quietly distort it?",
  "Flag these failure modes:",
  "- invented-content: the adaptation states a claim, image, or argument the",
  "  source excerpt does not actually make.",
  "- dropped-argument: the source builds 2+ CONNECTED points toward the passage",
  "  (Ryle especially: 'firstly... secondly... thirdly...'). Dropping one is a",
  "  fidelity failure ONLY when the adaptation's own kept content then",
  "  misrepresents, needs, or contradicts the dropped point to make sense —",
  "  e.g. it states a claim that's only true/complete with the missing point,",
  "  or it flattens an active choice into passivity because the detail proving",
  "  the choice was cut. If the KEPT points already form one complete,",
  "  self-contained line on their own terms (e.g. 'he shared your weakness,",
  "  AND he has power over your storm' is a complete pairing that doesn't",
  "  need every other point the author makes to be true or coherent), and the",
  "  dropped point neither contradicts nor is needed to understand what was",
  "  kept, that is a legitimate editorial choice of ONE throughline among",
  "  several the source offers — do NOT flag it. Only flag genuinely",
  "  connected points whose absence breaks or misleads about what remains; a",
  "  source tangent unrelated to the focus passage is also fine to skip.",
  "- narrative-erasure: the author explicitly draws a spiritual lesson from ONE",
  "  concrete action or detail (e.g. Zacchaeus running ahead and climbing the",
  "  sycamore tree despite his status, to see Jesus), and the adaptation drops",
  "  that detail entirely, so the lesson built on it is lost or flattened into a",
  "  vaguer, more passive claim than the author actually made.",
  "- imprecise-theology: Christ's heavenly role is described as him existing,",
  "  living, or being 'for' the viewer with no intercession/mediation language",
  "  attached — this reads as Christ's purpose being to serve the viewer, which",
  "  is backwards even when the author's own shorthand ('living for them in",
  "  Heaven') is the source of the phrase. The fix is always to attach",
  "  intercession/mediation wording, never to soften the doctrine of grace itself.",
  "Judge FIDELITY to what THIS author wrote about THIS passage. Do not fault the",
  "adaptation for modernizing vocabulary, shortening sentences, or compressing —",
  "only for losing or distorting the author's actual content and balance.",
  "Return JSON only.",
].join("\n")

export type CritiqueReflectionFidelityInput = {
  /** The raw excerpt handed to the modernizer (GeneratedDevotional.reflection.sourceExcerpt). */
  sourceExcerpt: string
  focusReference: string
  /** The modernized reflection text actually shipped. */
  adapted: string
  llm: DevotionalLlm
  /** Cancellation from the workflow step. Without it a cancelled run keeps
   *  paying for critics nobody will read. */
  abortSignal?: AbortSignal
}

export async function critiqueReflectionFidelity(
  input: CritiqueReflectionFidelityInput,
): Promise<ReflectionFidelityCritique> {
  const user = [
    `PASSAGE: ${input.focusReference}`,
    "",
    `ORIGINAL EXCERPT:\n${input.sourceExcerpt}`,
    "",
    `MODERNIZED ADAPTATION:\n${input.adapted}`,
  ].join("\n")
  const attempt = () =>
    input.llm.complete({
      abortSignal: input.abortSignal,
      system: SYSTEM_PROMPT,
      user,
      jsonSchema: JSON_SCHEMA,
      schema: Schema,
      temperature: 0.2,
      // Real excerpts run 400-700+ words and can surface several issues, each
      // with a problem + suggestion string. 1200 and even 2000 truncated valid
      // JSON mid-response in testing when the critic found many issues
      // (surfaced as a spurious "validation" skip) — give real headroom.
      maxTokens: 3000,
    })

  // Degraded result shared by both give-up paths, so a non-retryable failure and
  // a failed retry cannot drift into different shapes.
  /**
   * The degraded result.
   *
   * Advisory step: never block a render on a checker failure — but mark it
   * `skipped`, so this is never confused with a genuine `faithful: true`
   * verdict. The check did not run; it did not pass.
   */
  const skipped = (cause: DevotionalLlmError) => ({
    faithful: true,
    issues: [],
    summary: `fidelity critique skipped: ${cause.code}${cause.status ? ` (${cause.status})` : ""}`,
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

export const _internal = { JSON_SCHEMA }
