import { createTool } from "@mastra/core/tools"
import { z } from "zod"

import {
  searchJesusfilmRag,
  type JesusfilmRagClientFailure,
  type JesusfilmRagSearchInput,
} from "../../services/jesusfilm-rag-client"

/**
 * `retrieveAnswer` tool for the seeker agent (feat-199).
 *
 * Calls the JesusFilm RAG retrieval service through `jesusfilm-rag-client` and
 * returns ranked, cited PASSAGES — it performs NO answer generation. The agent's
 * own LLM synthesizes a source-attributed answer from these passages (R2/R3).
 *
 * Output is `{ status, sources, message? }`:
 * - `status: "ok"`   — ≥1 passage returned; `sources` carries them, no message.
 * - `status: "empty"` — retrieval succeeded with zero passages; `sources` is
 *   `[]` and `message` tells the agent to say it has no grounded answer (R4).
 * - `status: "unavailable"` — every client failure (unconfigured, auth, timeout,
 *   service error, parse) collapses here; `sources` is `[]` and `message` tells
 *   the agent retrieval is unavailable and to continue (R5). The full failure
 *   reason goes to logs only — never to the LLM-visible output.
 *
 * This deliberately diverges from the firecrawl tools' `discriminatedUnion("ok",
 * …)` shape with an exposed `reason`/`retryable`: that surface is load-bearing
 * only because `webResearchAgent` is instructed to branch on it, and the
 * seeker's single-attempt posture removes that consumer. Do not "harmonize" it.
 *
 * The `empty`/`unavailable` message strings are EXPORTED constants — the shared
 * truth that `seeker-agent.ts`'s instruction lines cross-reference, so in-band
 * guidance and instructions cannot drift apart.
 *
 * LANGFUSE COUPLING (feat-272): the seeker's live system prompt is the
 * Langfuse-managed `seeker-system` prompt (whole prompt, no composition
 * split), and it quotes the `status` literals `'empty'` / `'unavailable'`
 * and mirrors the two message constants below. CI cannot see Langfuse, so a
 * rename or rewording here can silently desync from the live prompt. The
 * pinning test in `../agents/seeker-agent.test.ts` makes such a change loud;
 * when it fires, update the `seeker-system` prompt in the Langfuse UI (every
 * label) in the same change — expand-then-contract, since the UI edit and
 * the deploy cannot land atomically: publish a version covering BOTH
 * literals and move the labels onto it, deploy the code change, then publish
 * the contracted version (feat-272 item 2 has the full ordering rule).
 */

/** Contract bounds query at 2000 code points (JSON Schema counts code points). */
const MAX_QUERY_CODEPOINTS = 2000

/**
 * Defensive per-passage cap. `RankedResult.text` carries no `maxLength` in the
 * contract, so this bounds passage size entering the agent context, mirroring
 * the firecrawl path's `FIRECRAWL_MAX_MARKDOWN_CHARS` posture.
 */
const MAX_PASSAGE_CODEPOINTS = 4000

/**
 * In-band guidance for the agent when retrieval returns zero passages (R4).
 * Cross-referenced by `seeker-agent.ts`'s no-grounded-answer instruction line
 * AND mirrored by the Langfuse-managed `seeker-system` prompt (feat-272) —
 * update that prompt in the Langfuse UI when changing this wording.
 */
export const RETRIEVE_ANSWER_EMPTY_MESSAGE =
  "No passages were found for this question. Tell the seeker you do not have a grounded answer, and do not invent sources."

/**
 * In-band guidance when retrieval cannot run (R5). One NEUTRAL wording — it must
 * not claim the outage is temporary (`config_missing` is permanent for the
 * session; `timeout` is not). Cross-referenced by `seeker-agent.ts`'s
 * retrieval-unavailable instruction line AND mirrored by the Langfuse-managed
 * `seeker-system` prompt (feat-272) — update that prompt in the Langfuse UI
 * when changing this wording.
 */
export const RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE =
  "Retrieval is unavailable. Tell the seeker you cannot provide a grounded answer, and continue the conversation."

export const retrieveAnswerInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .describe("The seeker's factual question to ground an answer for."),
  })
  .strict()

// Uniform `.strict()` output shape (distinct from the passthrough parse of the
// RAG's wire response in the client). `title` is nullable per the contract's
// `Citation.title`. `chunkId`/`tags`/`sourceKey`/`ord` are intentionally NOT
// exposed.
export const retrieveAnswerOutputSchema = z
  .object({
    // The `empty`/`unavailable` literals are quoted verbatim by the seeker's
    // system prompt — including its live Langfuse-managed copy (feat-272).
    // Renaming one is a prompt change, not just a schema change: update the
    // `seeker-system` prompt in Langfuse too (the seeker-agent.test.ts pin
    // fails to force that).
    status: z.enum(["ok", "empty", "unavailable"]),
    sources: z.array(
      z
        .object({
          text: z.string(),
          sourceName: z.string(),
          title: z.string().nullable(),
          url: z.url(),
          score: z.number(),
        })
        .strict(),
    ),
    message: z.string().optional(),
  })
  .strict()

