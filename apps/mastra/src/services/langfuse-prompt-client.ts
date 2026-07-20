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
 * retry/backoff. The cached helper layer (layer 2, `getManagedPrompt`, below
 * in this module) owns fetch frequency via TTL + failure cooldown; retrying
 * here would multiply its refetch attempts. The `retryable` flag stays on the
 * failure union for type parity and logging even though no caller retries.
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
  // which must land in the path as `%2F`, not as a route separator. It THROWS
  // URIError on malformed UTF-16 (a lone surrogate in the name), so the whole
  // URL build sits in its own try to keep the never-throws contract: an
  // unencodable name is a permanent CALLER error, returned as non-retryable
  // `rejected` — it must not ride the timeout/network classification, and
  // neither the name nor the error is echoed into the result (leak control).
  let url: URL
  try {
    url = endpoint(
      config.baseUrl,
      `api/public/v2/prompts/${encodeURIComponent(name)}`,
    )
    // Pass-through only: label resolution/defaulting is layer 2's job. Omitted
    // label means Langfuse applies its own documented default (`production`).
    if (label !== undefined) url.searchParams.set("label", label)
  } catch {
    return { ok: false, reason: "rejected", retryable: false }
  }

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

/**
 * ── Layer 2 (U3): cached managed-prompt helper ──────────────────────────────
 *
 * `getManagedPrompt` stacks a TTL cache + failure cooldown + serve-stale +
 * single-flight + fallback provenance above `fetchLangfusePrompt` (layer 1,
 * above). Async-only, never throws, never rejects: every outcome is a
 * `ManagedPromptResult` whose provenance fields say where the text came from.
 *
 * BEHAVIORAL CONTRACT (plan KTD4) — the per-entry cache state machine. Every
 * arrow is one test in langfuse-prompt-client.test.ts:
 *
 *   [*] -> Empty
 *   Empty -> Fresh: fetch ok
 *   Empty -> NegativeCached: fetch fails (serve fallback)
 *   Fresh -> Expired: TTL elapses
 *   Expired -> Fresh: refetch ok
 *   Expired -> StaleServing: refetch fails (serve stale, start cooldown)
 *   StaleServing -> StaleServing: within cooldown (serve stale, no fetch)
 *   StaleServing -> Fresh: cooldown over, refetch ok
 *   StaleServing -> StaleServing: cooldown over, refetch fails (restart cooldown)
 *   NegativeCached -> NegativeCached: within cooldown (serve fallback, no fetch)
 *   NegativeCached -> Fresh: cooldown over, refetch ok
 *   NegativeCached -> NegativeCached: cooldown over, refetch fails
 *
 * LABEL RESOLUTION (KTD3, R2 "no implicit latest"): call param >
 * `config.promptDefaultLabel` > "production", resolved BEFORE cache keying and
 * ALWAYS passed explicitly to layer 1 — an omitted label never reaches the
 * wire. Cache key = name + resolvedLabel, so an omitted label and an explicit
 * "production" share one entry while different labels stay independent.
 *
 * STALE IS MANAGED TEXT: serving an expired entry during a failure cooldown
 * is `source: "langfuse"` + `stale: true` — it IS managed text. Only the
 * fallback path carries the machine-readable layer-1 `reason`.
 *
 * NO BACKGROUND WORK: no setInterval / SWR-style refresh — a refetch happens
 * only inside a caller's own await, so nothing keeps the process (or the test
 * runner) alive.
 *
 * BOUNDED FAILURE LOGGING (R10): one plain-string
 * `[langfuse] event=prompt_fetch_failed ...` line per FAILED ATTEMPT (attempts
 * are bounded to one per cooldown window), never per fallback serve;
 * `config_missing` logs once per process. Lines carry name/label/reason/
 * status/detail only — never prompt bodies, fallback text, key material, or
 * `upstreamReason` (untrusted upstream text; leak/log-injection vector).
 *
 * INJECTION SEAMS (test isolation, ai-chat-retention.ts idiom): `now`,
 * `fetchImpl`, `config`, `cache`, and `logSink` are all injectable; the
 * default cache + the config_missing gate reset via
 * `resetManagedPromptStateForTests()`. No fake timers anywhere.
 */

