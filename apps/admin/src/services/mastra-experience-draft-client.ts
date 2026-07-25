/**
 * Leg-1 caller for the standalone one-shot draft route (consolidation U6).
 *
 * Mirrors `mastra-experience-embedding-client.ts`: `config_missing`
 * short-circuit when the caller vars are unset, `POST /forge-experience-draft`
 * with a `Bearer` (reusing MASTRA_BASE_URL + MASTRA_SERVICE_API_KEY — the same
 * service + receiver CSV the embedding launches use), a single `response.json()`,
 * and a discriminated `{ ok } | { ok:false, reason, retryable }` envelope.
 *
 * The request timeout (`MASTRA_DRAFT_TIMEOUT_MS`, default 200s) is deliberately
 * LARGER than mastra's internal multi-step-workflow budget (180s) so the
 * mastra-side timeout wins the race and returns a clean `{ reason:"timeout" }`
 * envelope — admin's fetch aborting first would surface as a generic
 * `network_error` and trip a retry storm
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

  let response: Response
  try {
    response = await (options.fetchImpl ?? fetch)(
      new URL("/forge-experience-draft", baseUrl),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(
          options.timeoutMs ?? env.MASTRA_DRAFT_TIMEOUT_MS,
        ),
      },
    )
  } catch {
    // Includes the fetch-side AbortSignal.timeout firing. Because that budget
    // is strictly larger than mastra's internal budget, a genuine
    // generation-timeout returns a parsed `{ reason:"timeout" }` envelope on
    // the happy path below; reaching here means a real transport failure.
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (response.status === 401) {
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  const parsed = parseDraftRouteResult(
    await response.json().catch(() => undefined),
  )
  if (parsed) return parsed

  if (!response.ok) {
    return {
      ok: false,
      reason: "network_error",
      retryable: response.status >= 500 || response.status === 429,
    }
  }

  return { ok: false, reason: "parse_error", retryable: true }
}

export const _internals = {
  parseDraftRouteResult,
}
