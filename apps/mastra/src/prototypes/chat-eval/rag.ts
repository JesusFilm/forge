/**
 * PROTOTYPE — RAG capture, and the `retrieveAnswer` tool contract.
 *
 * Two jobs:
 *   1. Call a running JesusFilm RAG and record what it returns (capture time).
 *   2. Replay that recording to a model in the EXACT shape the real tool
 *      produces (run time).
 *
 * Everything here mirrors, and must stay in step with, two real files:
 *   - apps/mastra/src/services/jesusfilm-rag-client.ts  (the wire call)
 *   - apps/mastra/src/mastra/tools/retrieve-answer.ts   (the tool output)
 *
 * Copied rather than imported, per the repo's copy-not-import convention:
 * importing the tool would drag in `@mastra/core/tools`, the RAG config module,
 * and the env schema, none of which a CLI needs. The values below are pinned
 * copies — the tool description and the two message constants are byte-for-byte
 * from the tool, because a paraphrase would change what the model sees and
 * quietly stop measuring production behaviour.
 */
import { z } from "zod"

/** `RAG_TOP_K` in jesusfilm-rag-client.ts. */
export const RAG_TOP_K = 5
/** `MAX_PASSAGE_CODEPOINTS` in retrieve-answer.ts. */
const MAX_PASSAGE_CODEPOINTS = 4000
/** `MAX_QUERY_CODEPOINTS` in retrieve-answer.ts. */
const MAX_QUERY_CODEPOINTS = 2000

/** Byte-for-byte from retrieve-answer.ts. */
export const RETRIEVE_ANSWER_EMPTY_MESSAGE =
  "No passages were found for this question. Tell the seeker you do not have a grounded answer, and do not invent sources."

/** Byte-for-byte from retrieve-answer.ts. */
export const RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE =
  "Retrieval is unavailable. Tell the seeker you cannot provide a grounded answer, and continue the conversation."

/** Byte-for-byte from `retrieveAnswerTool.description`. */
export const RETRIEVE_ANSWER_DESCRIPTION =
  "Retrieve ranked, cited passages from the Jesus Film retrieval corpus for a seeker's factual question. Returns passages (text, source name, title, URL, relevance score) for you to synthesize a source-attributed answer — it does NOT generate the answer itself. A status of 'empty' means no passages were found; 'unavailable' means retrieval could not run."

/** OpenAI-format tool definition equivalent to `retrieveAnswerInputSchema`. */
export const RETRIEVE_ANSWER_TOOL_SPEC = {
  type: "function" as const,
  function: {
    name: "retrieveAnswer",
    description: RETRIEVE_ANSWER_DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "The seeker's factual question to ground an answer for.",
        },
      },
      required: ["query"],
    },
  },
}

/** The tool's `{ status, sources, message? }` output — what the model sees. */
export type RetrieveAnswerResult = {
  status: "ok" | "empty" | "unavailable"
  sources: Array<{
    text: string
    sourceName: string
    title: string | null
    url: string
    score: number
  }>
  message?: string
}

const RagResponseSchema = z.object({
  results: z.array(
    z.object({
      score: z.number(),
      text: z.string(),
      citation: z.object({
        sourceName: z.string(),
        title: z.string().nullable(),
        url: z.string(),
      }),
    }),
  ),
})

function truncateCodepoints(value: string, max: number): string {
  const codepoints = Array.from(value)
  return codepoints.length <= max ? value : codepoints.slice(0, max).join("")
}

export type RagFixture = {
  questionId: string
  /** The query sent to the RAG — the question text verbatim. */
  query: string
  capturedAt: string
  /** Exactly what `retrieveAnswer` would hand the model. */
  result: RetrieveAnswerResult
}

export type RagFixtureFile = {
  kind: "chat-eval-rag-fixtures"
  capturedAt: string
  baseUrl: string
  topK: number
  /** Fingerprint of every passage returned, so a corpus change is detectable. */
  corpusSha256: string
  fixtures: RagFixture[]
}

/**
 * Live call against a running RAG. Mirrors `searchJesusfilmRag`: same endpoint,
 * same body (the contract rejects unknown fields), same bearer header, and
 * `redirect: "error"` for the same reason — a redirect would re-send the query
 * and the bearer to an unvetted host.
 */
export async function searchRag(options: {
  query: string
  baseUrl: string
  apiKey: string
  topK?: number
  timeoutMs?: number
}): Promise<RetrieveAnswerResult> {
  const query = truncateCodepoints(options.query, MAX_QUERY_CODEPOINTS)
  const url = new URL(
    "v1/search",
    options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`,
  )

  let response: Response
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
        "user-agent": "forge-chat-eval-prototype/1.0",
      },
      body: JSON.stringify({
        query,
        policy: { topK: options.topK ?? RAG_TOP_K },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
    })
  } catch {
    // Same collapse the tool performs: every client failure becomes
    // `unavailable`, and the reason never reaches the model.
    return {
      status: "unavailable",
      sources: [],
      message: RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE,
    }
  }

  if (!response.ok) {
    return {
      status: "unavailable",
      sources: [],
      message: RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE,
    }
  }

  const parsed = RagResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    return {
      status: "unavailable",
      sources: [],
      message: RETRIEVE_ANSWER_UNAVAILABLE_MESSAGE,
    }
  }

  if (parsed.data.results.length === 0) {
    return {
      status: "empty",
      sources: [],
      message: RETRIEVE_ANSWER_EMPTY_MESSAGE,
    }
  }

  return {
    status: "ok",
    sources: parsed.data.results.map((passage) => ({
      text: truncateCodepoints(passage.text, MAX_PASSAGE_CODEPOINTS),
      sourceName: passage.citation.sourceName,
      title: passage.citation.title,
      url: passage.citation.url,
      score: passage.score,
    })),
  }
}

/**
 * Every source name + URL the fixtures make available, for grounding checks.
 * A citation outside this set was not retrievable and is therefore invented.
 */
export function citableSources(file: RagFixtureFile): {
  names: Set<string>
  urls: Set<string>
} {
  const names = new Set<string>()
  const urls = new Set<string>()
  for (const fixture of file.fixtures) {
    for (const source of fixture.result.sources) {
      names.add(source.sourceName)
      urls.add(source.url)
    }
  }
  return { names, urls }
}