export type ManagedPromptSource = "langfuse" | "fallback"

export type ManagedPromptResult = {
  text: string
  source: ManagedPromptSource
  /** Langfuse prompt version — present only on `source: "langfuse"` serves. */
  version?: number
  /** The label actually used (call param > config default > "production"). */
  resolvedLabel: string
  /** True when serving expired managed text during a failure cooldown. */
  stale?: boolean
  /** Layer-1 failure reason — present on failure-driven fallback serves. */
  reason?: LangfusePromptFailureReason
}

/**
 * Per-(name, resolvedLabel) cache state. `text`/`version`/`fetchedAt` hold the
 * last successful fetch (Fresh/Expired/StaleServing); `cooldownUntil` +
 * `lastFailureReason` are the failure state (StaleServing/NegativeCached);
 * `inFlight` is the single-flight slot shared by concurrent callers.
 */
type ManagedPromptCacheEntry = {
  text?: string
  version?: number
  fetchedAt?: number
  cooldownUntil?: number
  lastFailureReason?: LangfusePromptFailureReason
  inFlight?: Promise<void>
}

export type ManagedPromptCache = Map<string, ManagedPromptCacheEntry>

/** Fresh isolated cache instance — the injectable alternative to the reset hook. */
export function createManagedPromptCache(): ManagedPromptCache {
  return new Map()
}

export type ManagedPromptInput = {
  name: string
  label?: string
  /** Compiled-in text served (with `reason`) whenever no managed text exists. */
  fallback: string
  config?: LangfuseConfig
  fetchImpl?: typeof fetch
  /** Injected clock (ai-chat-retention idiom) — tests advance it, no fake timers. */
  now?: () => number
  cache?: ManagedPromptCache
  logSink?: (line: string) => void
}

const defaultManagedPromptCache: ManagedPromptCache = createManagedPromptCache()

/**
 * Once-per-process gate for `config_missing` (R10): missing config is
 * permanent for the process, so re-logging it on every cooldown lapse — for
 * every prompt entry — would be pure noise. Reset via the test hook below.
 */
let configMissingLogged = false

/**
 * Test-isolation hook: clears the module-level default cache AND re-arms the
 * once-per-process config_missing log gate. Call it in `beforeEach`.
 */
export function resetManagedPromptStateForTests(): void {
  defaultManagedPromptCache.clear()
  configMissingLogged = false
}

// console.error matches the repo's failure-path log convention (the `[seeker]
// event=` lines in retrieve-answer.ts) and dodges Railway logsV2's
// JSON-stringify silencing by staying plain-string.
const defaultManagedPromptLogSink: (line: string) => void = (line) => {
  console.error(line)
}

/**
 * Emit ONLY on fetch-failure transitions — one line per failed attempt, never
 * per fallback serve (the cooldown bounds attempts to one per window).
 * Carries name/label plus enum-shaped fields only; `upstreamReason` and every
 * body-derived string are excluded by construction (leak control).
 */
function logPromptFetchFailure(
  name: string,
  resolvedLabel: string,
  failure: LangfusePromptClientFailure,
  logSink: (line: string) => void,
): void {
  if (failure.reason === "config_missing") {
    if (configMissingLogged) return
    // Set BEFORE the sink call so a throwing sink cannot re-arm the gate.
    configMissingLogged = true
  }
  const status = failure.status !== undefined ? ` status=${failure.status}` : ""
  const detail = failure.detail ? ` detail=${failure.detail}` : ""
  logSink(
    `[langfuse] event=prompt_fetch_failed name=${name} label=${resolvedLabel} reason=${failure.reason}${status}${detail}`,
  )
}

function buildManagedResult(
  text: string,
  version: number | undefined,
  resolvedLabel: string,
  stale: boolean,
): ManagedPromptResult {
  const result: ManagedPromptResult = {
    text,
    source: "langfuse",
    resolvedLabel,
  }
  if (version !== undefined) result.version = version
  if (stale) result.stale = true
  return result
}

