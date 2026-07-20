import { z } from "zod"

import { getLangfuseConfig, type LangfuseConfig } from "../config/env"

export type { LangfuseConfig } from "../config/env"

/**
 * Typed, single-attempt HTTP client for Langfuse prompt retrieval
 * (2026-07-20 langfuse-prompt-helper plan, U2 — layer 1):
 * `GET {baseUrl}/api/public/v2/prompts/{name}`, HTTP Basic auth.
 *
 * LITERAL TEMPLATE: `jesusfilm-rag-client.ts` — the single-attempt result-union
 * convention client. `endpoint`, `safeReason`, `readJsonBodyCapped`,
 * `readUpstreamReason`, and `failureForStatus` are copied from it (provenance
 * comments at each site); no shared helpers module exists yet, per plan.
 *
 * BASIC AUTH (divergence from the Bearer siblings): Langfuse's documented
 * scheme is `authorization: Basic base64(publicKey:secretKey)` — a key PAIR,
 * not a single bearer token. Both halves are load-bearing secrets (Langfuse
 * keys carry full project access; no read-only prompt scope exists), so the
 * `config_missing` short-circuit is three-way: base URL, public key, and
 * secret key are each individually detectable before any fetch.
 *
 * CONTRACT PROVENANCE: the response shape is transcribed from Langfuse's
 * documented v2 Prompts API (langfuse.com API reference,
 * `GET /api/public/v2/prompts/{promptName}`, captured 2026-07-20). No Langfuse
 * SDK is used (plan KTD1): the SDK cannot carry the house invariants — host
 * allowlist on credentialed egress, byte-capped reads, `redirect: "error"`,
 * no-throw unions, leak control.
 *
 * ADDITIVE-TOLERANT PARSE: only the fields this client consumes (`prompt`,
 * `version`, `labels`, `type`) are validated as required; the object is parsed
 * with `.passthrough()` so a contract-legal additive field must NOT break the
 * parse. `parse_error` is reserved for genuinely malformed or
 * missing-required-field bodies — and (see below) for well-formed bodies that
 * are not usable text prompts.
 *
 * CONTENT VALIDATION (plan KTD6): only a `type: "text"` prompt with a
 * non-empty string body is ever returned `ok` — the fetched text ends up as
 * agent instructions, so an unusable body must degrade, never serve. A
 * chat-type prompt (`type: "chat"` / array body) fails with detail
 * `chat_type_unsupported`; a whitespace-only or empty string body fails with
 * detail `empty_prompt`. Text is returned verbatim — no `{{variable}}`
 * compilation in this unit.
 *
 * URL ENCODING: Langfuse prompt names may contain `/` (folder-scoped names),
 * so the name path segment is `encodeURIComponent`-ed — a raw `/` would change
 * the route, not the prompt.
 *
 * SINGLE ATTEMPT: one request per call, `AbortSignal.timeout`, no
 * retry/backoff. The cached helper layer (layer 2, `getManagedPrompt` — a
 * LATER unit that stacks above this function in this module) owns fetch
 * frequency via TTL + failure cooldown; retrying here would multiply its
 * refetch attempts. The `retryable` flag stays on the failure union for type
 * parity and logging even though no caller retries.
 *
 * NO-THROW LEAK CONTROL: nothing on the request path may throw an error whose
 * message embeds the prompt body, the key pair, or the raw response body — the
 * typed no-throw union is that control. `upstreamReason` carries
 * Langfuse-controlled ERROR-body text capped to a safe length; it lives on the
 * typed result for tests and is NEVER logged (it is untrusted text and a
 * log-injection vector — see the single-service client convention doc).
 * Success-shaped bodies (which contain the prompt text) never contribute to
 * any failure field.
 */

export type LangfusePromptFailureReason =
  | "config_missing"
  | "auth_failed"
  | "timeout"
  | "network_error"
  | "rate_limited"
  | "rejected"
  | "parse_error"

