/**
 * Caller for the standalone persona-variant route (`/forge-experience-variant`).
 *
 * Mirrors `mastra-experience-section-client.ts`: `config_missing` short-circuit
 * when the caller vars are unset, `POST /forge-experience-variant` with a
 * `Bearer` (reusing MASTRA_BASE_URL + MASTRA_SERVICE_API_KEY) over `node:http`
 * (Next's patched global `fetch` fails over Railway private networking), and a
 * discriminated `{ ok, draft, personaId } | { ok:false, reason, retryable }`
 * envelope.
 *
 * `MASTRA_VARIANTS_TIMEOUT_MS` (default 200s) is deliberately LARGER than
 * mastra's internal multi-step budget (180s) so the mastra-side timeout wins the
 * race and returns a clean `{ reason:"timeout" }` envelope rather than a generic
 * `network_error` retry storm
 * (`docs/solutions/best-practices/outbound-timeout-shorter-than-caller-budget-20260506.md`).
 * A client-side abort still classifies as `timeout` (retryable) — not
 * `network_error` — so callers that inject a budget BELOW mastra's internal
 * one (the MCP generate path's 90s ceiling) get honest timeout semantics.
 *
 * The response `draft` is re-validated against the single-sourced
 * `DraftExperienceSchema`; admin's `normalizeExperienceDraft` stays the gate
 * after this client returns.
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

export type MastraExperienceVariantLaunchInput = {
  topic: string
  locale: string
  personaId: string
  candidates: readonly VideoCandidate[]
  exemplar?: string
}

export type MastraExperienceVariantFailureReason =
  | "config_missing"
  | "auth_failed"
  | "network_error"
  | "parse_error"
  // The route's own discriminated reasons (experience-variant-route.ts):
  | "invalid_input"
  | "timeout"
  | "generation_failed"
  | "internal_error"

export type MastraExperienceVariantLaunchResult =
  | { ok: true; draft: DraftExperience; personaId: string }
  | {
      ok: false
      reason: MastraExperienceVariantFailureReason
      retryable: boolean
    }

export type LaunchMastraExperienceVariantOptions = {
  baseUrl?: string
  bearer?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

const ROUTE_FAILURE_REASONS = new Set<MastraExperienceVariantFailureReason>([
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

/** Fallback when the env-configured variants timeout is missing/invalid. */
const DEFAULT_VARIANTS_TIMEOUT_MS = 200_000

function parseVariantRouteResult(
  value: unknown,
): MastraExperienceVariantLaunchResult | null {
  const record = asRecord(value)
  if (!record || typeof record.ok !== "boolean") return null

  if (record.ok === true) {
    if (typeof record.personaId !== "string") return null
    const draft = DraftExperienceSchema.safeParse(record.draft)
    if (!draft.success) return null
    return { ok: true, draft: draft.data, personaId: record.personaId }
  }

  if (
    typeof record.reason !== "string" ||
    !ROUTE_FAILURE_REASONS.has(
      record.reason as MastraExperienceVariantFailureReason,
    ) ||
    typeof record.retryable !== "boolean"
  ) {
    return null
  }

  return {
    ok: false,
    reason: record.reason as MastraExperienceVariantFailureReason,
    retryable: record.retryable,
  }
}

export async function launchMastraExperienceVariant(
  input: MastraExperienceVariantLaunchInput,
  options: LaunchMastraExperienceVariantOptions = {},
): Promise<MastraExperienceVariantLaunchResult> {
  const baseUrl = options.baseUrl ?? env.MASTRA_BASE_URL
  const bearer = options.bearer ?? env.MASTRA_SERVICE_API_KEY
  if (!baseUrl || !bearer) {
    return { ok: false, reason: "config_missing", retryable: false }
  }

  const body = {
    topic: input.topic,
    locale: input.locale,
    personaId: input.personaId,
    candidates: input.candidates,
    exemplar: input.exemplar,
  }

  const target = new URL("/forge-experience-variant", baseUrl)
  const headers = {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
  }
  const bodyText = JSON.stringify(body)
  const timeoutMs = resolveTimeoutMs(
    options.timeoutMs ?? env.MASTRA_VARIANTS_TIMEOUT_MS,
    DEFAULT_VARIANTS_TIMEOUT_MS,
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
          timeoutErrorMessage: "variant request timed out",
        })
  } catch (error) {
    console.error(
      `[mastra-experience-variant] event=fetch_failed host=${target.host} ` +
        `transport=${options.fetchImpl ? "fetch" : "node-http"} ${describeFetchError(error)}`,
    )
    // A client-side abort means the admin-side budget elapsed — honest
    // timeout semantics (the MCP generate path runs a budget BELOW mastra's
    // internal one, so this is a legitimate, expected outcome there).
    if (isClientTimeout(error)) {
      return { ok: false, reason: "timeout", retryable: true }
    }
    return { ok: false, reason: "network_error", retryable: true }
  }

  if (raw.status === 401) {
    console.warn(`[mastra-experience-variant] event=auth_failed status=401`)
    return { ok: false, reason: "auth_failed", retryable: false }
  }

  let payload: unknown
  try {
    payload = raw.bodyText.length > 0 ? JSON.parse(raw.bodyText) : undefined
  } catch {
    payload = undefined
  }

  const parsed = parseVariantRouteResult(payload)
  if (parsed) return parsed

  if (raw.status < 200 || raw.status >= 300) {
    console.warn(
      `[mastra-experience-variant] event=http_error status=${raw.status}`,
    )
    return {
      ok: false,
      reason: "network_error",
      retryable: raw.status >= 500 || raw.status === 429,
    }
  }

  console.warn(
    `[mastra-experience-variant] event=parse_error status=${raw.status} ` +
      `bodyOk=${String(asRecord(payload)?.ok ?? "absent")}`,
  )
  return { ok: false, reason: "parse_error", retryable: true }
}

export const _internals = {
  parseVariantRouteResult,
  resolveTimeoutMs: (value: unknown) =>
    resolveTimeoutMs(value, DEFAULT_VARIANTS_TIMEOUT_MS),
}
