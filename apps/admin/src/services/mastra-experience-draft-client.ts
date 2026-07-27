/**
 * Leg-1 caller for the standalone one-shot draft route (consolidation U6).
 *
 * `config_missing` short-circuit when the caller vars are unset,
 * `POST /forge-experience-draft` with a `Bearer` (reusing MASTRA_BASE_URL +
 * MASTRA_SERVICE_API_KEY — the same service + receiver CSV the embedding
 * launches use), and a discriminated `{ ok } | { ok:false, reason, retryable }`
 * envelope.
 *
 * Transport is `node:http` by default (mirroring the variant/section clients,
 * PR #1339): Next.js patches the global `fetch` in ways that break Railway
 * private networking, so the draft launch bypasses it. `fetchImpl` switches to
 * the fetch path (unit tests / overrides only). The timeout is re-guarded at
 * runtime by `resolveTimeoutMs` (PR #1342 class: t3-env `skipValidation`
 * returns raw process.env without Zod defaults, and a timer API throws
 * `ERR_INVALID_ARG_TYPE` on `undefined`). A client-side timeout classifies as
 * `timeout` (retryable) — not `network_error` — so callers with a budget
 * BELOW mastra's internal one (the MCP generate path) still get honest
 * timeout semantics.
 *
 * The request timeout (`MASTRA_DRAFT_TIMEOUT_MS`, default 200s) is deliberately
 * LARGER than mastra's internal multi-step-workflow budget (180s) so the
 * mastra-side timeout wins the race and returns a clean `{ reason:"timeout" }`
 * envelope
 * (`docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`).
 *
 * Candidates + exemplar are computed admin-side (admin's pgvector + embeddings)
 * and shipped in the body, keyed on `videoId` (the real `VideoCandidate` shape).
 * The response `draft` is re-validated against the single-sourced
 * `DraftExperienceSchema` before it is trusted; admin's `normalizeExperienceDraft`
 * stays the final defense-in-depth gate after this client returns.
 */

import { request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"

import { env } from "@/config/env"
import {
  DraftExperienceSchema,
  type DraftExperience,
  type VideoCandidate,
} from "@forge/experience-schema"

export type MastraExperienceDraftMode = "quick" | "multi"

export type MastraExperienceDraftLaunchInput = {
  prompt: string
  locale: string
  candidates: readonly VideoCandidate[]
  exemplar?: string
  mode?: MastraExperienceDraftMode
}

export type MastraExperienceDraftFailureReason =
  | "config_missing"
  | "auth_failed"
  | "network_error"
  | "parse_error"
  // The route's own discriminated reasons (experience-draft-route.ts):
  | "invalid_input"
  | "timeout"
  | "generation_failed"
  | "internal_error"

export type MastraExperienceDraftLaunchResult =
  | { ok: true; draft: DraftExperience }
  | {
      ok: false
      reason: MastraExperienceDraftFailureReason
      retryable: boolean
    }

export type LaunchMastraExperienceDraftOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

// The reasons the mastra route emits in its `{ ok:false }` envelope.
const ROUTE_FAILURE_REASONS = new Set<MastraExperienceDraftFailureReason>([
  "invalid_input",
  "timeout",
  "generation_failed",
  "internal_error",
])

/** Fallback when the env-configured draft timeout is missing/invalid. */
const DEFAULT_DRAFT_TIMEOUT_MS = 200_000

/**
 * Byte ceiling for the buffered route response. A legitimate draft envelope
 * is a few hundred KB at the extreme (title + metaDescription + blocks at
 * 3 bytes per UTF-16 code unit for non-Latin scripts); 2MB leaves an order
 * of magnitude of headroom while keeping a misbehaving upstream from
 * buffering a multi-GB body into the shared Node heap. Over-cap resolves
 * with an empty body so the existing ladder classifies it (parse_error on
 * 2xx / network_error otherwise) — never a throw, never a new branch.
 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

/**
 * Normalize the request timeout to a positive number. `env.MASTRA_DRAFT_TIMEOUT_MS`
 * is TYPED `number` but at runtime can arrive `undefined`/string because t3-env's
 * `skipValidation` path returns raw `process.env` without applying the Zod
 * default — passing that to a timer API throws `ERR_INVALID_ARG_TYPE`. Takes
 * `unknown` so the runtime guards aren't elided by the (wrong) static type.
 */
function resolveTimeoutMs(value: unknown): number {
  const ms = typeof value === "string" ? Number(value) : value
  return typeof ms === "number" && Number.isFinite(ms) && ms > 0
    ? ms
    : DEFAULT_DRAFT_TIMEOUT_MS
}

type RawResponse = { status: number; bodyText: string }

/** POST over `node:http` to dodge the Next-patched global `fetch`. */
function postViaNode(
  target: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<RawResponse> {
  const request = target.protocol === "https:" ? httpsRequest : httpRequest
  return new Promise<RawResponse>((resolve, reject) => {
    const req = request(
      target,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        let totalBytes = 0
        let overCap = false
        res.on("data", (chunk: Buffer) => {
          if (overCap) return
          totalBytes += chunk.byteLength
          if (totalBytes > MAX_RESPONSE_BYTES) {
            // Byte-cap guard: settle FIRST (so the destroy's error event
            // cannot reject), then abort the socket rather than draining it.
            overCap = true
            resolve({ status: res.statusCode ?? 0, bodyText: "" })
            res.destroy()
            return
          }
          chunks.push(chunk)
        })
        res.on("end", () => {
          if (overCap) return
          resolve({
            status: res.statusCode ?? 0,
            bodyText: Buffer.concat(chunks).toString("utf8"),
          })
        })
        res.on("error", (error) => {
          if (overCap) return
          reject(error)
        })
      },
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy(
        Object.assign(new Error("draft request timed out"), {
          name: "TimeoutError",
        }),
      )
    })
    req.on("error", reject)
    req.end(body)
  })
}