export type LangfusePromptFailureDetail =
  /** Only set for `config_missing`: which third of the config is absent. */
  | "base_url_missing"
  | "public_key_missing"
  | "secret_key_missing"
  /** Only set for `parse_error` on a 200: KTD6 content-validation outcomes. */
  | "chat_type_unsupported"
  | "empty_prompt"

export type LangfusePromptClientFailure = {
  ok: false
  reason: LangfusePromptFailureReason
  retryable: boolean
  status?: number
  upstreamReason?: string
  detail?: LangfusePromptFailureDetail
}

export type LangfusePromptClientResult =
  | { ok: true; text: string; version: number; labels: string[] }
  | LangfusePromptClientFailure

export type LangfusePromptFetchInput = {
  name: string
  /**
   * Passed through verbatim as the `label` query param when provided. Label
   * RESOLUTION (call param > env default > "production") is layer 2's job —
   * this function never defaults it, so an omitted label asks Langfuse for
   * its own default (the `production` label per the documented contract).
   */
  label?: string
  config?: LangfuseConfig
  fetchImpl?: typeof fetch
}

// Only the consumed fields are required; `.passthrough()` tolerates the
// contract's additive evolution (and ignores `id`/`tags`/`config`/
// `commitMessage`/timestamps, which this client never exposes).
const PromptResponseSchema = z
  .object({
    // `z.unknown()`, not `z.string()`: a chat-type prompt carries an ARRAY
    // here, and the client must distinguish "chat prompt" (detail
    // `chat_type_unsupported`) from "malformed body" — a string-typed field
    // would collapse both into one generic parse_error. The type-specific
    // shape is enforced in the content-validation step below.
    prompt: z.unknown(),
    // `.finite()` rejects a JSON-legal `1e999` (-> Infinity), which
    // `z.number()` would accept and then `JSON.stringify` would coerce to
    // `null` downstream.
    version: z.number().finite(),
    labels: z.array(z.string()),
    type: z.string(),
  })
  .passthrough()

// Copied from jesusfilm-rag-client.ts (the literal template; no shared
// helpers module exists yet, per plan). Joins relative to a normalized
// trailing-slash base so a path-prefixed base URL keeps its prefix.
function endpoint(baseUrl: string, path: string): URL {
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  return new URL(path, normalized)
}

// Copied from jesusfilm-rag-client.ts. Caps upstream-controlled text
// codepoint-safely so a huge error body cannot balloon the typed result.
function safeReason(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  const codepoints = Array.from(value)
  return codepoints.length <= 300
    ? value
    : `${codepoints.slice(0, 297).join("")}...`
}