function buildFallbackResult(
  fallback: string,
  resolvedLabel: string,
  reason: LangfusePromptFailureReason | undefined,
): ManagedPromptResult {
  const result: ManagedPromptResult = {
    text: fallback,
    source: "fallback",
    resolvedLabel,
  }
  if (reason !== undefined) result.reason = reason
  return result
}

/**
 * Serve from entry state alone (no fetch): Fresh within TTL, or the two
 * cooldown branches — stale managed text wins over the fallback (it IS
 * managed text); a cold entry serves the fallback with the negative-cached
 * reason. Returns undefined for Empty / Expired / cooldown-lapsed, where the
 * caller must (re)fetch.
 */
function serveFromState(
  entry: ManagedPromptCacheEntry,
  nowMs: number,
  config: LangfuseConfig,
  resolvedLabel: string,
  fallback: string,
): ManagedPromptResult | undefined {
  if (
    entry.text !== undefined &&
    entry.fetchedAt !== undefined &&
    nowMs - entry.fetchedAt < config.promptCacheTtlMs
  ) {
    return buildManagedResult(entry.text, entry.version, resolvedLabel, false)
  }
  if (entry.cooldownUntil !== undefined && nowMs < entry.cooldownUntil) {
    if (entry.text !== undefined) {
      return buildManagedResult(entry.text, entry.version, resolvedLabel, true)
    }
    return buildFallbackResult(fallback, resolvedLabel, entry.lastFailureReason)
  }
  return undefined
}

type ManagedPromptRefetchArgs = {
  name: string
  resolvedLabel: string
  config: LangfuseConfig
  fetchImpl?: typeof fetch
  now: () => number
  logSink: (line: string) => void
}

/**
 * One blocking single-attempt refetch, mutating the entry to its next state.
 *
 * SLOT-LEAK GUARD (docs/solutions/best-practices/
 * in-memory-slot-reservation-fire-and-forget-20260506.md): the ENTIRE body
 * sits inside try/catch, so ANY unexpected synchronous throw — the injected
 * log sink is the realistic one — degrades to cooldown/fallback state instead
 * of rejecting the shared flight promise. The slot RELEASE deliberately does
 * not live here: it rides the flight promise in `getManagedPrompt` with an
 * identity check, so it can neither run before the reservation lands (a
 * sync-settling body would otherwise clear the slot first and then wedge the
 * entry on a settled promise) nor clear a newer flight.
 */
async function refetchManagedPrompt(
  entry: ManagedPromptCacheEntry,
  {
    name,
    resolvedLabel,
    config,
    fetchImpl,
    now,
    logSink,
  }: ManagedPromptRefetchArgs,
): Promise<void> {
  try {
    // Effective cooldown ≤ TTL: getLangfuseConfig() already clamps this, but a
    // hand-built injected config bypasses it — re-clamping here defends the
    // documented smaller-value-wins invariant (idempotent for env-derived
    // configs). Computed INSIDE the try: config is caller-supplied, so even a
    // throwing property getter must degrade to the catch below, not reject
    // the shared flight promise before the guard starts.
    const cooldownMs = Math.min(
      config.promptFailureCooldownMs,
      config.promptCacheTtlMs,
    )
    const result = await fetchLangfusePrompt({
      name,
      label: resolvedLabel,
      config,
      fetchImpl,
    })
    if (result.ok) {
      entry.text = result.text
      entry.version = result.version
      entry.fetchedAt = now()
      // Success clears failure state (StaleServing/NegativeCached -> Fresh).
      entry.cooldownUntil = undefined
      entry.lastFailureReason = undefined
      return
    }
    // Failure state FIRST, log SECOND: a throwing log sink must still leave a
    // coherent cooldown behind so subsequent calls serve from state.
    entry.cooldownUntil = now() + cooldownMs
    entry.lastFailureReason = result.reason
    logPromptFetchFailure(name, resolvedLabel, result, logSink)
  } catch {
    // Never log the thrown VALUE: it is arbitrary and could embed anything
    // (leak control). Defensive negative-cache: if the throw somehow predated
    // failure classification (layer 1 contractually never throws), still start
    // a cooldown so a persistently throwing wrapper cannot become a per-call
    // fetch storm. The bookkeeping below re-reads the caller-supplied `config`
    // and `now` — the plausible throw sources that landed us here — so it sits
    // in its OWN try: this catch must be total, because a rejecting flight
    // would wedge `entry.inFlight` and rethrow at every joiner's await.
    try {
      const cooldownMs = Math.min(
        config.promptFailureCooldownMs,
        config.promptCacheTtlMs,
      )
      if (entry.cooldownUntil === undefined || entry.cooldownUntil <= now()) {
        entry.cooldownUntil = now() + cooldownMs
        // Bounded breadcrumb — one enum-only line per NEW cooldown window, so
        // this defensive path is never fully silent. Carries name/label ONLY,
        // never the caught error or any of its text; own try/catch so a
        // throwing sink cannot escape the guard.
        try {
          logSink(
            `[langfuse] event=prompt_refetch_unexpected_error name=${name} label=${resolvedLabel}`,
          )
        } catch {
          // A throwing sink must not escape the defensive catch.
        }
      }
    } catch {
      // Even the defensive bookkeeping threw (hostile config getter or
      // throwing now()). Leave the entry untouched — the flight still settles
      // fulfilled and callers land on getManagedPrompt's terminal fallback.
    }
  }
}

