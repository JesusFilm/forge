import { z } from "zod"

import { getJesusfilmRagConfig, type JesusfilmRagConfig } from "../config/env"

export type { JesusfilmRagConfig } from "../config/env"

/**
 * Typed, single-attempt HTTP client for the JesusFilm RAG retrieval service
 * (feat-199): `POST {baseUrl}/v1/search`, bearer auth.
 *
 * CONTRACT PROVENANCE: shapes below are transcribed from
 * `github.com/JesusFilm/jesusfilm-rag` `contracts/openapi.v1.json` as captured
 * 2026-06-10. The integration surface is that published HTTP contract only — no
 * code is vendored from the RAG repo.
 *
 * ADDITIVE-TOLERANT PARSE: the contract is additive-only within v1 (a new
 * response field ships without a major bump), so the envelope, `RankedResult`,
 * and `Citation` are parsed with `.passthrough()` and ONLY the fields the tool
 * consumes are validated as required (`score`, `text`,
 * `citation.{sourceName, title (nullable), url}`). A contract-legal additive
 * field must NOT break the parse — a strict whole-envelope parse would turn
 * every legal additive change into a silent total outage. `parse_error` is
 * reserved for genuinely malformed or missing-required-field bodies.
 *
 * SINGLE ATTEMPT: one request per call, `AbortSignal.timeout`, no retry/backoff
 * (R8). The four admin ingest clients prove the single-attempt precedent; this
 * deliberately drops firecrawl-client's retry loop. The `retryable` flag stays
 * on the failure union for type parity and logging even though no caller retries.
 *
 * NO-THROW LEAK CONTROL: nothing on the request path may throw an error whose
 * message embeds the query, bearer, or raw body — the typed no-throw union is
 * that control (R5). `upstreamReason` carries RAG-controlled text capped to a
 * safe length; it lives on the typed result for tests and is NEVER logged.
 */

export type JesusfilmRagFailureReason =
  | "config_missing"
  | "auth_failed"
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "rejected"
  | "parse_error"

export type JesusfilmRagClientFailure = {
  ok: false
  reason: JesusfilmRagFailureReason
  retryable: boolean
  status?: number
  upstreamReason?: string
  /** Only set for `config_missing`: which half of the pair is absent. */
  detail?: "base_url_missing" | "api_key_missing"
}

export type JesusfilmRagPassage = {
  score: number
  text: string
  citation: {
    sourceName: string
    title: string | null
    url: string
  }
}

export type JesusfilmRagClientResult =
  | { ok: true; results: JesusfilmRagPassage[] }
  | JesusfilmRagClientFailure

export type JesusfilmRagSearchInput = {
  query: string
  config?: JesusfilmRagConfig
  fetchImpl?: typeof fetch
}

/** Mirrors the RAG's reference client; bounds passage volume entering context. */
const RAG_TOP_K = 5

// Only the consumed fields are required; `.passthrough()` tolerates the
// contract's additive evolution (and ignores `chunkId`/`ord`/`tags`/`sourceKey`,
// which the tool never exposes).
const CitationSchema = z
  .object({
    sourceName: z.string(),
    title: z.string().nullable(),
    // `.url()`: the agent cites this verbatim, so a malformed URL is rejected as
    // a parse_error (-> `unavailable`) rather than cited as a broken source.
    url: z.url(),
  })
  .passthrough()

const RankedResultSchema = z
  .object({
    // `.finite()` rejects a JSON-legal `1e999` (-> Infinity), which `z.number()`
    // would accept and then `JSON.stringify` would coerce to `null` downstream.
    score: z.number().finite(),
    text: z.string(),
    citation: CitationSchema,
  })
  .passthrough()

const SearchResponseSchema = z
  .object({
    results: z.array(RankedResultSchema),
  })
  .passthrough()

function endpoint(baseUrl: string, path: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  return new URL(path, normalized)
}

function safeReason(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  const codepoints = Array.from(value)
  return codepoints.length <= 300
    ? value
    : `${codepoints.slice(0, 297).join("")}...`
}

/**
 * Read and JSON-parse a response body, bounded at `maxBytes` (feat-202). Streams
 * the body with a running byte counter rather than trusting `Content-Length`
 * (absent or spoofable); the instant the counter exceeds `maxBytes` it cancels
 * the reader — aborting the underlying socket so a misbehaving upstream can't
 * keep filling the heap — and returns `undefined`. Both ingress reads in this
 * file go through here so neither can buffer a multi-GB body into the single
 * Node process that runs every Mastra agent and workflow.
 *
 * Returns `undefined` on EVERY failure mode (absent body, read error, over-cap,
 * decode error, JSON parse error), which preserves this file's prior
 * `.catch(() => undefined)` no-throw behaviour: an over-cap body rides the
 * EXISTING graceful paths — `parse_error` at the success site,
 * "no reason"/status-classified at the error site — through to the agent's
 * `unavailable` status, never a throw. The catch swallows silently and MUST NOT
 * log the caught error: a `JSON.parse` `SyntaxError` can embed raw body
 * fragments, and logging it would breach the NO-THROW LEAK CONTROL invariant
 * (query, bearer, and raw body never reach a throw, a log, or the typed result).
 */