/** Transport used when a caller injects `fetchImpl` (unit tests / overrides). */
async function postViaFetch(
  fetchImpl: typeof fetch,
  target: URL,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<RawResponse> {
  const response = await fetchImpl(target, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const bodyText = await response.text()
  // Post-buffering parity with the node path's cap (this path is test-only).
  if (Buffer.byteLength(bodyText) > MAX_RESPONSE_BYTES) {
    return { status: response.status, bodyText: "" }
  }
  return { status: response.status, bodyText }
}

/**
 * Render an unknown thrown value as a Railway-logsV2-safe plain string (NEVER
 * JSON.stringify — logsV2 silences stringified payloads from the Next runtime).
 */
function describeFetchError(error: unknown): string {
  const err = error instanceof Error ? error : undefined
  const cause = err?.cause instanceof Error ? err.cause : undefined
  const rawCode =
    (cause as { code?: unknown } | undefined)?.code ??
    (err as { code?: unknown } | undefined)?.code
  return (
    `name=${err?.name ?? "unknown"} ` +
    `code=${typeof rawCode === "string" ? rawCode : "none"} ` +
    `cause=${cause?.name ?? "none"} ` +
    `message=${err?.message ?? String(error)}`
  )
}

function isClientTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

/**
 * Parse the route's response body (the envelope itself — NOT a `{ result }`
 * wrapper). Returns null when the shape is unrecognized so the caller can fall
 * through to a status-based classification.
 */
function parseDraftRouteResult(
  value: unknown,
): MastraExperienceDraftLaunchResult | null {
  const record = asRecord(value)
  if (!record || typeof record.ok !== "boolean") return null

  if (record.ok === true) {
    const draft = DraftExperienceSchema.safeParse(record.draft)
    if (!draft.success) return null
    return { ok: true, draft: draft.data }
  }

  if (
    typeof record.reason !== "string" ||
    !ROUTE_FAILURE_REASONS.has(
      record.reason as MastraExperienceDraftFailureReason,
    ) ||
    typeof record.retryable !== "boolean"
  ) {
    return null
  }

  return {
    ok: false,
    reason: record.reason as MastraExperienceDraftFailureReason,
    retryable: record.retryable,
  }
}

export async function launchMastraExperienceDraft(
  input: MastraExperienceDraftLaunchInput,
  options: LaunchMastraExperienceDraftOptions = {},
): Promise<MastraExperienceDraftLaunchResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const body = {
    prompt: input.prompt,
    locale: input.locale,
    candidates: input.candidates,
    ...(input.exemplar == null ? {} : { exemplar: input.exemplar }),
    ...(input.mode == null ? {} : { mode: input.mode }),
  }

  const target = new URL("/forge-experience-draft", baseUrl)
  const headers = {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
  }
  const bodyText = JSON.stringify(body)
  const timeoutMs = resolveTimeoutMs(
    options.timeoutMs ?? env.MASTRA_DRAFT_TIMEOUT_MS,
  )

  let raw: RawResponse
  try {
    raw = options.fetchImpl
      ? await postViaFetch(
          options.fetchImpl,
          target,
          headers,
          bodyText,
          timeoutMs,
        )
      : await postViaNode(target, headers, bodyText, timeoutMs)
  } catch (error) {
    console.error(
      `[mastra-experience-draft] event=fetch_failed host=${target.host} ` +
        `transport=${options.fetchImpl ? "fetch" : "node-http"} ${describeFetchError(error)}`,
    )
    // A client-side abort means the admin-side budget elapsed — honest
    // timeout semantics, still retryable. Anything else is transport.
    if (isClientTimeout(error)) {
      return { ok: false, reason: "timeout", retryable: true }
    }
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (raw.status === 401) {
    console.warn(`[mastra-experience-draft] event=auth_failed status=401`)
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  let payload: unknown
  try {
    payload = raw.bodyText.length > 0 ? JSON.parse(raw.bodyText) : undefined
  } catch {
    payload = undefined
  }

  const parsed = parseDraftRouteResult(payload)
  if (parsed) return parsed

  if (raw.status < 200 || raw.status >= 300) {
    console.warn(
      `[mastra-experience-draft] event=http_error status=${raw.status}`,
    )
    return {
      ok: false,
      reason: "network_error",
      retryable: raw.status >= 500 || raw.status === 429,
    }
  }

  console.warn(
    `[mastra-experience-draft] event=parse_error status=${raw.status} ` +
      `bodyOk=${String(asRecord(payload)?.ok ?? "absent")}`,
  )
  return { ok: false, reason: "parse_error", retryable: true }
}

export const _internals = {
  parseDraftRouteResult,
  resolveTimeoutMs,
}