/**
 * Copied from jesusfilm-rag-client.ts (feat-202 byte-cap OOM guard; no shared
 * helpers module exists yet, per plan).
 *
 * Read and JSON-parse a response body, bounded at `maxBytes`. Streams the body
 * with a running byte counter rather than trusting `Content-Length` (absent or
 * spoofable); the instant the counter exceeds `maxBytes` it cancels the reader
 * — aborting the underlying socket so a misbehaving upstream can't keep
 * filling the heap — and returns `undefined`. Both ingress reads in this file
 * go through here so neither can buffer a multi-GB body into the single Node
 * process that runs every Mastra agent and workflow.
 *
 * Returns `undefined` on EVERY failure mode (absent body, read error,
 * over-cap, decode error, JSON parse error), preserving no-throw behaviour: an
 * over-cap body rides the EXISTING graceful paths — `parse_error` at the
 * success site, "no reason"/status-classified at the error site. The catch
 * swallows silently and MUST NOT log the caught error: a `JSON.parse`
 * `SyntaxError` can embed raw body fragments (here: prompt text), and logging
 * it would breach the NO-THROW LEAK CONTROL invariant (prompt bodies, the key
 * pair, and raw bodies never reach a throw, a log, or the typed result).
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

// Copied from jesusfilm-rag-client.ts. Extracts a bounded reason from an
// ERROR-status body only (`error`/`message` string fields) — success-shaped
// bodies, which contain prompt text, never pass through here.
async function readUpstreamReason(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const body = await readJsonBodyCapped(response, maxBytes)
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined
  const record = body as { error?: unknown; message?: unknown }
  return safeReason(record.error) ?? safeReason(record.message)
}

// Copied from jesusfilm-rag-client.ts (modulo the failure type name):
// 401/403 -> auth_failed, 429 -> rate_limited, other 4xx -> rejected with the
// status carried (404 = prompt or label not found rides this branch), 5xx ->
// retryable network_error.
function failureForStatus(
  status: number,
  upstreamReason?: string,
): LangfusePromptClientFailure {
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

export async function fetchLangfusePrompt({
  name,
  label,
  config = getLangfuseConfig(),
  fetchImpl = fetch,
}: LangfusePromptFetchInput): Promise<LangfusePromptClientResult> {
  // Configured means the base URL AND both auth halves are present; degrade
  // (never boot-throw) on any third absent, distinguishing which for the
  // observable misconfiguration log layer 2 emits. Checked BEFORE any fetch.
  if (!config.baseUrl) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "base_url_missing",
    }
  }
  if (!config.publicKey) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "public_key_missing",
    }
  }
  if (!config.secretKey) {
    return {
      ok: false,
      reason: "config_missing",
      retryable: false,
      detail: "secret_key_missing",
    }
  }

  // encodeURIComponent: Langfuse prompt names may contain `/` (folder-scoped),
  // which must land in the path as `%2F`, not as a route separator.
  const url = endpoint(
    config.baseUrl,
    `api/public/v2/prompts/${encodeURIComponent(name)}`,
  )
  // Pass-through only: label resolution/defaulting is layer 2's job. Omitted
  // label means Langfuse applies its own documented default (`production`).
  if (label !== undefined) url.searchParams.set("label", label)

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        // Basic auth from the key PAIR — Langfuse's documented scheme; see the
        // header comment for the divergence from the Bearer siblings.
        authorization: `Basic ${Buffer.from(
          `${config.publicKey}:${config.secretKey}`,
        ).toString("base64")}`,
        "user-agent": config.userAgent,
      },
      // The prompts API has no legitimate redirect; following one would re-send
      // the Basic credentials (full-project-access keys) to an unvetted host,
      // defeating the boot-time allowlist beyond the first hop.
      redirect: "error",
      signal: AbortSignal.timeout(config.timeoutMs),
    })
  } catch (error) {
    // Classify on the typed surface, not the message. `AbortSignal.timeout`
    // rejects with a `TimeoutError`; a manual abort gives `AbortError`. Any
    // other throw (including a `redirect: "error"` rejection) is a network error.
    const errorName = (error as { name?: string } | null | undefined)?.name
    if (errorName === "TimeoutError" || errorName === "AbortError") {
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
  const parsed = PromptResponseSchema.safeParse(body)
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

  // Content validation (plan KTD6): the fetched text becomes agent
  // instructions verbatim, so anything that is not a usable text prompt is a
  // failure with a distinguishing detail — never ok. No body text is carried
  // into any of these failures.
  const { prompt, type } = parsed.data
  if (type === "chat" || Array.isArray(prompt)) {
    return {
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: response.status,
      detail: "chat_type_unsupported",
    }
  }
  if (type !== "text" || typeof prompt !== "string") {
    return {
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: response.status,
    }
  }
  if (prompt.trim().length === 0) {
    return {
      ok: false,
      reason: "parse_error",
      retryable: false,
      status: response.status,
      detail: "empty_prompt",
    }
  }

  return {
    ok: true,
    text: prompt,
    version: parsed.data.version,
    // Field projection (spread, not the parsed reference) mirrors the
    // template's discipline: nothing beyond the consumed shape escapes.
    labels: [...parsed.data.labels],
  }
}