function getOrCreateEntry(
  cache: ManagedPromptCache,
  key: string,
): ManagedPromptCacheEntry {
  const existing = cache.get(key)
  if (existing) return existing
  const created: ManagedPromptCacheEntry = {}
  cache.set(key, created)
  return created
}

/**
 * Resolve a managed prompt with fallback provenance. Never throws, never
 * rejects — see the layer-2 header comment for the full behavioral contract.
 */
export async function getManagedPrompt(
  input: ManagedPromptInput,
): Promise<ManagedPromptResult> {
  const {
    name,
    label,
    fallback,
    config = getLangfuseConfig(),
    fetchImpl,
    now = () => Date.now(),
    cache = defaultManagedPromptCache,
    logSink = defaultManagedPromptLogSink,
  } = input

  // KTD3/R2: resolve BEFORE cache keying; layer 1 always receives this label
  // explicitly — never an implicit/omitted "latest".
  const resolvedLabel = label ?? config.promptDefaultLabel ?? "production"
  // NUL separator: prompt names may contain any printable character (including
  // a would-be joiner), so a printable separator could alias two distinct
  // (name, label) pairs onto one key.
  const entry = getOrCreateEntry(cache, `${name}\u0000${resolvedLabel}`)

  // Fresh and in-cooldown states serve without any fetch.
  const served = serveFromState(entry, now(), config, resolvedLabel, fallback)
  if (served) return served

  // Empty, Expired, or cooldown just lapsed → one blocking refetch attempt.
  // Single-flight: concurrent callers racing this entry share ONE in-flight
  // promise; only the leader creates it. The release is identity-checked on
  // the flight promise itself (see refetchManagedPrompt's guard note).
  if (!entry.inFlight) {
    const flight = refetchManagedPrompt(entry, {
      name,
      resolvedLabel,
      config,
      fetchImpl,
      now,
      logSink,
    })
    entry.inFlight = flight
    // Release on BOTH settlement paths (identity-checked). The flight is
    // designed never to reject, but a fulfillment-only `.then` would turn any
    // slip into the worst outcome: the release never runs (entry wedged on a
    // settled-rejected promise until process restart) AND the derived promise
    // rejects unhandled. Registering the same release as the rejection
    // handler closes both.
    const release = () => {
      if (entry.inFlight === flight) entry.inFlight = undefined
    }
    void flight.then(release, release)
  }
  try {
    await entry.inFlight
  } catch {
    // Defensive floor for the never-rejects contract: a rejecting flight must
    // not rethrow into callers — fall through to serve from entry state or
    // the terminal fallback below.
  }

  // Post-refetch, leader and joiners alike re-derive from the settled entry
  // state with their OWN fallback — success lands on the fresh branch, failure
  // on a cooldown branch. The terminal fallback is the defensive floor for a
  // refetch body that threw before classifying its failure.
  return (
    serveFromState(entry, now(), config, resolvedLabel, fallback) ??
    buildFallbackResult(fallback, resolvedLabel, entry.lastFailureReason)
  )
}
