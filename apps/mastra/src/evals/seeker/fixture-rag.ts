/**
 * Seeker eval — the frozen world: a question-keyed search function for the
 * real agent's tool loop (decision doc §2, Approach 2).
 *
 * `buildSeekerAgent({ ragSearch })` threads this through
 * `buildRetrieveAnswerTool({ search })`, so the REAL tool code runs — input
 * parse, query clamp, status mapping — with only the outermost HTTP client
 * replaced by the committed fixture.
 *
 * Fixtures are keyed on the QUESTION, not the model's search query: the
 * prototype observed every model rewriting the query (~15 tool calls, zero
 * verbatim pass-throughs), so query-keyed fixtures would never match. The
 * model's actual query is recorded verbatim as an observable instead, with a
 * QUERY-DRIFT flag when it shares almost no vocabulary with the question —
 * the one blind spot of the frozen-fixture seam (a prompt change that
 * degrades search queries shows up only here, never as a failed lookup).
 */
import type { JesusfilmRagPassage } from "../../services/jesusfilm-rag-client"
import type { RetrieveAnswerSearch } from "../../mastra/tools/retrieve-answer"

import type { RagFixture, RetrieveAnswerResult } from "./rag"

/** One recorded tool-loop call — the transcript's raw material. */
export type FixtureSearchCall = {
  name: "retrieveAnswer"
  /** JSON of the arguments the tool executor passed — the MODEL's query. */
  arguments: string
  /**
   * "fixture" when the model's query matched the captured query verbatim
   * (it never does, per the prototype); "fixture-fallback" when the
   * question's fixture was served for a reformulated query.
   */
  servedFrom: "fixture" | "fixture-fallback"
  /** Near-zero vocabulary overlap between the model's query and the question. */
  queryDrift: boolean
}

/** Words that carry no retrieval signal; excluded from overlap. */
const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "what",
  "when",
  "where",
  "does",
  "did",
  "how",
  "why",
  "who",
  "are",
  "was",
  "were",
  "have",
  "has",
  "can",
  "not",
  "you",
  "your",
  "about",
  "would",
  "should",
  "could",
])

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word)),
  )
}

/**
 * True when the model's query shares almost no significant vocabulary with
 * the question. Reformulation is NORMAL (synonyms, expansion) — drift means
 * the query is about something else entirely, in which case serving the
 * question's fixture is an optimistic measurement the report must flag.
 */
export function queryDrifted(questionText: string, query: string): boolean {
  const questionWords = significantWords(questionText)
  const queryWords = significantWords(query)
  if (queryWords.size === 0) return true
  let shared = 0
  for (const word of queryWords) {
    if (questionWords.has(word)) shared += 1
  }
  return shared <= 1 && queryWords.size >= 3
}

/**
 * Map a captured tool-output fixture back to the CLIENT result the injected
 * search function must return. The real tool then re-derives its
 * `{ status, sources, message? }` from this — so the eval exercises the
 * tool's own mapping instead of bypassing it.
 */
export function fixtureResultToClientResult(result: RetrieveAnswerResult): {
  ok: true
  results: JesusfilmRagPassage[]
} {
  if (result.status === "unavailable") {
    // A committed fixture must never encode an outage — capture-rag refuses
    // to write one. Refusing here keeps a hand-edited fixture from silently
    // measuring the unavailable path as if retrieval had run.
    throw new Error(
      "fixture encodes status 'unavailable' — re-capture it; the frozen world must serve real passages or a real empty result",
    )
  }
  return {
    ok: true,
    results: result.sources.map((source) => ({
      score: source.score,
      text: source.text,
      citation: {
        sourceName: source.sourceName,
        title: source.title,
        url: source.url,
      },
    })),
  }
}

/**
 * Build the frozen search function for ONE question's cell. Every call is
 * recorded through `onCall` (the transcript hook) with the model's verbatim
 * query; the question's fixture is always served, whatever the query.
 */
export function buildFixtureSearch(options: {
  fixture: RagFixture
  questionText: string
  onCall?: (call: FixtureSearchCall) => void
}): RetrieveAnswerSearch {
  const { fixture, questionText, onCall } = options
  return async ({ query }) => {
    onCall?.({
      name: "retrieveAnswer",
      arguments: JSON.stringify({ query }),
      servedFrom:
        query.trim() === fixture.query.trim() ? "fixture" : "fixture-fallback",
      queryDrift: queryDrifted(questionText, query),
    })
    return fixtureResultToClientResult(fixture.result)
  }
}