async function readJsonBodyCapped(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const stream = response.body
  if (!stream) return undefined
  // `reader` is acquired INSIDE the try and released in a guarded `finally` so
  // BOTH ends of the no-throw boundary are structural, not dependent on timing:
  // a `getReader()` throw (e.g. a double-locked body) is swallowed to undefined,
  // and `releaseLock()` (which throws if a read is still pending) can never
  // escape and mask the graceful return. Keeps NO-THROW LEAK CONTROL intact even
  // under a future edit that disturbs the current no-pending-read invariant.
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        // Abort the underlying stream (not merely stop reading) so the socket
        // stops filling the heap. The over-cap body then degrades gracefully.
        await reader.cancel()
        return undefined
      }
      chunks.push(value)
    }
    const merged = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(merged))
  } catch {
    return undefined
  } finally {
    try {
      reader?.releaseLock()
    } catch {
      // Cleanup must never escape — see the no-throw boundary note above.
    }
  }
}

async function readUpstreamReason(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const body = await readJsonBodyCapped(response, maxBytes)
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
  const record = body as { error?: unknown; message?: unknown }
  return safeReason(record.error) ?? safeReason(record.message)
}

function failureForStatus(
  status: number,
  upstreamReason?: string,
): JesusfilmRagClientFailure {
  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: "auth_failed",
      retryable: false,
      status,
      upstreamReason,
    }
  }
  if (status === 429) {
    return {
      ok: false,
      reason: "rate_limited",
      retryable: true,
      status,
      upstreamReason,
    }
  }
  return {
    ok: false,
    reason: status >= 400 && status < 500 ? "rejected" : "network_error",
    retryable: status >= 500,
    status,
    upstreamReason,
  }
}

export async function searchJesusfilmRag({
  query,
  config = getJesusfilmRagConfig(),
  fetchImpl = fetch,
}: JesusfilmRagSearchInput): Promise<JesusfilmRagClientResult> {
  // Configured means the pair is present; degrade (never boot-throw) on either
  // half absent, distinguishing which for the observable misconfiguration log.
  if (!config.baseUrl) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "base_url_missing",
    }
  }
  if (!config.apiKey) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "api_key_missing",
    }
  }

  let response: Response
  try {
    response = await fetchImpl(endpoint(config.baseUrl, "v1/search"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
        "user-agent": config.userAgent,
      },
      // The contract rejects unknown body fields (`additionalProperties: false`),
      // so nothing beyond `query` and `policy.topK` goes in.
      body: JSON.stringify({ query, policy: { topK: RAG_TOP_K } }),
      // The RAG API has no legitimate redirect; following one would re-send the
      // query (and same-origin, the bearer) to an unvetted host, defeating the
      // boot-time allowlist beyond the first hop.
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    // Classify on the typed surface, not the message. `AbortSignal.timeout`
    // rejects with a `TimeoutError`; a manual abort gives `AbortError`. Any
    // other throw (including a `redirect: "error"` rejection) is a network error.
    const name = (error as { name?: string } | null | undefined)?.name
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, reason: "timeout", retryable: true }
    }
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (!response.ok) {
    return failureForStatus(
      response.status,
      await readUpstreamReason(response, config.maxResponseBytes),
    )
  }

  const body = await readJsonBodyCapped(response, config.maxResponseBytes)
  const parsed = SearchResponseSchema.safeParse(body)
  if (!parsed.success) {
    // Genuinely malformed or missing a required consumed field. The raw Zod
    // message / body content is never echoed into the failure.
    return {
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: response.status,
    }
  }

  return {
    ok: true,
    // Defensive cap: we request `topK`, but the SERVER controls the response
    // count. Bound it client-side (mirrors firecrawl-client's `.slice`) so a
    // misbehaving RAG can't flood the agent context / in-memory Memory.
    results: parsed.data.results.slice(0, RAG_TOP_K).map((result) => ({
      score: result.score,
      text: result.text,
      citation: {
        sourceName: result.citation.sourceName,
        title: result.citation.title,
        url: result.citation.url,
      },
    })),
  }
}
