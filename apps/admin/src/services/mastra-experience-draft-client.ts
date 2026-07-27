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

import { env } from "@/config/env"
import {
  describeFetchError,
  isClientTimeout,
  postViaFetch,
  postViaNode,
  resolveTimeoutMs,
  type RawResponse,
} from "@/services/mastra-http-transport"
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
    DEFAULT_DRAFT_TIMEOUT_MS,
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
      : await postViaNode(target, headers, bodyText, timeoutMs, {
          timeoutErrorMessage: "draft request timed out",
        })
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
  resolveTimeoutMs: (value: unknown) =>
    resolveTimeoutMs(value, DEFAULT_DRAFT_TIMEOUT_MS),
}
