import { createTool } from "@mastra/core/tools"
import { z } from "zod"

/**
 * Stub `retrieve-answer` tool for the seeker agent (feat-170, U3).
 *
 * Follows the same-app `firecrawl.ts` shape (pure `execute` fn + `createTool`
 * wrapper, `.strict()` zod schemas). It exists so the seeker agent can
 * VISIBLY fire a tool in Studio — it performs NO real retrieval.
 *
 * PROVISIONAL PLACEHOLDER I/O — NOT A FINALIZED RAG CONTRACT. Real retrieval
 * will likely return passage-shaped `sources` (e.g. `{ text, ref, score? }`)
 * and a grounded `answer`; the deferred RAG work is free to change this shape.
 * Do not build consumers against it as if it were stable.
 *
 * The hard-coded `answer` stays inside the seeker safety posture: it is an
 * obvious stub marker and contains NO invented scripture, citations, or
 * doctrinal claims. `retrieve-answer.test.ts`'s safety regression guard asserts
 * the `STUB_MARKER` substring so the text cannot later be edited into
 * scripture-/doctrine-looking content without a test failing.
 */

const STUB_MARKER = "[stub]"

export const STUB_ANSWER = `${STUB_MARKER} retrieve-answer is a non-production placeholder and returns no real retrieval result yet.`

export const retrieveAnswerInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe("The seeker's factual question to ground an answer for."),
    locale: z
      .string()
      .optional()
      .describe("Optional BCP-47 locale hint for the eventual retrieval."),
  })
  .strict()

// `sources` is intentionally an always-empty array in the stub. Typed as a
// generic record array so the eventual passage shape can land without a
// breaking schema swap. PROVISIONAL — see file header.
export const retrieveAnswerOutputSchema = z
  .object({
    answer: z.string(),
    sources: z.array(z.record(z.string(), z.unknown())),
  })
  .strict()

export type RetrieveAnswerInput = z.input<typeof retrieveAnswerInputSchema>
export type RetrieveAnswerOutput = z.output<typeof retrieveAnswerOutputSchema>

/**
 * Pure, deterministic stub executor. Returns the fixed safe placeholder with
 * empty `sources`, ignoring the input value.
 *
 * The `.parse()` is a deliberate input guard, NOT a discarded copy of the
 * template's `const parsed = ...` line: this function is exported and called
 * directly by unit tests (and could be by future callers) OUTSIDE `createTool`,
 * which only validates `inputSchema` on the agent dispatch path. The guard
 * keeps the exported contract safe regardless of caller; its throw path is
 * covered in `retrieve-answer.test.ts`. The stub ignores the value, so there is
 * nothing to bind — unlike `firecrawl.ts`, which uses its parsed result.
 */
export function executeRetrieveAnswer(
  input: RetrieveAnswerInput,
): RetrieveAnswerOutput {
  retrieveAnswerInputSchema.parse(input)
  return {
    answer: STUB_ANSWER,
    sources: [],
  }
}

export const retrieveAnswerTool = createTool({
  id: "retrieveAnswer",
  description:
    "Retrieve a grounded answer for a seeker's factual question. STUB: returns a fixed placeholder with no sources; real retrieval is deferred.",
  inputSchema: retrieveAnswerInputSchema,
  outputSchema: retrieveAnswerOutputSchema,
  execute: async (inputData) => executeRetrieveAnswer(inputData),
})