export type RetrieveAnswerInput = z.input<typeof retrieveAnswerInputSchema>
export type RetrieveAnswerOutput = z.output<typeof retrieveAnswerOutputSchema>

/**
 * Injectable search dependency shared by `executeRetrieveAnswer` and
 * `buildRetrieveAnswerTool` — the exact call shape of the real RAG client.
 * Production binds `searchJesusfilmRag`; the seeker eval binds a
 * fixture-backed function serving committed passages.
 */
export type RetrieveAnswerSearch = (
  input: JesusfilmRagSearchInput,
) => ReturnType<typeof searchJesusfilmRag>

/** Codepoint-safe slice — a UTF-16 `.slice` can split a surrogate pair. */
function truncateCodepoints(value: string, maxCodepoints: number): string {
  const codepoints = Array.from(value)
  if (codepoints.length <= maxCodepoints) return value
  return codepoints.slice(0, maxCodepoints).join("")
}

/**
 * Plain-string `event=` log on the failure path (admin's convention; first use
 * in apps/mastra). It also dodges Railway logsV2's JSON-stringify silencing.
 * Carries ENUM values only — never the query, the key, the raw body, or
 * `upstreamReason` (RAG-controlled text and a log-injection vector into the
 * space-delimited `key=value` format).
 */
function logRetrievalUnavailable(failure: JesusfilmRagClientFailure): void {
  const detail = failure.detail ? ` detail=${failure.detail}` : ""
  console.error(
    `[seeker] event=rag_retrieval_unavailable reason=${failure.reason}${detail}`,
  )
}

/**
 * Pure executor. Parses input, clamps the trimmed query to the contract's code
 * point bound, calls the RAG client through an injectable dependency, and maps
 * the typed client union to the tool's `{ status, sources, message? }` contract.
 *
 * The `.parse()` is a deliberate input guard, NOT a discarded line: this
 * function is exported and called directly by unit tests (and could be by future
 * callers) OUTSIDE `createTool`, which only validates `inputSchema` on the agent
 * dispatch path. `options.search` is the firecrawl-style injectable client dep,
 * defaulted to `{}` so production binds the real client.
 */
export async function executeRetrieveAnswer(
  input: RetrieveAnswerInput,
  options: {
    search?: RetrieveAnswerSearch
  } = {},
): Promise<RetrieveAnswerOutput> {
  const parsed = retrieveAnswerInputSchema.parse(input)
  const query = truncateCodepoints(parsed.query, MAX_QUERY_CODEPOINTS)

  const response = await (options.search ?? searchJesusfilmRag)({ query })

  if (!response.ok) {
    logRetrievalUnavailable(response)
    return {
      status: "unavailable",
      sources: [],
      message: RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE,
    }
  }

  if (response.results.length === 0) {
    return {
      status: "empty",
      sources: [],
      message: RETRIEVE_ANSWER_EMPTY_MESSAGE,
    }
  }

  // Sources map ONLY from what the client returned (R9 tool half).
  return {
    status: "ok",
    sources: response.results.map((passage) => ({
      text: truncateCodepoints(passage.text, MAX_PASSAGE_CODEPOINTS),
      sourceName: passage.citation.sourceName,
      title: passage.citation.title,
      url: passage.citation.url,
      score: passage.score,
    })),
  }
}

/**
 * Factory for the `retrieveAnswer` tool (chat-eval agent-factory seam, PR B).
 *
 * `executeRetrieveAnswer` has always taken an injectable `search`, but the
 * module-level `createTool` closure bound the default client and accepted no
 * injection — so the seam was unreachable from the agent's tool-calling loop.
 * This factory closes that gap: the seeker eval builds the REAL tool over a
 * frozen fixture-backed search function (`buildSeekerAgent({ ragSearch })`
 * threads through here), while production stays on the zero-option singleton
 * below. When `search` is omitted, `executeRetrieveAnswer`'s own default
 * binding (the real RAG client) applies — this factory adds no second
 * default.
 */
export function buildRetrieveAnswerTool(
  options: { search?: RetrieveAnswerSearch } = {},
) {
  const { search } = options
  return createTool({
    id: "retrieveAnswer",
    description:
      "Retrieve ranked, cited passages from the Jesus Film retrieval corpus for a seeker's factual question. Returns passages (text, source name, title, URL, relevance score) for you to synthesize a source-attributed answer — it does NOT generate the answer itself. A status of 'empty' means no passages were found; 'unavailable' means retrieval could not run.",
    inputSchema: retrieveAnswerInputSchema,
    outputSchema: retrieveAnswerOutputSchema,
    execute: async (inputData) =>
      executeRetrieveAnswer(inputData, search === undefined ? {} : { search }),
  })
}

/**
 * Production singleton — built with NO options so the real RAG client stays
 * the search binding. The no-override call is pinned by the call-site
 * source-pin test in retrieve-answer.test.ts (feat-283 discipline): passing
 * any option here is a one-line revert surface that would silently swap the
 * production tool's data source.
 */
export const retrieveAnswerTool = buildRetrieveAnswerTool()
